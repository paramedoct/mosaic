import type { FileRoot } from "../transports/file";

export interface FileConnection {
  name: string;
  root: FileRoot;
}

export function isSharedFileDocument(): boolean {
  return window.location.protocol === "file:" && window.location.hostname !== "";
}

export async function chooseDirectory(): Promise<FileSystemDirectoryHandle> {
  if (isSharedFileDocument()) {
    throw new Error("Open the Mosaic HTML file from a Windows drive to enable folder permissions. The image library folder can stay in its current location.");
  }
  if (!window.showDirectoryPicker) {
    throw new Error("This browser does not support remembered folder connections. Use the session folder picker.");
  }
  return window.showDirectoryPicker({ id: "local-images-library", mode: "read" });
}

export async function hasReadAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return await handle.queryPermission({ mode: "read" }) === "granted";
}

export async function requestReadAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return await handle.requestPermission({ mode: "read" }) === "granted";
}
