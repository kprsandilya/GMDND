import { z } from "zod";
import type { Row, SqlDriver, Statement } from "./driver";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { newId } from "./repositories/common";

/**
 * Versioned campaign export format. A bundle holds the raw rows of every table scoped to one
 * campaign plus the list of managed assets they reference; the Rust side zips it with the files.
 * On import every id is remapped so a bundle can be imported next to its original without clashes.
 */
export const CAMPAIGN_FORMAT = "dm-workbench-campaign";
export const CAMPAIGN_FORMAT_VERSION = 1;

/** Tables in dependency order (parents first). */
export const EXPORT_TABLES = [
  "entities",
  "entity_links",
  "world_maps",
  "map_feature_links",
  "map_annotations",
  "dungeon_floors",
  "rooms",
  "doors",
  "map_objects",
  "tokens",
  "map_markers",
  "item_instances",
  "inventory_log",
  "encounter_participants",
  "encounter_runs",
  "combatants",
  "quest_objectives",
  "timeline_events",
  "session_notes",
  "campaign_log",
  "assets",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export interface CampaignBundle {
  format: typeof CAMPAIGN_FORMAT;
  version: number;
  schema_version: number;
  exported_at: string;
  app_version: string;
  campaign_id: string;
  campaign_name: string;
  tables: Record<ExportTable, Row[]>;
  assets: { rel_path: string; kind: string }[];
}

const rowSchema = z.object({ id: z.string() }).catchall(z.unknown());

export const bundleSchema = z.object({
  format: z.literal(CAMPAIGN_FORMAT),
  version: z.number().int().min(1).max(CAMPAIGN_FORMAT_VERSION),
  schema_version: z.number().int().min(1),
  exported_at: z.string(),
  app_version: z.string(),
  campaign_id: z.string().min(1),
  campaign_name: z.string(),
  tables: z.object(Object.fromEntries(EXPORT_TABLES.map((t) => [t, z.array(rowSchema).default([])])) as Record<ExportTable, z.ZodDefault<z.ZodArray<typeof rowSchema>>>),
  assets: z.array(z.object({ rel_path: z.string(), kind: z.string() })).default([]),
});

const FLOOR_SCOPED = ["rooms", "doors", "map_objects", "tokens", "map_markers"] as const;

export async function exportCampaign(driver: SqlDriver, campaignId: string, appVersion: string): Promise<CampaignBundle> {
  const campaign = (await driver.select("SELECT * FROM entities WHERE id = ?", [campaignId]))[0];
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const tables = {} as Record<ExportTable, Row[]>;
  tables.entities = await driver.select("SELECT * FROM entities WHERE id = ? OR campaign_id = ? ORDER BY created_at", [campaignId, campaignId]);
  tables.entity_links = await driver.select(
    "SELECT l.* FROM entity_links l JOIN entities a ON a.id = l.from_id JOIN entities b ON b.id = l.to_id WHERE (a.campaign_id = ? OR a.id = ?) AND (b.campaign_id = ? OR b.id = ?)",
    [campaignId, campaignId, campaignId, campaignId],
  );
  tables.world_maps = await driver.select("SELECT * FROM world_maps WHERE campaign_id = ?", [campaignId]);
  tables.map_feature_links = await driver.select("SELECT f.* FROM map_feature_links f JOIN world_maps m ON m.id = f.map_id WHERE m.campaign_id = ?", [campaignId]);
  tables.map_annotations = await driver.select("SELECT a.* FROM map_annotations a JOIN world_maps m ON m.id = a.map_id WHERE m.campaign_id = ?", [campaignId]);
  tables.dungeon_floors = await driver.select("SELECT f.* FROM dungeon_floors f JOIN entities d ON d.id = f.dungeon_id WHERE d.campaign_id = ?", [campaignId]);
  for (const table of FLOOR_SCOPED) {
    tables[table] = await driver.select(
      `SELECT t.* FROM ${table} t JOIN dungeon_floors f ON f.id = t.floor_id JOIN entities d ON d.id = f.dungeon_id WHERE d.campaign_id = ?`,
      [campaignId],
    );
  }
  tables.item_instances = await driver.select("SELECT * FROM item_instances WHERE campaign_id = ?", [campaignId]);
  tables.inventory_log = await driver.select("SELECT * FROM inventory_log WHERE campaign_id = ?", [campaignId]);
  tables.encounter_participants = await driver.select("SELECT p.* FROM encounter_participants p JOIN entities e ON e.id = p.encounter_id WHERE e.campaign_id = ?", [campaignId]);
  tables.encounter_runs = await driver.select("SELECT * FROM encounter_runs WHERE campaign_id = ?", [campaignId]);
  tables.combatants = await driver.select("SELECT c.* FROM combatants c JOIN encounter_runs r ON r.id = c.run_id WHERE r.campaign_id = ?", [campaignId]);
  tables.quest_objectives = await driver.select("SELECT o.* FROM quest_objectives o JOIN entities q ON q.id = o.quest_id WHERE q.campaign_id = ?", [campaignId]);
  tables.timeline_events = await driver.select("SELECT * FROM timeline_events WHERE campaign_id = ?", [campaignId]);
  tables.session_notes = await driver.select("SELECT * FROM session_notes WHERE campaign_id = ?", [campaignId]);
  tables.campaign_log = await driver.select("SELECT * FROM campaign_log WHERE campaign_id = ?", [campaignId]);
  tables.assets = await driver.select("SELECT * FROM assets WHERE campaign_id = ?", [campaignId]);

  const assetPaths = new Set<string>();
  for (const row of tables.assets) if (typeof row.rel_path === "string") assetPaths.add(row.rel_path);
  for (const row of tables.world_maps) if (typeof row.map_asset === "string") assetPaths.add(row.map_asset);
  for (const row of tables.entities) if (typeof row.image_asset === "string") assetPaths.add(row.image_asset);
  for (const row of tables.dungeon_floors) if (typeof row.background_asset === "string") assetPaths.add(row.background_asset);
  const assetKinds = new Map(tables.assets.map((a) => [String(a.rel_path), String(a.kind)]));

  return {
    format: CAMPAIGN_FORMAT,
    version: CAMPAIGN_FORMAT_VERSION,
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app_version: appVersion,
    campaign_id: campaignId,
    campaign_name: String(campaign.name),
    tables,
    assets: [...assetPaths].map((rel_path) => ({ rel_path, kind: assetKinds.get(rel_path) ?? "file" })),
  };
}

export interface ImportPlan {
  statements: Statement[];
  idMap: Map<string, string>;
  assetMap: { from: string; to: string }[];
  newCampaignId: string;
  counts: Record<string, number>;
  warnings: string[];
}

/** Validates a bundle, remaps every id and asset path, and produces the statements to insert it. */
export async function planImport(driver: SqlDriver, raw: unknown, options: { renameTo?: string } = {}): Promise<ImportPlan> {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid campaign file: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const bundle = parsed.data;
  if (bundle.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`This file was exported by a newer version (schema ${bundle.schema_version}); update the application first.`);
  }
  const warnings: string[] = [];
  const idMap = new Map<string, string>();
  for (const table of EXPORT_TABLES) for (const row of bundle.tables[table]) if (!idMap.has(row.id)) idMap.set(row.id, newId());

  const assetMap: { from: string; to: string }[] = [];
  const assetPathMap = new Map<string, string>();
  for (const asset of bundle.assets) {
    const ext = asset.rel_path.includes(".") ? asset.rel_path.slice(asset.rel_path.lastIndexOf(".")) : "";
    const category = asset.rel_path.includes("/") ? asset.rel_path.slice(0, asset.rel_path.indexOf("/")) : "imported";
    const to = `${category}/${newId()}${ext}`;
    assetPathMap.set(asset.rel_path, to);
    assetMap.push({ from: asset.rel_path, to });
  }

  const remapValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (idMap.has(value)) return idMap.get(value);
      if (assetPathMap.has(value)) return assetPathMap.get(value);
      if ((value.startsWith("{") || value.startsWith("[")) && value.length > 1) {
        try {
          const inner = JSON.parse(value);
          return JSON.stringify(remapValue(inner));
        } catch {
          return value;
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(remapValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remapValue(v)]));
    return value;
  };

  const statements: Statement[] = [{ sql: "PRAGMA defer_foreign_keys = ON" }];
  const counts: Record<string, number> = {};
  for (const table of EXPORT_TABLES) {
    const columns = new Set((await driver.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const row of bundle.tables[table]) {
      const entries = Object.entries(row).filter(([key]) => columns.has(key));
      const dropped = Object.keys(row).filter((key) => !columns.has(key));
      if (dropped.length) warnings.push(`${table}: ignored unknown columns ${dropped.join(", ")}`);
      const remapped = entries.map(([key, value]) => {
        let v = remapValue(value);
        if (table === "entities" && key === "name" && row.id === bundle.campaign_id && options.renameTo) v = options.renameTo;
        return [key, v] as const;
      });
      statements.push({
        sql: `INSERT INTO ${table} (${remapped.map(([k]) => k).join(", ")}) VALUES (${remapped.map(() => "?").join(", ")})`,
        params: remapped.map(([, v]) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean))),
      });
      counts[table] = (counts[table] ?? 0) + 1;
    }
  }
  const newCampaignId = idMap.get(bundle.campaign_id);
  if (!newCampaignId) throw new Error("Campaign file does not contain its campaign record.");
  return { statements, idMap, assetMap, newCampaignId, counts, warnings: [...new Set(warnings)] };
}

export async function applyImport(driver: SqlDriver, plan: ImportPlan): Promise<void> {
  await driver.batch(plan.statements);
}

/** Dangling references after deletions are tolerated by the schema (SET NULL); this reports them for the UI. */
export async function findMissingReferences(driver: SqlDriver, campaignId: string): Promise<{ table: string; column: string; count: number }[]> {
  const checks: [string, string, string][] = [
    ["map_feature_links", "entity_id", "SELECT count(*) AS n FROM map_feature_links f JOIN world_maps m ON m.id = f.map_id WHERE m.campaign_id = ? AND f.entity_id NOT IN (SELECT id FROM entities)"],
    ["map_objects", "entity_id", "SELECT count(*) AS n FROM map_objects o JOIN dungeon_floors fl ON fl.id = o.floor_id JOIN entities d ON d.id = fl.dungeon_id WHERE d.campaign_id = ? AND o.entity_id IS NOT NULL AND o.entity_id NOT IN (SELECT id FROM entities)"],
    ["tokens", "entity_id", "SELECT count(*) AS n FROM tokens t JOIN dungeon_floors fl ON fl.id = t.floor_id JOIN entities d ON d.id = fl.dungeon_id WHERE d.campaign_id = ? AND t.entity_id IS NULL"],
    ["map_markers", "encounter_id", "SELECT count(*) AS n FROM map_markers mk JOIN dungeon_floors fl ON fl.id = mk.floor_id JOIN entities d ON d.id = fl.dungeon_id WHERE d.campaign_id = ? AND mk.kind = 'encounter' AND mk.encounter_id IS NULL"],
    ["encounter_runs", "encounter_id", "SELECT count(*) AS n FROM encounter_runs WHERE campaign_id = ? AND encounter_id IS NULL"],
  ];
  const results: { table: string; column: string; count: number }[] = [];
  for (const [table, column, sql] of checks) {
    const rows = await driver.select<{ n: number }>(sql, [campaignId]);
    const count = Number(rows[0]?.n ?? 0);
    if (count > 0) results.push({ table, column, count });
  }
  return results;
}
