export function waitFor<T>(pending: Promise<T>, message: string, timeout: number,
  signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(() => reject(new DOMException("Connection cancelled.", "AbortError")));
    const timer = setTimeout(() => finish(() => reject(new Error(message))), timeout);
    function finish(action: () => void): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      action();
    }
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    pending.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
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

type ConnectionPersistence = "persistent" | "tab";

const sessionKey = "mosaic.local-images";
const storageTimeout = "Browser storage did not respond. You can still connect a folder directly.";

function sessionConnection(): { found: boolean; handle?: FileSystemDirectoryHandle } {
  try {
    const state = window.history.state;
    if (!state || !Object.hasOwn(state, sessionKey)) return { found: false };
    const handle = state[sessionKey];
    if (handle === null) return { found: true };
    if (handle?.kind === "directory" && typeof handle.getFileHandle === "function") return { found: true, handle };
  } catch { /* Fall back to browser storage if session state cannot be read. */ }
  return { found: false };
}

function saveSession(handle: FileSystemDirectoryHandle | null): boolean {
  try {
    const state = window.history.state;
    if (state !== null && (typeof state !== "object" || Array.isArray(state))) return false;
    window.history.replaceState({ ...state, [sessionKey]: handle }, "");
    return true;
  } catch { return false; }
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open("mosaic.connections", 1);
  let expired = false;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      if (expired) { request.transaction?.abort(); return; }
      request.result.createObjectStore("folders");
    };
    request.onsuccess = () => {
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Mosaic tabs and try again."));
  });
  try { return await waitFor(pending, storageTimeout, 5000); }
  catch (error) { expired = true; throw error; }
}

async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  let abort: (() => void) | undefined;
  try {
    const transaction = database.transaction("folders", mode);
    abort = () => transaction.abort();
    const request = operation(transaction.objectStore("folders"));
    const pending = new Promise<T>((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(request.error ?? transaction.error ?? new Error("Could not remember the folder connection."));
    });
    return await waitFor(pending, storageTimeout, 5000);
  } catch (error) {
    try { abort?.(); } catch { /* The transaction may have already finished. */ }
    throw error;
  } finally { database.close(); }
}

async function persist(handle: FileSystemDirectoryHandle | null): Promise<ConnectionPersistence> {
  // Session history keeps the live transfer token across a document reload.
  const sessionSaved = saveSession(handle);
  try {
    await access("readwrite", store => {
      if (handle) store.put(handle, "local-images"); else store.delete("local-images");
      return store.delete("scry");
    });
    return "persistent";
  } catch (error) {
    if (!sessionSaved) throw error;
    return "tab";
  }
}

export const savedFolder = {
  async load(): Promise<FileSystemDirectoryHandle | undefined> {
    const session = sessionConnection();
    if (session.found) return session.handle;
    const handle = await access("readonly", store => store.get("local-images")) ??
      await access("readonly", store => store.get("scry"));
    return handle?.kind === "directory" && typeof handle.getFileHandle === "function" ? handle : undefined;
  },
  save: (handle: FileSystemDirectoryHandle) => persist(handle),
  forget: () => persist(null),
};
