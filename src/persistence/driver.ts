/**
 * The persistence layer talks to SQLite exclusively through this interface. In the desktop app it
 * is implemented by Tauri commands (Rust + rusqlite); in tests by Node's built-in `node:sqlite`.
 * Nothing above this layer builds SQL strings: repositories do, React components never.
 */
export type SqlParam = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface ExecResult {
  changes: number;
  last_insert_rowid: number;
}

export interface Statement {
  sql: string;
  params?: SqlParam[];
  /** When set, the whole batch is rolled back unless this statement changed exactly this many rows. */
  expect_changes?: number;
}

export interface SqlDriver {
  select<T extends Row = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<ExecResult>;
  /** Executes every statement inside one transaction. */
  batch(statements: Statement[]): Promise<ExecResult[]>;
  /** Runs a multi-statement script (DDL). */
  executeScript(sql: string): Promise<void>;
}

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchError";
  }
}
