export class HttpTransport {
  async get(url: string): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  }
}
