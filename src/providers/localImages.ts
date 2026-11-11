import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import type { Provider } from "../types";
import type { FileRoot, FileTransport } from "../transports/file";

export interface ImageQuery {
  subject?: string;
  source?: string;
  text?: string;
  tags?: readonly string[];
  order?: "oldest" | "newest";
}

export interface ImageSummary {
  id: string;
  sha256: string;
  path: string;
  subject: string;
  source: string;
  tags: readonly string[];
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface ImageCollection {
  images: readonly ImageSummary[];
  subjects: readonly string[];
  sources: readonly string[];
  tags: readonly string[];
  total: number;
  byteSize: number;
}

function rows(database: Database, sql: string, parameters: SqlValue[] = []): Record<string, SqlValue>[] {
  const statement = database.prepare(sql);
  try {
    statement.bind(parameters);
    const values: Record<string, SqlValue>[] = [];
    while (statement.step()) values.push(statement.getAsObject());
    return values;
  } finally { statement.free(); }
}

function parseImage(record: Record<string, SqlValue>): ImageSummary {
  const { id, subject, source, sha256, mime_type, byte_size, created_at } = record;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 ||
    typeof subject !== "string" || !subject.trim() || typeof source !== "string" || !source.trim() ||
    source === "." || source === ".." || /[/\\\0]/.test(source) ||
    typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof mime_type !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(mime_type) ||
    typeof byte_size !== "number" || !Number.isSafeInteger(byte_size) || byte_size < 0 ||
    typeof created_at !== "string" || !Number.isFinite(Date.parse(created_at))) {
    throw new Error("The images table contains invalid metadata.");
  }
  return {
    id: String(id), subject, source, sha256,
    path: `images/${source}/${sha256}`,
    tags: [], mimeType: mime_type, byteSize: byte_size, createdAt: created_at,
  };
}

export class LocalImagesProvider implements Provider<ImageQuery, ImageCollection> {
  private files: Pick<FileTransport, "get">;
  private sqlite: SqlJsStatic;
  private database?: Database;
  private root?: FileRoot;
  private records = new Map<string, ImageSummary>();
  private tagNames: string[] = [];
  private hasTags = false;

  constructor(files: Pick<FileTransport, "get">, sqlite: SqlJsStatic) {
    this.files = files;
    this.sqlite = sqlite;
  }

  async connect(root: FileRoot): Promise<void> {
    let file: File | undefined;
    let databasePath = "";
    for (const path of ["states/db", "state/scry.db"]) {
      try {
        file = await this.files.get(root, path);
        databasePath = path;
        break;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    }
    if (!file) {
      throw new Error("Choose the image library folder containing images/ and states/db.");
    }
    try {
      const wal = await this.files.get(root, `${databasePath}-wal`);
      if (wal.size) throw new Error("This library has pending SQLite WAL data. Close its writer and checkpoint the database before connecting.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
    if (file.size > 64 * 1024 * 1024) throw new Error("The SQLite file exceeds this prototype's 64 MB metadata limit.");
    const bytes = await file.arrayBuffer();
    const database = new this.sqlite.Database(new Uint8Array(bytes));
    try {
      database.run("PRAGMA query_only = ON;");
      const images = rows(database, "SELECT id, subject, source, sha256, mime_type, byte_size, created_at FROM images;").map(parseImage);
      const records = new Map(images.map(image => [image.id, image]));
      const tables = new Set(rows(database, "SELECT name FROM sqlite_master WHERE type = 'table';").map(row => row.name));
      const hasTags = tables.has("tags") && tables.has("image_tags");
      const names = new Set<string>();
      if (hasTags) {
        const imageTags = new Map<string, Set<string>>();
        for (const row of rows(database, "SELECT image_tags.image_id, tags.name FROM image_tags JOIN tags ON tags.id = image_tags.tag_id;")) {
          if (typeof row.name !== "string" || !row.name.trim()) throw new Error("The tags table contains invalid names.");
          const id = String(row.image_id);
          if (!records.has(id)) continue;
          const tags = imageTags.get(id) ?? new Set<string>();
          tags.add(row.name);
          names.add(row.name);
          imageTags.set(id, tags);
        }
        for (const [id, tags] of imageTags) records.get(id)!.tags = [...tags].sort();
      }
      this.database?.close();
      this.database = database;
      this.root = root;
      this.records = records;
      this.tagNames = [...names].sort();
      this.hasTags = hasTags;
    } catch (error) {
      database.close();
      throw new Error(`Could not read the image library SQLite schema: ${error instanceof Error ? error.message : "invalid database"}`);
    }
  }

  async fetch(query: ImageQuery = {}): Promise<ImageCollection> {
    if (!this.database) throw new Error("Connect an image library first.");
    const conditions: string[] = [];
    const values: SqlValue[] = [];
    if (query.subject) { conditions.push("images.subject = ?"); values.push(query.subject); }
    if (query.source) { conditions.push("images.source = ?"); values.push(query.source); }
    if (query.text?.trim()) {
      conditions.push("instr(lower(images.subject || ' ' || images.source || ' ' || images.sha256), lower(?)) > 0");
      values.push(query.text.trim());
    }
    for (const tag of new Set(query.tags ?? [])) {
      conditions.push(this.hasTags
        ? "EXISTS (SELECT 1 FROM image_tags JOIN tags ON tags.id = image_tags.tag_id WHERE image_tags.image_id = images.id AND tags.name = ?)"
        : "0");
      if (this.hasTags) values.push(tag);
    }
    const direction = query.order === "oldest" ? "ASC" : "DESC";
    const ids = rows(this.database,
      `SELECT images.id FROM images ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at ${direction}, images.id ${direction};`, values);
    const all = [...this.records.values()];
    return {
      images: ids.map(row => this.records.get(String(row.id))!),
      subjects: [...new Set(all.map(image => image.subject))].sort(),
      sources: [...new Set(all.map(image => image.source))].sort(),
      tags: this.tagNames,
      total: all.length,
      byteSize: all.reduce((size, image) => size + image.byteSize, 0),
    };
  }

  async readImage(id: string): Promise<Blob> {
    const image = this.records.get(id);
    if (!image || !this.root) throw new Error("Image not found.");
    const file = await this.files.get(this.root, image.path);
    return file.slice(0, file.size, image.mimeType);
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.root = undefined;
    this.records.clear();
    this.tagNames = [];
  }
}
