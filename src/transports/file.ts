export type FileRoot =
  | { kind: "directory"; handle: FileSystemDirectoryHandle }
  | { kind: "selection"; files: readonly File[] };

function relativePath(path: string): string[] {
  const parts = path.split("/");
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) ||
    parts.some(part => !part || part === "." || part === ".." || /[\\\0]/.test(part))) {
    throw new TypeError("Use a relative file path within the supplied root.");
  }
  return parts;
}

async function parentDirectory(directory: FileSystemDirectoryHandle, parts: readonly string[], create = false): Promise<FileSystemDirectoryHandle> {
  for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name, { create });
  return directory;
}

export class FileTransport {
  async remove(root: FileRoot, path: string): Promise<void> {
    if (root.kind !== "directory") throw new Error("Connect a writable image library folder first.");
    const parts = relativePath(path);
    try {
      const directory = await parentDirectory(root.handle, parts);
      await directory.removeEntry(parts[parts.length - 1]);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }

  async put(root: FileRoot, path: string, data: Blob): Promise<void> {
    if (root.kind !== "directory") throw new Error("Reconnect using a writable folder to add images.");
    const parts = relativePath(path);
    let stage = "opening destination";
    let writer: FileSystemWritableFileStream | undefined;
    try {
      const directory = await parentDirectory(root.handle, parts, true);
      const handle = await directory.getFileHandle(parts[parts.length - 1], { create: true });
      writer = await handle.createWritable();
      stage = "writing data";
      await writer.write(data);
      stage = "finalizing file";
      await writer.close();
    } catch (error) {
      await writer?.abort().catch(() => {});
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`Could not save ${path} (${stage}). ${message}`, { cause: error });
    }
  }

  async get(root: FileRoot, path: string): Promise<File> {
    const parts = relativePath(path);

    switch (root.kind) {
      case "directory": {
        const directory = await parentDirectory(root.handle, parts);
        return (await directory.getFileHandle(parts[parts.length - 1])).getFile();
      }
      case "selection": {
        let folder: string | undefined;
        let match: File | undefined;
        for (const file of root.files) {
          const relativePath = file.webkitRelativePath;
          let candidate = file.name;
          if (relativePath) {
            const separator = relativePath.indexOf("/");
            if (separator <= 0) throw new TypeError("Selected files contain an invalid relative path.");
            const name = relativePath.slice(0, separator);
            if (folder !== undefined && folder !== name) {
              throw new TypeError("Selected files must share one directory root.");
            }
            folder = name;
            candidate = relativePath.slice(separator + 1);
          }
          if (candidate === path) {
            if (match) throw new TypeError(`Multiple selected files match: ${path}`);
            match = file;
          }
        }
        if (!match) throw new DOMException(`File not found: ${path}`, "NotFoundError");
        return match;
      }
    }
  }
}
