/**
 * Seeds the bundled SRD-2024 standard library into the shared, campaign-independent space
 * (`campaign_id = null`). These records appear in every campaign's Creatures and Items lists via
 * the "standard" source filter, without being copied into each campaign.
 *
 * Seeding is idempotent: standard records use deterministic ids (see `srdEntityId`) and are written
 * with INSERT OR REPLACE, so re-running refreshes the standard set and never touches custom records.
 */
import { SRD_LIBRARY_VERSION, srdEntityId, type SrdLibrary } from "@/domain/srd2024";
import type { EntityInput } from "@/domain/types";
import type { Repositories } from "@/persistence/repositories";
import { now } from "@/persistence/repositories/common";

const LIBRARY_VERSION_KEY = "srd_library_version";
const BATCH_SIZE = 200;

export interface SrdSeedResult {
  seeded: boolean;
  creatures: number;
  items: number;
  version: number;
}

/**
 * Loads the bundled library lazily so the ~2 MB dataset is code-split out of the main bundle and
 * only parsed when seeding actually needs it (once per database, at boot).
 */
async function library(): Promise<SrdLibrary> {
  const mod = await import("./srd2024.data.json");
  return (mod.default ?? mod) as unknown as SrdLibrary;
}

/** Total number of standard records bundled with the app. */
export async function srdLibrarySize(): Promise<{ creatures: number; items: number }> {
  const lib = await library();
  return { creatures: lib.creatures.length, items: lib.items.length };
}

/** How many standard records are currently present in the database. */
export async function countStandardRecords(repos: Repositories): Promise<number> {
  const rows = await repos.driver.select<{ n: number }>(
    "SELECT count(*) AS n FROM entities WHERE campaign_id IS NULL AND COALESCE(json_extract(fields, '$.source'), '') != ''",
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Imports (or refreshes) the standard library when it is missing or out of date. Safe to call on
 * every launch; it returns early once the installed version matches the bundle.
 */
export async function seedSrdLibrary(repos: Repositories, options: { force?: boolean } = {}): Promise<SrdSeedResult> {
  const installed = await repos.settings.get<number>(LIBRARY_VERSION_KEY, 0);
  const present = await countStandardRecords(repos);
  if (!options.force && installed >= SRD_LIBRARY_VERSION && present > 0) {
    return { seeded: false, creatures: 0, items: 0, version: installed };
  }

  const lib = await library();
  const inputs: EntityInput[] = [...lib.creatures, ...lib.items];
  const timestamp = now();
  const statements = inputs.map((input) => {
    const id = input.id ?? srdEntityId(input.name);
    return repos.entities.insertStatement({ ...input, campaign_id: null }, id, timestamp, { orReplace: true }).statement;
  });

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await repos.driver.batch(statements.slice(i, i + BATCH_SIZE));
  }

  await repos.settings.set(LIBRARY_VERSION_KEY, SRD_LIBRARY_VERSION);
  return { seeded: true, creatures: lib.creatures.length, items: lib.items.length, version: SRD_LIBRARY_VERSION };
}
