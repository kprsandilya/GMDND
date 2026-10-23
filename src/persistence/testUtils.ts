import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "./migrations";
import { NodeSqlDriver } from "./nodeDriver";
import { createRepositories, type Repositories } from "./repositories";

export async function testRepos(file = ":memory:"): Promise<{ repos: Repositories; driver: NodeSqlDriver }> {
  const driver = new NodeSqlDriver(file);
  await migrate(driver);
  return { repos: createRepositories(driver), driver };
}

/** A real on-disk database so tests can close and reopen it like the desktop app does. */
export function tempDbFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "dm-workbench-test-"));
  return { file: path.join(dir, "test.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
