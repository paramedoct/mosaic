export type FileRoot =
  | { kind: "directory"; handle: FileSystemDirectoryHandle }
  | { kind: "selection"; files: readonly File[] };

export class FileTransport {
  async get(root: FileRoot, path: string): Promise<File> {
    const parts = path.split("/");
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) ||
      parts.some(part => !part || part === "." || part === ".." || /[\\\0]/.test(part))) {
      throw new TypeError("Use a relative file path within the supplied root.");
    }

    switch (root.kind) {
      case "directory": {
        let directory = root.handle;
        for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
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
