import type { FileRoot } from "../transports/file";

export interface FileConnection {
  name: string;
  root: FileRoot;
}

export async function chooseDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error("This browser does not support folder connections. Use the session folder picker.");
  return window.showDirectoryPicker({ id: "local-images-library", mode: "read" });
}
