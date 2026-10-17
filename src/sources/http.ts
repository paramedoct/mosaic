import type { DataRecord, DataSource } from "../types";

export class HttpSource implements DataSource {
  private readonly url: string;
  constructor(url: string) {
    this.url = url;
  }

  async start(emit: (record: DataRecord) => void): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    emit({
      timestamp: Date.now(),
      payload,
    });
  }

  stop(): void {}
}
