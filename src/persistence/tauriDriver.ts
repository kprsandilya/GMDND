import { invoke } from "@tauri-apps/api/core";
import type { ExecResult, Row, SqlDriver, SqlParam, Statement } from "./driver";

/** SqlDriver backed by the Rust commands in src-tauri/src/db.rs. */
export class TauriSqlDriver implements SqlDriver {
  async select<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return invoke<T[]>("db_select", { sql, params });
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<ExecResult> {
    return invoke<ExecResult>("db_execute", { sql, params });
  }

  async batch(statements: Statement[]): Promise<ExecResult[]> {
    return invoke<ExecResult[]>("db_batch", {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [], expect_changes: s.expect_changes ?? null })),
    });
  }

  async executeScript(sql: string): Promise<void> {
    await invoke("db_execute_script", { sql });
  }
}
