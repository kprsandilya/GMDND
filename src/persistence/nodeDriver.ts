import { DatabaseSync } from "node:sqlite";
import { BatchError, type ExecResult, type Row, type SqlDriver, type SqlParam, type Statement } from "./driver";

type NodeParam = string | number | bigint | null;

const toNodeParam = (p: SqlParam): NodeParam => (typeof p === "boolean" ? (p ? 1 : 0) : p);

/**
 * SqlDriver on Node's built-in SQLite, used by the test-suite so repositories, migrations and
 * domain workflows run against a real database with the same pragmas as the desktop app.
 */
export class NodeSqlDriver implements SqlDriver {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  async select<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params.map(toNodeParam)) as unknown as T[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<ExecResult> {
    const result = this.db.prepare(sql).run(...params.map(toNodeParam));
    return { changes: Number(result.changes), last_insert_rowid: Number(result.lastInsertRowid) };
  }

  async batch(statements: Statement[]): Promise<ExecResult[]> {
    this.db.exec("BEGIN");
    const results: ExecResult[] = [];
    try {
      statements.forEach((statement, index) => {
        const result = this.db.prepare(statement.sql).run(...(statement.params ?? []).map(toNodeParam));
        const changes = Number(result.changes);
        if (statement.expect_changes !== undefined && changes !== statement.expect_changes) {
          throw new BatchError(
            `batch statement ${index} changed ${changes} rows, expected ${statement.expect_changes}; transaction rolled back`,
          );
        }
        results.push({ changes, last_insert_rowid: Number(result.lastInsertRowid) });
      });
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async executeScript(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
