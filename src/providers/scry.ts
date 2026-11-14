import initialize from "sql.js/dist/sql-wasm-inline.js";
import { unzipSync } from "fflate";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import type { Provider } from "../types";
import type { FileRoot, FileTransport } from "../transports/file";

let engine: Promise<SqlJsStatic> | undefined;
export function loadSqlite(): Promise<SqlJsStatic> { return engine ??= initialize(); }

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
  standaloneImages: readonly ImageSummary[];
  groups: readonly ImageGroup[];
  subjects: readonly string[];
  sources: readonly string[];
  tags: readonly string[];
  total: number;
  byteSize: number;
}

export interface ImageGroup {
  id: string;
  subject: string;
  source: string;
  createdAt: string;
  images: readonly ImageSummary[];
}

interface StoredImageGroup extends ImageGroup { sha256: string; }

export interface ImageImportResult {
  added: number;
  skipped: number;
  groupsAdded?: number;
  groupsSkipped?: number;
}

async function digest(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function readGroups(database: Database, records: Map<string, ImageSummary>): StoredImageGroup[] {
  const tables = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mosaic_image_groups', 'mosaic_image_group_items');");
  if (!tables.length) return [];
  if (tables.length !== 2) throw new Error("The image group schema is incomplete.");
  const items = new Map<string, ImageSummary[]>();
  for (const row of rows(database, "SELECT group_id, image_id FROM mosaic_image_group_items ORDER BY group_id, position;")) {
    const image = records.get(String(row.image_id));
    if (!image) continue;
    const id = String(row.group_id);
    const members = items.get(id) ?? [];
    members.push(image);
    items.set(id, members);
  }
  return rows(database, "SELECT id, subject, source, sha256, created_at FROM mosaic_image_groups;").map(row => {
    if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id < 1 ||
      typeof row.subject !== "string" || !row.subject.trim() ||
      typeof row.source !== "string" || !row.source.trim() || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256) ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error("The image groups contain invalid metadata.");
    }
    return { id: String(row.id), subject: row.subject, source: row.source,
      sha256: row.sha256, createdAt: row.created_at, images: items.get(String(row.id)) ?? [] };
  }).filter(group => group.images.length);
}

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/apng": "apng",
  "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-ms-bmp": "bmp",
  "image/tiff": "tiff", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
  "image/heic": "heic", "image/heif": "heif", "image/jxl": "jxl",
};

const archiveLimit = 256 * 1024 * 1024;
const entryLimit = 10000;
const imageTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
  png: "image/png", apng: "image/apng", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff",
  tiff: "image/tiff", ico: "image/x-icon", heic: "image/heic", heif: "image/heif", jxl: "image/jxl",
};

function isImageArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || ["application/zip", "application/x-zip", "application/x-zip-compressed"].includes(file.type);
}

async function readImageArchive(file: File): Promise<File[]> {
  if (file.size > archiveLimit) throw new Error(`ZIP exceeds the 256 MB limit: ${file.name}`);
  const data = new Uint8Array(await file.arrayBuffer());
  let size = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, { filter: entry => {
      if (++count > entryLimit) throw new Error("ZIP contains more than 10,000 entries.");
      const parts = entry.name.replaceAll("\\", "/").split("/");
      if (entry.name.endsWith("/") || parts.some(part => part.startsWith(".") || part === "__MACOSX")) return false;
      const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!imageTypes[extension]) return false;
      size += entry.originalSize;
      if (!Number.isSafeInteger(size) || size > archiveLimit) throw new Error("Extracted images exceed the 256 MB limit.");
      return true;
    } });
  } catch (error) {
    throw new Error(`Could not open ZIP ${file.name}: ${error instanceof Error ? error.message : "invalid archive"}`, { cause: error });
  }
  const names = Object.keys(entries).sort((left, right) =>
    left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }) || (left < right ? -1 : left > right ? 1 : 0));
  if (!names.length) throw new Error(`ZIP contains no supported images: ${file.name}`);
  return names.map(name => new File([new Uint8Array(entries[name])], name, {
    type: imageTypes[name.split(".").pop()!.toLowerCase()], lastModified: file.lastModified,
  }));
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
  const extension = imageExtensions[mime_type.toLowerCase()];
  return {
    id: String(id), subject, source, sha256,
    path: `images/${source}/${sha256}${extension ? `.${extension}` : ""}`,
    tags: [], mimeType: mime_type, byteSize: byte_size, createdAt: created_at,
  };
}

export class ScryProvider implements Provider<ImageQuery, ImageCollection> {
  private files: Pick<FileTransport, "get"> & Partial<Pick<FileTransport, "put" | "remove">>;
  private sqlite: SqlJsStatic;
  private database?: Database;
  private root?: FileRoot;
  private records = new Map<string, ImageSummary>();
  private groups: StoredImageGroup[] = [];
  private tagNames: string[] = [];
  private hasTags = false;
  private databasePath = "";
  private databaseBytes = new Uint8Array();
  private importing = false;
  private closePending = false;

  constructor(files: Pick<FileTransport, "get"> & Partial<Pick<FileTransport, "put" | "remove">>, sqlite: SqlJsStatic) {
    this.files = files;
    this.sqlite = sqlite;
  }

  async connect(root: FileRoot): Promise<void> {
    if (this.importing) throw new Error("Wait for the image import to finish before reconnecting.");
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
      const groups = readGroups(database, records);
      this.database?.close();
      this.database = database;
      this.root = root;
      this.records = records;
      this.groups = groups;
      this.tagNames = [...names].sort();
      this.hasTags = hasTags;
      this.databasePath = databasePath;
      this.databaseBytes = new Uint8Array(bytes);
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
    const images = ids.map(row => this.records.get(String(row.id))!);
    const groupedIds = new Set(this.groups.flatMap(group => group.images.map(image => image.id)));
    const groups = this.groups.filter(group => {
      if (query.subject && group.subject !== query.subject || query.source && group.source !== query.source) return false;
      const text = query.text?.trim().toLowerCase();
      if (text && !`${group.subject} ${group.source}`.toLowerCase().includes(text) &&
        !group.images.some(image => `${image.subject} ${image.source} ${image.sha256}`.toLowerCase().includes(text))) return false;
      return (query.tags ?? []).every(tag => group.images.some(image => image.tags.includes(tag)));
    }).sort((left, right) => {
      const compared = left.createdAt.localeCompare(right.createdAt) || Number(left.id) - Number(right.id);
      return query.order === "oldest" ? compared : -compared;
    });
    return {
      images,
      standaloneImages: images.filter(image => !groupedIds.has(image.id)),
      groups,
      subjects: [...new Set([...all.map(image => image.subject), ...this.groups.map(group => group.subject)])].sort(),
      sources: [...new Set([...all.map(image => image.source), ...this.groups.map(group => group.source)])].sort(),
      tags: this.tagNames,
      total: all.length,
      byteSize: all.reduce((size, image) => size + image.byteSize, 0),
    };
  }

  async readImage(id: string): Promise<Blob> {
    const image = this.records.get(id);
    if (!image || !this.root) throw new Error("Image not found.");
    let file: File;
    try { file = await this.files.get(this.root, image.path); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      file = await this.files.get(this.root, `images/${image.source}/${image.sha256}`);
    }
    return file.slice(0, file.size, image.mimeType);
  }

  async addImages(files: readonly File[], subject: string, source: string): Promise<ImageImportResult> {
    if (this.importing) throw new Error("An image import is already running.");
    if (!this.database || !this.root || this.root.kind !== "directory" || !this.files.put) {
      throw new Error("Connect a writable image library folder first.");
    }
    subject = subject.trim();
    source = source.trim();
    if (!subject || !source || source === "." || source === ".." || /[/\\\0]/.test(source)) {
      throw new Error("Enter a subject and a source without path separators.");
    }
    if (!files.length) throw new Error("Choose images to add.");
    if (!globalThis.crypto?.subtle) throw new Error("Image hashing is unavailable. Open Mosaic from a local drive or localhost.");
    const root = this.root;
    const candidate = new this.sqlite.Database(this.database.export());
    this.importing = true;
    try {
      candidate.run("PRAGMA foreign_keys = ON;");
      const known = new Map([...this.records.values()].map(image => [image.sha256, image]));
      const pending: { file: File; image: ImageSummary }[] = [];
      let skipped = 0;
      let groupsAdded = 0;
      let groupsSkipped = 0;
      const hasArchives = files.some(isImageArchive);
      let schemaChanged = false;
      for (const table of ["mosaic_image_groups", "mosaic_image_group_items"]) {
        if (rows(candidate, `PRAGMA table_info(${table});`).some(column => column.name === "name")) {
          candidate.run(`ALTER TABLE ${table} DROP COLUMN name;`);
          schemaChanged = true;
        }
      }
      if (hasArchives) candidate.run(`
        CREATE TABLE IF NOT EXISTS mosaic_image_groups (
          id INTEGER PRIMARY KEY, subject TEXT NOT NULL, source TEXT NOT NULL,
          sha256 TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mosaic_image_group_items (
          group_id INTEGER NOT NULL REFERENCES mosaic_image_groups(id) ON DELETE CASCADE,
          image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK(position >= 0),
          PRIMARY KEY (group_id, position)
        );
        CREATE INDEX IF NOT EXISTS mosaic_image_group_items_image_idx ON mosaic_image_group_items(image_id);
      `);
      for (const selected of files) {
        const archive = isImageArchive(selected);
        const members = archive ? await readImageArchive(selected) : [selected];
        const manifest: { sha256: string; id: string }[] = [];
        for (const file of members) {
          const sha256 = await digest(await file.arrayBuffer());
          const existing = known.get(sha256);
          if (existing) {
            skipped += 1;
            manifest.push({ sha256, id: existing.id });
            continue;
          }
          if (!imageExtensions[file.type.toLowerCase()]) throw new Error(`Not a supported image: ${file.name}`);
          const createdAt = new Date().toISOString();
          candidate.run("INSERT INTO images (subject, source, sha256, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?);",
            [subject, source, sha256, file.type, file.size, createdAt]);
          const image = parseImage(rows(candidate, "SELECT id, subject, source, sha256, mime_type, byte_size, created_at FROM images WHERE sha256 = ?;", [sha256])[0]);
          pending.push({ file, image });
          known.set(sha256, image);
          manifest.push({ sha256, id: image.id });
        }
        if (archive) {
          const hashes = manifest.map(item => item.sha256);
          const sha256 = await digest(new TextEncoder().encode(JSON.stringify(hashes)).buffer);
          if (rows(candidate, "SELECT id FROM mosaic_image_groups WHERE sha256 = ?;", [sha256]).length ||
            this.groups.some(group => group.images.length === hashes.length && group.images.every((image, index) => image.sha256 === hashes[index]))) {
            groupsSkipped += 1;
            continue;
          }
          candidate.run("INSERT INTO mosaic_image_groups (subject, source, sha256, created_at) VALUES (?, ?, ?, ?);",
            [subject, source, sha256, new Date().toISOString()]);
          const groupId = rows(candidate, "SELECT last_insert_rowid() AS id;")[0].id;
          manifest.forEach((item, position) => candidate.run(
            "INSERT INTO mosaic_image_group_items (group_id, image_id, position) VALUES (?, ?, ?);",
            [groupId, Number(item.id), position]));
          groupsAdded += 1;
        }
      }
      const result: ImageImportResult = { added: pending.length, skipped };
      if (hasArchives) { result.groupsAdded = groupsAdded; result.groupsSkipped = groupsSkipped; }
      if (!pending.length && !groupsAdded && !schemaChanged) return result;
      for (const { file, image } of pending) await this.files.put(root, image.path, file);
      try {
        const wal = await this.files.get(root, `${this.databasePath}-wal`);
        if (wal.size) throw new Error("The library has pending SQLite WAL data. Close its writer and reload before adding images.");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
      const current = new Uint8Array(await (await this.files.get(root, this.databasePath)).arrayBuffer());
      if (current.length !== this.databaseBytes.length || current.some((value, index) => value !== this.databaseBytes[index])) {
        throw new Error("The library changed on disk. Reload the library before adding images again.");
      }
      const updated = new Uint8Array(candidate.export());
      if (updated.length > 64 * 1024 * 1024) throw new Error("The library metadata exceeds the 64 MB limit.");
      const records = new Map(this.records);
      for (const { image } of pending) records.set(image.id, image);
      const groups = readGroups(candidate, records);
      await this.files.put(root, this.databasePath, new Blob([updated]));
      this.database.close();
      candidate.run("PRAGMA query_only = ON;");
      this.database = candidate;
      this.databaseBytes = updated;
      this.records = records;
      this.groups = groups;
      return result;
    } finally {
      if (this.database !== candidate) candidate.close();
      this.importing = false;
      if (this.closePending) this.close();
    }
  }

  async deleteEntry(entry: { kind: "image" | "group"; id: string }): Promise<{ deleted: number; shared: number; failedFiles: number }> {
    if (this.importing) throw new Error("Wait for the library update to finish.");
    if (!this.database || this.root?.kind !== "directory" || !this.files.put || !this.files.remove) {
      throw new Error("Connect a writable image library folder first.");
    }
    const group = entry.kind === "group" ? this.groups.find(group => group.id === entry.id) : undefined;
    const image = entry.kind === "image" ? this.records.get(entry.id) : undefined;
    if (!group && !image) throw new Error("Image or group not found.");
    if (image && this.groups.some(group => group.images.some(member => member.id === image.id))) {
      throw new Error("Delete the entire group instead of an individual group image.");
    }
    const root = this.root;
    const candidate = new this.sqlite.Database(this.database.export());
    this.importing = true;
    try {
      candidate.run("PRAGMA foreign_keys = ON;");
      const sharedIds = new Set(this.groups.filter(other => other.id !== group?.id).flatMap(other => other.images.map(image => image.id)));
      const members = [...new Map((group?.images ?? [image!]).map(image => [image.id, image])).values()];
      const removed = members.filter(image => !sharedIds.has(image.id));
      if (group) candidate.run("DELETE FROM mosaic_image_groups WHERE id = ?;", [Number(group.id)]);
      for (const image of removed) {
        if (this.hasTags) candidate.run("DELETE FROM image_tags WHERE image_id = ?;", [Number(image.id)]);
        candidate.run("DELETE FROM images WHERE id = ?;", [Number(image.id)]);
      }
      try {
        const wal = await this.files.get(root, `${this.databasePath}-wal`);
        if (wal.size) throw new Error("The library has pending SQLite WAL data. Close its writer and reload before deleting images.");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
      const current = new Uint8Array(await (await this.files.get(root, this.databasePath)).arrayBuffer());
      if (current.length !== this.databaseBytes.length || current.some((value, index) => value !== this.databaseBytes[index])) {
        throw new Error("The library changed on disk. Reload before deleting images.");
      }
      const records = new Map(this.records);
      for (const image of removed) records.delete(image.id);
      const groups = readGroups(candidate, records);
      const updated = new Uint8Array(candidate.export());
      await this.files.put(root, this.databasePath, new Blob([updated]));
      this.database.close();
      candidate.run("PRAGMA query_only = ON;");
      this.database = candidate;
      this.databaseBytes = updated;
      this.records = records;
      this.groups = groups;
      this.tagNames = [...new Set([...records.values()].flatMap(image => [...image.tags]))].sort();
      let failedFiles = 0;
      for (const image of removed) {
        for (const path of new Set([image.path, `images/${image.source}/${image.sha256}`])) {
          try { await this.files.remove(root, path); }
          catch { failedFiles += 1; }
        }
      }
      return { deleted: removed.length, shared: members.length - removed.length, failedFiles };
    } finally {
      if (this.database !== candidate) candidate.close();
      this.importing = false;
      if (this.closePending) this.close();
    }
  }

  close(): void {
    if (this.importing) { this.closePending = true; return; }
    this.closePending = false;
    this.database?.close();
    this.database = undefined;
    this.root = undefined;
    this.records.clear();
    this.groups = [];
    this.tagNames = [];
  }
}
