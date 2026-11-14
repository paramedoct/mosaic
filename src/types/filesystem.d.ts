interface FileSystemHandle {
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle;
  }) => Promise<FileSystemDirectoryHandle>;
}
