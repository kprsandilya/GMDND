import { fileURLToPath } from "node:url";
import path from "node:path";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fmgDir = path.join(repoRoot, "Fantasy-Map-Generator");
export const fmgOutDir = path.join(repoRoot, "public", "fmg");
