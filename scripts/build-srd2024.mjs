// Converts the raw open5e SRD-2024 fixtures (scripts/srd2024-raw/) into the single bundled data
// file src/seed/srd2024.data.json that the app seeds into the shared standard library on first run.
//
// Re-run after refreshing scripts/srd2024-raw/ from
// https://github.com/open5e/open5e-api/tree/staging/data/v2/wizards-of-the-coast/srd-2024
//
//   node scripts/build-srd2024.mjs
//
// Node >= 24 runs the TypeScript converter directly via native type stripping.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSrdLibrary } from "../src/domain/srd2024.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(repoRoot, "scripts", "srd2024-raw");
const outFile = path.join(repoRoot, "src", "seed", "srd2024.data.json");

function read(name) {
  const file = path.join(rawDir, name);
  if (!existsSync(file)) {
    console.warn(`  (missing ${name}, skipping)`);
    return [];
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

console.log(`Reading SRD-2024 fixtures from ${rawDir}`);
const source = {
  creatures: read("Creature.json"),
  creatureActions: read("CreatureAction.json"),
  creatureTraits: read("CreatureTrait.json"),
  items: read("Item.json"),
  magicItems: read("MagicItem.json"),
  weapons: read("Weapon.json"),
  armor: read("Armor.json"),
};

const library = buildSrdLibrary(source);

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(library));
console.log(
  `Wrote ${library.creatures.length} creatures and ${library.items.length} items ` +
    `(library v${library.version}) to ${path.relative(repoRoot, outFile)}`,
);
