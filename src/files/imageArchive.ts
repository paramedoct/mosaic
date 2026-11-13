import { unzipSync } from "fflate";

const archiveLimit = 256 * 1024 * 1024;
const entryLimit = 10000;
const imageTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
  png: "image/png", apng: "image/apng", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff",
  tiff: "image/tiff", ico: "image/x-icon", heic: "image/heic", heif: "image/heif", jxl: "image/jxl",
};

export function isImageArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || ["application/zip", "application/x-zip", "application/x-zip-compressed"].includes(file.type);
}

export async function readImageArchive(file: File): Promise<File[]> {
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
