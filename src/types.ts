export interface DataRecord {
  timestamp: number;
  payload: unknown;
}

export interface DataSource {
  start(emit: (record: DataRecord) => void): Promise<void>;
  stop(): void;
}
