import type { FileRoot } from "../transports/file";
import { waitFor } from "./pending";

export interface FileConnection {
  name: string;
  root: FileRoot;
}

export function isSharedFileDocument(): boolean {
  return window.location.protocol === "file:" && window.location.hostname !== "";
}

export async function chooseDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("This browser does not support remembered folder connections. Use the session folder picker.");
  }
  return window.showDirectoryPicker({ id: "local-images-library", mode: "read" });
}

export async function droppedDirectory(items: readonly DataTransferItem[]): Promise<FileSystemDirectoryHandle> {
  const files = items.filter(item => item.kind === "file");
  if (files.length !== 1) throw new Error("Drop one image library folder containing images/ and states/db.");
  const item = files[0];
  if (!item.getAsFileSystemHandle) throw new Error("This browser cannot connect dropped folders. Use Connect image folder.");
  // Capture the handle before the drop event's data store becomes unavailable.
  const handle = await item.getAsFileSystemHandle();
  if (handle?.kind !== "directory") throw new Error("Drop the image library folder, rather than an individual file.");
  return handle as FileSystemDirectoryHandle;
}

export async function hasReadAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return await waitFor(handle.queryPermission({ mode: "read" }),
    "The browser did not respond when checking the saved folder permission.", 5000) === "granted";
}

export async function requestReadAccess(handle: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<boolean> {
  return await waitFor(handle.requestPermission({ mode: "read" }),
    "The browser did not complete the folder permission request. The connection can be retried.", 45000, signal) === "granted";
}
