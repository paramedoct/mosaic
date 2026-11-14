export type ConnectionPersistence = "persistent" | "tab";

const sessionKey = "mosaic.local-images";

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

export class ConnectionStore {
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("mosaic.connections", 1);
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("Browser storage did not respond. You can still connect a folder directly.")), 5000);
      request.onupgradeneeded = () => {
        if (finished) { request.transaction?.abort(); return; }
        request.result.createObjectStore("folders");
      };
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true;
        clearTimeout(timer);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Close other Mosaic tabs and try again."));
    });
  }

  private async access<T>(mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      let request: IDBRequest<T>;
      try {
        transaction = database.transaction("folders", mode);
        request = operation(transaction.objectStore("folders"));
      } catch (error) {
        database.close();
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error("Browser storage did not respond. You can still connect a folder directly."));
        try { transaction.abort(); } catch { /* The transaction may have already finished. */ }
        database.close();
      }, 5000);
      transaction.oncomplete = () => { clearTimeout(timer); database.close(); resolve(request.result); };
      transaction.onabort = () => {
        clearTimeout(timer);
        database.close();
        reject(request.error ?? transaction.error ?? new Error("Could not remember the folder connection."));
      };
    });
  }

  async load(): Promise<FileSystemDirectoryHandle | undefined> {
    const session = sessionConnection();
    if (session.found) return session.handle;
    const handle = await this.access("readonly", store => store.get("local-images")) ??
      await this.access("readonly", store => store.get("scry"));
    if (!handle || handle.kind !== "directory" || typeof handle.getFileHandle !== "function") return undefined;
    return handle as FileSystemDirectoryHandle;
  }

  async save(handle: FileSystemDirectoryHandle): Promise<ConnectionPersistence> {
    // Session history keeps the live transfer token across a document reload.
    const sessionSaved = saveSession(handle);
    try {
      await this.access("readwrite", store => {
        const request = store.put(handle, "local-images");
        store.delete("scry");
        return request;
      });
      return "persistent";
    } catch (error) {
      if (!sessionSaved) throw error;
      return "tab";
    }
  }

  async forget(): Promise<ConnectionPersistence> {
    const sessionForgotten = saveSession(null);
    try {
      await this.access("readwrite", store => {
        store.delete("scry");
        return store.delete("local-images");
      });
      return "persistent";
    } catch (error) {
      if (!sessionForgotten) throw error;
      return "tab";
    }
  }
}
