export class ConnectionStore {
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("mosaic.connections", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("folders");
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other Mosaic tabs and try again."));
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
      transaction.oncomplete = () => { database.close(); resolve(request.result); };
      transaction.onabort = () => {
        database.close();
        reject(request.error ?? transaction.error ?? new Error("Could not remember the folder connection."));
      };
    });
  }

  async load(): Promise<FileSystemDirectoryHandle | undefined> {
    const handle = await this.access("readonly", store => store.get("local-images")) ??
      await this.access("readonly", store => store.get("scry"));
    if (!handle || handle.kind !== "directory" || typeof handle.getFileHandle !== "function") return undefined;
    return handle as FileSystemDirectoryHandle;
  }

  async save(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.access("readwrite", store => {
      const request = store.put(handle, "local-images");
      store.delete("scry");
      return request;
    });
  }

  async forget(): Promise<void> {
    await this.access("readwrite", store => {
      store.delete("scry");
      return store.delete("local-images");
    });
  }
}
