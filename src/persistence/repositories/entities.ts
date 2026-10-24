import type { Waypoint } from "@/domain/journeyTypes";
import { normalizeFields } from "@/domain/schemas";
import type { Entity, EntityInput, EntityKind, EntityLink, LinkedEntity } from "@/domain/types";
import type { Row, SqlDriver, Statement } from "../driver";
import { buildSet, int, json, newId, now, num, parseJson, requireRow, str, text } from "./common";

export function mapEntity(row: Row): Entity {
  return {
    id: String(row.id),
    campaign_id: str(row.campaign_id),
    world_id: str(row.world_id),
    parent_id: str(row.parent_id),
    kind: String(row.kind) as EntityKind,
    subtype: str(row.subtype),
    name: text(row.name),
    summary: text(row.summary),
    body_md: text(row.body_md),
    read_aloud_md: text(row.read_aloud_md),
    dm_notes_md: text(row.dm_notes_md),
    secret_md: text(row.secret_md),
    tags: parseJson<string[]>(row.tags, []),
    fields: parseJson<Record<string, unknown>>(row.fields, {}),
    status: str(row.status),
    sort_order: num(row.sort_order) ?? 0,
    image_asset: str(row.image_asset),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export interface EntityQuery {
  campaign_id?: string | null;
  kinds?: EntityKind[];
  parent_id?: string | null;
  world_id?: string;
  search?: string;
  tag?: string;
  status?: string;
  limit?: number;
  orderBy?: "name" | "updated_at" | "sort_order" | "created_at";
  /**
   * When true, campaign-independent library records (`campaign_id IS NULL`, e.g. the bundled
   * SRD-2024 set) are returned alongside the campaign's own records. Ignored unless `campaign_id`
   * is a concrete id.
   */
  include_shared?: boolean;
  /**
   * Filter by provenance. "standard" = bundled library records (non-empty `fields.source`);
   * "custom" = records with no source; "all"/undefined = both.
   */
  source?: "standard" | "custom" | "all";
}

export interface SearchHit {
  entity: Entity;
  snippet: string;
  field: string;
}

const ENTITY_COLUMNS =
  "id, campaign_id, world_id, parent_id, kind, subtype, name, summary, body_md, read_aloud_md, dm_notes_md, secret_md, tags, fields, status, sort_order, image_asset, created_at, updated_at";

export class EntityRepository {
  constructor(private readonly db: SqlDriver) { }

  /** Returns the INSERT statement for an entity so callers can include it in a batch. */
  insertStatement(
    input: EntityInput,
    id = input.id ?? newId(),
    timestamp = now(),
    opts: { orReplace?: boolean } = {},
  ): { id: string; statement: Statement } {
    const fields = normalizeFields(input.kind, input.fields ?? {});
    return {
      id,
      statement: {
        sql: `INSERT ${opts.orReplace ? "OR REPLACE " : ""}INTO entities (${ENTITY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          input.campaign_id ?? null,
          input.world_id ?? null,
          input.parent_id ?? null,
          input.kind,
          input.subtype ?? null,
          input.name,
          input.summary ?? "",
          input.body_md ?? "",
          input.read_aloud_md ?? "",
          input.dm_notes_md ?? "",
          input.secret_md ?? "",
          json(input.tags ?? []),
          json(fields),
          input.status ?? null,
          input.sort_order ?? 0,
          input.image_asset ?? null,
          timestamp,
          timestamp,
        ],
      },
    };
  }

  async create(input: EntityInput): Promise<Entity> {
    const { id, statement } = this.insertStatement(input);
    await this.db.execute(statement.sql, statement.params);
    return this.get(id);
  }

  async get(id: string): Promise<Entity> {
    const rows = await this.db.select(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = ?`, [id]);
    return mapEntity(requireRow(rows, "Entity", id));
  }

  async find(id: string | null | undefined): Promise<Entity | null> {
    if (!id) return null;
    const rows = await this.db.select(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = ?`, [id]);
    return rows[0] ? mapEntity(rows[0]) : null;
  }

  async getMany(ids: string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const rows = await this.db.select(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id IN (${unique.map(() => "?").join(",")})`,
      unique,
    );
    return rows.map(mapEntity);
  }

  async update(id: string, patch: Partial<Omit<Entity, "id" | "created_at">>): Promise<Entity> {
    const existing = await this.get(id);
    const merged: Record<string, unknown> = { ...patch };
    if (patch.fields !== undefined) merged.fields = normalizeFields(patch.kind ?? existing.kind, patch.fields);
    merged.updated_at = now();
    const { set, params, empty } = buildSet(merged, { tags: json, fields: json });
    if (empty) return existing;
    await this.db.execute(`UPDATE entities SET ${set} WHERE id = ?`, [...params, id]);
    return this.get(id);
  }

  async touch(id: string): Promise<void> {
    await this.db.execute("UPDATE entities SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  async delete(id: string): Promise<void> {
    // Clean up waypoint JSON arrays referencing this entity before deleting it.
    // FK CASCADE handles segment_participants and party_memberships automatically,
    // but waypoints are stored as JSON inside travel_segments and need manual cleanup.
    const rows = await this.db.select(
      "SELECT id, waypoints FROM travel_segments WHERE waypoints LIKE ?",
      [`%${id}%`],
    );
    for (const row of rows) {
      const waypoints = parseJson<Waypoint[]>(row.waypoints, []);
      const filtered = waypoints.filter((wp) => wp.entity_id !== id);
      if (filtered.length !== waypoints.length) {
        await this.db.execute(
          "UPDATE travel_segments SET waypoints = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(filtered), now(), String(row.id)],
        );
      }
    }

    await this.db.execute("DELETE FROM entities WHERE id = ?", [id]);
  }

  async list(query: EntityQuery = {}): Promise<Entity[]> {
    const where: string[] = [];
    const params: (string | number | null)[] = [];
    if (query.campaign_id !== undefined) {
      if (query.campaign_id === null) where.push("campaign_id IS NULL");
      else if (query.include_shared) {
        // The campaign's own records plus the shared, campaign-independent library.
        where.push("(campaign_id = ? OR campaign_id IS NULL)");
        params.push(query.campaign_id);
      } else {
        where.push("campaign_id = ?");
        params.push(query.campaign_id);
      }
    }
    if (query.source === "standard") {
      where.push("COALESCE(json_extract(fields, '$.source'), '') != ''");
    } else if (query.source === "custom") {
      where.push("COALESCE(json_extract(fields, '$.source'), '') = ''");
    }
    if (query.kinds && query.kinds.length > 0) {
      where.push(`kind IN (${query.kinds.map(() => "?").join(",")})`);
      params.push(...query.kinds);
    }
    if (query.parent_id !== undefined) {
      if (query.parent_id === null) where.push("parent_id IS NULL");
      else {
        where.push("parent_id = ?");
        params.push(query.parent_id);
      }
    }
    if (query.world_id) {
      where.push("world_id = ?");
      params.push(query.world_id);
    }
    if (query.status) {
      where.push("status = ?");
      params.push(query.status);
    }
    if (query.search) {
      where.push("(name LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE)");
      const like = `%${query.search}%`;
      params.push(like, like);
    }
    if (query.tag) {
      where.push("tags LIKE ?");
      params.push(`%${JSON.stringify(query.tag)}%`);
    }
    const order =
      query.orderBy === "updated_at"
        ? "updated_at DESC"
        : query.orderBy === "created_at"
          ? "created_at DESC"
          : query.orderBy === "sort_order"
            ? "sort_order ASC, name COLLATE NOCASE ASC"
            : "name COLLATE NOCASE ASC";
    const sql = `SELECT ${ENTITY_COLUMNS} FROM entities ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} ${query.limit ? `LIMIT ${Math.max(1, Math.floor(query.limit))}` : ""
      }`;
    const rows = await this.db.select(sql, params);
    return rows.map(mapEntity);
  }

  async children(parentId: string): Promise<Entity[]> {
    return this.list({ parent_id: parentId, orderBy: "sort_order" });
  }

  /** Walks parent_id up to the root for breadcrumbs. */
  async ancestors(id: string): Promise<Entity[]> {
    const chain: Entity[] = [];
    let current = await this.find(id);
    const seen = new Set<string>();
    while (current?.parent_id && !seen.has(current.parent_id)) {
      seen.add(current.parent_id);
      const parent = await this.find(current.parent_id);
      if (!parent) break;
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  }

  async countByKind(campaignId: string): Promise<Record<string, number>> {
    const rows = await this.db.select<{ kind: string; n: number }>(
      "SELECT kind, count(*) AS n FROM entities WHERE campaign_id = ? GROUP BY kind",
      [campaignId],
    );
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  }

  /** Full-text-ish search across name, summary, body, notes and secrets, with a snippet. */
  async search(campaignId: string | null, term: string, limit = 40): Promise<SearchHit[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];
    const like = `%${trimmed}%`;
    const params: (string | number)[] = [];
    let scope = "";
    if (campaignId) {
      scope = "(campaign_id = ? OR id = ?) AND";
      params.push(campaignId, campaignId);
    }
    const rows = await this.db.select(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE ${scope} (
        name LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE OR body_md LIKE ? COLLATE NOCASE OR
        dm_notes_md LIKE ? COLLATE NOCASE OR secret_md LIKE ? COLLATE NOCASE OR read_aloud_md LIKE ? COLLATE NOCASE OR tags LIKE ? COLLATE NOCASE
      ) ORDER BY CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?`,
      [...params, like, like, like, like, like, like, like, like, limit],
    );
    const lower = trimmed.toLowerCase();
    return rows.map(mapEntity).map((entity) => {
      const candidates: [string, string][] = [
        ["name", entity.name],
        ["summary", entity.summary],
        ["description", entity.body_md],
        ["read-aloud", entity.read_aloud_md],
        ["DM notes", entity.dm_notes_md],
        ["secret", entity.secret_md],
        ["tags", entity.tags.join(", ")],
      ];
      for (const [field, value] of candidates) {
        const index = value.toLowerCase().indexOf(lower);
        if (index >= 0) {
          const start = Math.max(0, index - 50);
          const snippet = `${start > 0 ? "…" : ""}${value.slice(start, index + trimmed.length + 70)}${index + trimmed.length + 70 < value.length ? "…" : ""
            }`;
          return { entity, field, snippet: snippet.replace(/\s+/g, " ") };
        }
      }
      return { entity, field: "name", snippet: entity.summary };
    });
  }

  // ---- links ----

  linkStatement(fromId: string, toId: string, relation = "related", note = ""): Statement {
    return {
      sql: "INSERT OR IGNORE INTO entity_links (id, from_id, to_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: [newId(), fromId, toId, relation, note, now()],
    };
  }

  async link(fromId: string, toId: string, relation = "related", note = ""): Promise<EntityLink | null> {
    if (fromId === toId) return null;
    const statement = this.linkStatement(fromId, toId, relation, note);
    await this.db.execute(statement.sql, statement.params);
    const rows = await this.db.select("SELECT * FROM entity_links WHERE from_id = ? AND to_id = ? AND relation = ?", [
      fromId,
      toId,
      relation,
    ]);
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async unlink(linkId: string): Promise<void> {
    await this.db.execute("DELETE FROM entity_links WHERE id = ?", [linkId]);
  }

  /** Outgoing links and backlinks for an entity, each with the other entity loaded. */
  async linksFor(id: string): Promise<LinkedEntity[]> {
    const rows = await this.db.select(
      `SELECT l.id AS link_id, l.from_id, l.to_id, l.relation, l.note, l.created_at AS link_created,
              CASE WHEN l.from_id = ? THEN 'out' ELSE 'in' END AS direction,
              e.*
       FROM entity_links l
       JOIN entities e ON e.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
       WHERE l.from_id = ? OR l.to_id = ?
       ORDER BY direction, l.relation, e.name COLLATE NOCASE`,
      [id, id, id, id],
    );
    return rows.map((row) => ({
      id: String(row.link_id),
      from_id: String(row.from_id),
      to_id: String(row.to_id),
      relation: text(row.relation),
      note: text(row.note),
      created_at: text(row.link_created),
      direction: row.direction as "out" | "in",
      entity: mapEntity(row),
    }));
  }

  /** Entities whose Markdown mentions `[[Name]]` of this entity: implicit backlinks. */
  async mentions(entity: Entity): Promise<Entity[]> {
    const pattern = `%[[${entity.name}%`;
    const rows = await this.db.select(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id != ? AND (campaign_id = ? OR campaign_id IS NULL) AND (
         body_md LIKE ? OR dm_notes_md LIKE ? OR secret_md LIKE ? OR read_aloud_md LIKE ? OR summary LIKE ?
       ) ORDER BY name COLLATE NOCASE LIMIT 50`,
      [entity.id, entity.campaign_id, pattern, pattern, pattern, pattern, pattern],
    );
    return rows.map(mapEntity);
  }

  async findByName(campaignId: string | null, name: string): Promise<Entity | null> {
    const rows = await this.db.select(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE (campaign_id = ? OR id = ?) AND name = ? COLLATE NOCASE LIMIT 1`,
      [campaignId, campaignId, name],
    );
    return rows[0] ? mapEntity(rows[0]) : null;
  }
}

export function mapLink(row: Row): EntityLink {
  return {
    id: String(row.id),
    from_id: String(row.from_id),
    to_id: String(row.to_id),
    relation: text(row.relation),
    note: text(row.note),
    created_at: text(row.created_at),
  };
}

export { int };
