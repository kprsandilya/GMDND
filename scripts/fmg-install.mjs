// Installs the vendored Fantasy Map Generator's own dependencies (it is a separate Vite project).
// Scripts are skipped: we never need its Electron binary or git hooks.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fmgDir } from "./fmg-paths.mjs";

if (!existsSync(`${fmgDir}/package.json`)) {
  console.error("Fantasy-Map-Generator submodule is missing. Run: git submodule update --init --recursive");
  process.exit(1);
}

execSync("npm ci --ignore-scripts --no-audit --no-fund", { cwd: fmgDir, stdio: "inherit", shell: true });
