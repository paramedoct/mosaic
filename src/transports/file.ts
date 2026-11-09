export class FileTransport {
  async readText(file: Blob): Promise<string> {
    return file.text();
  }

  async readBytes(file: Blob): Promise<ArrayBuffer> {
    return file.arrayBuffer();
  }
}
