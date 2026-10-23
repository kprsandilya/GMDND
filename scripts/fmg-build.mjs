// Builds the vendored Fantasy Map Generator with its own toolchain into public/fmg so the desktop
// app bundles it as a local, offline resource. Upstream sources are not modified: the Vite config
// in scripts/fmg.vite.config.ts wraps the upstream config.
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fmgDir, fmgOutDir, repoRoot } from "./fmg-paths.mjs";

if (!existsSync(path.join(fmgDir, "node_modules"))) {
  console.error("Fantasy-Map-Generator dependencies are missing. Run: npm run fmg:install");
  process.exit(1);
}

const config = path.join(repoRoot, "scripts", "fmg.vite.config.ts");
execSync(`npx vite build --mode electron --config "${config}"`, { cwd: fmgDir, stdio: "inherit", shell: true });

const pkg = JSON.parse(readFileSync(path.join(fmgDir, "package.json"), "utf8"));
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: fmgDir, encoding: "utf8" }).trim();
} catch {}
writeFileSync(
  path.join(fmgOutDir, "fmg-build.json"),
  JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), license: pkg.license }, null, 2)
);
console.log(`Fantasy Map Generator ${pkg.version} (${commit}) built into ${fmgOutDir}`);
