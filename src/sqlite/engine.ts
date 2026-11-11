import initialize from "sql.js/dist/sql-wasm-inline.js";
import type { SqlJsStatic } from "sql.js";

let engine: Promise<SqlJsStatic> | undefined;

export function loadSqlite(): Promise<SqlJsStatic> {
  engine ??= initialize();
  return engine;
}
