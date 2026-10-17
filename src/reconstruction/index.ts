import type { DataRecord } from "../types"

export function reconstruct(record: DataRecord): string {
  return JSON.stringify(record.payload, null, 2);
}
