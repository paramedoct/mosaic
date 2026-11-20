const downloadLimit = 256 * 1024 * 1024;
const archiveTypes = new Set(["application/zip", "application/x-zip", "application/x-zip-compressed"]);
const genericTypes = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const fileTypes: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png", apng: "image/apng",
  webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
  tif: "image/tiff", tiff: "image/tiff", ico: "image/x-icon", heic: "image/heic", heif: "image/heif",
  jxl: "image/jxl", zip: "application/zip",
};

export function downloadUrls(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

function fileName(response: Response, url: URL, index: number): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ??
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? url.pathname.split("/").filter(Boolean).pop();
  let name = `download-${index + 1}`;
  if (encoded) {
    try { name = decodeURIComponent(encoded); }
    catch { name = encoded; }
  }
  return name.replace(/[\\/\0]/g, "_").slice(0, 255) || `download-${index + 1}`;
}

async function download(rawUrl: string, index: number): Promise<File> {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch (error) { throw new Error(`Invalid download URL: ${rawUrl}`, { cause: error }); }
  if (url.protocol !== "https:") throw new Error(`Download URLs must use HTTPS: ${rawUrl}`);

  let response: Response;
  try {
    response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (error) {
    throw new Error(`Could not download ${rawUrl}. The server may not allow browser downloads (CORS).`, { cause: error });
  }
  if (!response.ok) throw new Error(`Could not download ${rawUrl}: HTTP ${response.status}`);

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > downloadLimit) {
    throw new Error(`Download exceeds the 256 MB limit: ${rawUrl}`);
  }
  const name = fileName(response, url, index);
  const declaredType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const inferredType = fileTypes[name.split(".").pop()?.toLowerCase() ?? ""];
  const type = genericTypes.has(declaredType) && inferredType ? inferredType : declaredType;
  const archive = archiveTypes.has(type) || /\.zip$/i.test(name);
  if (!type.startsWith("image/") && !archive) {
    throw new Error(`Download is not an image or ZIP file: ${rawUrl}`);
  }
  const blob = await response.blob();
  if (blob.size > downloadLimit) throw new Error(`Download exceeds the 256 MB limit: ${rawUrl}`);
  return new File([blob], archive && !/\.zip$/i.test(name) ? `${name}.zip` : name, { type, lastModified: Date.now() });
}

export async function downloadImages(urls: readonly string[], progress: (completed: number) => void): Promise<File[]> {
  const files: File[] = [];
  let size = 0;
  for (const [index, url] of urls.entries()) {
    progress(index);
    const file = await download(url, index);
    size += file.size;
    if (!Number.isSafeInteger(size) || size > downloadLimit) throw new Error("Downloads exceed the 256 MB total limit.");
    files.push(file);
  }
  progress(urls.length);
  return files;
}
