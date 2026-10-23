import type { FeatureType, MapAnnotation, MapFeatureLink, WorldMap } from "@/domain/types";
import type { Row, SqlDriver } from "../driver";
import { bool, buildSet, int, newId, now, num, requireRow, str, text } from "./common";

export function mapWorldMap(row: Row): WorldMap {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    world_id: str(row.world_id),
    name: text(row.name),
    map_asset: str(row.map_asset),
    seed: str(row.seed),
    fmg_version: str(row.fmg_version),
    map_created: num(row.map_created),
    width: num(row.width),
    height: num(row.height),
    notes: text(row.notes),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapFeatureLink(row: Row): MapFeatureLink {
  return {
    id: String(row.id),
    map_id: String(row.map_id),
    feature_type: String(row.feature_type) as FeatureType,
    feature_id: num(row.feature_id),
    feature_name: str(row.feature_name),
    x: num(row.x),
    y: num(row.y),
    entity_id: String(row.entity_id),
    created_at: text(row.created_at),
  };
}

export function mapAnnotation(row: Row): MapAnnotation {
  return {
    id: String(row.id),
    map_id: String(row.map_id),
    x: Number(row.x),
    y: Number(row.y),
    kind: String(row.kind) as MapAnnotation["kind"],
    title: text(row.title),
    body_md: text(row.body_md),
    entity_id: str(row.entity_id),
    color: str(row.color),
    hidden: bool(row.hidden),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export interface WorldMapInput {
  id?: string;
  campaign_id: string;
  world_id?: string | null;
  name: string;
  map_asset?: string | null;
  seed?: string | null;
  fmg_version?: string | null;
  map_created?: number | null;
  width?: number | null;
  height?: number | null;
  notes?: string;
}

export class WorldMapRepository {
  constructor(private readonly db: SqlDriver) {}

  async create(input: WorldMapInput): Promise<WorldMap> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO world_maps (id, campaign_id, world_id, name, map_asset, seed, fmg_version, map_created, width, height, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.campaign_id,
        input.world_id ?? null,
        input.name,
        input.map_asset ?? null,
        input.seed ?? null,
        input.fmg_version ?? null,
        input.map_created ?? null,
        input.width ?? null,
        input.height ?? null,
        input.notes ?? "",
        ts,
        ts,
      ],
    );
    return this.get(id);
  }

  async get(id: string): Promise<WorldMap> {
    const rows = await this.db.select("SELECT * FROM world_maps WHERE id = ?", [id]);
    return mapWorldMap(requireRow(rows, "World map", id));
  }

  async find(id: string | null | undefined): Promise<WorldMap | null> {
    if (!id) return null;
    const rows = await this.db.select("SELECT * FROM world_maps WHERE id = ?", [id]);
    return rows[0] ? mapWorldMap(rows[0]) : null;
  }

  async list(campaignId: string): Promise<WorldMap[]> {
    const rows = await this.db.select("SELECT * FROM world_maps WHERE campaign_id = ? ORDER BY name COLLATE NOCASE", [campaignId]);
    return rows.map(mapWorldMap);
  }

  async update(id: string, patch: Partial<Omit<WorldMap, "id" | "created_at">>): Promise<WorldMap> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() });
    if (!empty) await this.db.execute(`UPDATE world_maps SET ${set} WHERE id = ?`, [...params, id]);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute("DELETE FROM world_maps WHERE id = ?", [id]);
  }

  // ---- feature links ----

  async linkFeature(input: Omit<MapFeatureLink, "id" | "created_at">): Promise<MapFeatureLink> {
    const id = newId();
    await this.db.execute(
      `INSERT INTO map_feature_links (id, map_id, feature_type, feature_id, feature_name, x, y, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(map_id, feature_type, feature_id, entity_id) DO UPDATE SET feature_name = excluded.feature_name, x = excluded.x, y = excluded.y`,
      [id, input.map_id, input.feature_type, input.feature_id, input.feature_name, input.x, input.y, input.entity_id, now()],
    );
    const rows = await this.db.select(
      "SELECT * FROM map_feature_links WHERE map_id = ? AND feature_type = ? AND feature_id IS ? AND entity_id = ?",
      [input.map_id, input.feature_type, input.feature_id, input.entity_id],
    );
    return mapFeatureLink(requireRow(rows, "Feature link", id));
  }

  async unlinkFeature(id: string): Promise<void> {
    await this.db.execute("DELETE FROM map_feature_links WHERE id = ?", [id]);
  }

  async featureLinks(mapId: string): Promise<MapFeatureLink[]> {
    const rows = await this.db.select("SELECT * FROM map_feature_links WHERE map_id = ?", [mapId]);
    return rows.map(mapFeatureLink);
  }

  async featureLinksForEntity(entityId: string): Promise<MapFeatureLink[]> {
    const rows = await this.db.select("SELECT * FROM map_feature_links WHERE entity_id = ?", [entityId]);
    return rows.map(mapFeatureLink);
  }

  async updateFeatureLink(id: string, patch: Partial<Pick<MapFeatureLink, "feature_id" | "feature_name" | "x" | "y">>): Promise<void> {
    const { set, params, empty } = buildSet(patch);
    if (!empty) await this.db.execute(`UPDATE map_feature_links SET ${set} WHERE id = ?`, [...params, id]);
  }

  // ---- annotations ----

  async addAnnotation(input: Omit<MapAnnotation, "id" | "created_at" | "updated_at">): Promise<MapAnnotation> {
    const id = newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO map_annotations (id, map_id, x, y, kind, title, body_md, entity_id, color, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.map_id, input.x, input.y, input.kind, input.title, input.body_md, input.entity_id, input.color, int(input.hidden), ts, ts],
    );
    return this.getAnnotation(id);
  }

  async getAnnotation(id: string): Promise<MapAnnotation> {
    const rows = await this.db.select("SELECT * FROM map_annotations WHERE id = ?", [id]);
    return mapAnnotation(requireRow(rows, "Annotation", id));
  }

  async annotations(mapId: string): Promise<MapAnnotation[]> {
    const rows = await this.db.select("SELECT * FROM map_annotations WHERE map_id = ? ORDER BY created_at", [mapId]);
    return rows.map(mapAnnotation);
  }

  async updateAnnotation(id: string, patch: Partial<Omit<MapAnnotation, "id" | "created_at">>): Promise<MapAnnotation> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { hidden: int });
    if (!empty) await this.db.execute(`UPDATE map_annotations SET ${set} WHERE id = ?`, [...params, id]);
    return this.getAnnotation(id);
  }

  async deleteAnnotation(id: string): Promise<void> {
    await this.db.execute("DELETE FROM map_annotations WHERE id = ?", [id]);
  }
}
