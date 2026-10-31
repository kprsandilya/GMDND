import type {
  Door,
  DungeonFloor,
  Entity,
  InteractionDefinition,
  MapMarker,
  MapObject,
  ObjectState,
  Room,
  RoomState,
  TerrainCell,
  Token,
  WallSegment,
} from "@/domain/types";
import type { Row, SqlDriver, Statement } from "../driver";
import { bool, buildSet, int, json, newId, now, num, parseJson, requireRow, str, text } from "./common";
import { EntityRepository, mapEntity } from "./entities";

export function mapFloor(row: Row): DungeonFloor {
  return {
    id: String(row.id),
    dungeon_id: String(row.dungeon_id),
    name: text(row.name),
    level: num(row.level) ?? 0,
    width: Number(row.width),
    height: Number(row.height),
    cell_feet: num(row.cell_feet) ?? 5,
    walls: parseJson<WallSegment[]>(row.walls, []),
    terrain: parseJson<TerrainCell[]>(row.terrain, []),
    background_asset: str(row.background_asset),
    notes_md: text(row.notes_md),
    sort_order: num(row.sort_order) ?? 0,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapRoom(row: Row): Room {
  return {
    id: String(row.id),
    floor_id: String(row.floor_id),
    number: str(row.number),
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    lighting: text(row.lighting),
    terrain: text(row.terrain),
    state: parseJson<RoomState>(row.state, {}),
    color: str(row.color),
    entity: mapEntity(row),
  };
}

export function mapDoor(row: Row): Door {
  return {
    id: String(row.id),
    floor_id: String(row.floor_id),
    x: Number(row.x),
    y: Number(row.y),
    orientation: (row.orientation as "h" | "v") ?? "h",
    kind: String(row.kind) as Door["kind"],
    state: String(row.state) as Door["state"],
    lock_dc: num(row.lock_dc),
    key_item_id: str(row.key_item_id),
    room_a: str(row.room_a),
    room_b: str(row.room_b),
    target_floor_id: str(row.target_floor_id),
    hidden: bool(row.hidden),
    discovered: bool(row.discovered),
    notes: text(row.notes),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapObject(row: Row): MapObject {
  return {
    id: String(row.id),
    floor_id: String(row.floor_id),
    room_id: str(row.room_id),
    kind: String(row.kind) as MapObject["kind"],
    name: text(row.name),
    x: Number(row.x),
    y: Number(row.y),
    w: num(row.w) ?? 1,
    h: num(row.h) ?? 1,
    rotation: num(row.rotation) ?? 0,
    state: parseJson<ObjectState>(row.state, {}),
    hidden: bool(row.hidden),
    discovered: bool(row.discovered),
    interactions: parseJson<InteractionDefinition[]>(row.interactions, []),
    entity_id: str(row.entity_id),
    notes: text(row.notes),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapToken(row: Row): Token {
  return {
    id: String(row.id),
    floor_id: String(row.floor_id),
    entity_id: str(row.entity_id),
    name: text(row.name),
    kind: String(row.kind) as Token["kind"],
    x: Number(row.x),
    y: Number(row.y),
    size: num(row.size) ?? 1,
    color: str(row.color),
    hidden: bool(row.hidden),
    hp: num(row.hp),
    max_hp: num(row.max_hp),
    conditions: parseJson<string[]>(row.conditions, []),
    speed: num(row.speed) ?? 30,
    movement_used: num(row.movement_used) ?? 0,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapMarker(row: Row): MapMarker {
  return {
    id: String(row.id),
    floor_id: String(row.floor_id),
    room_id: str(row.room_id),
    kind: String(row.kind) as MapMarker["kind"],
    title: text(row.title),
    body_md: text(row.body_md),
    x: Number(row.x),
    y: Number(row.y),
    w: num(row.w) ?? 1,
    h: num(row.h) ?? 1,
    trigger: String(row.trigger) as MapMarker["trigger"],
    trigger_ref: str(row.trigger_ref),
    entity_id: str(row.entity_id),
    encounter_id: str(row.encounter_id),
    dm_only: bool(row.dm_only),
    enabled: bool(row.enabled),
    activated: bool(row.activated),
    activated_at: str(row.activated_at),
    activation_count: num(row.activation_count) ?? 0,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export interface FloorData {
  floor: DungeonFloor;
  rooms: Room[];
  doors: Door[];
  objects: MapObject[];
  tokens: Token[];
  markers: MapMarker[];
}

type FloorInput = {
  id?: string;
  dungeon_id: string;
  name: string;
  level?: number;
  width: number;
  height: number;
  cell_feet?: number;
  walls?: WallSegment[];
  terrain?: TerrainCell[];
  sort_order?: number;
};

export type RoomInput = {
  id?: string;
  floor_id: string;
  campaign_id: string | null;
  dungeon_id: string;
  name: string;
  number?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  lighting?: string;
  terrain?: string;
  state?: RoomState;
  color?: string | null;
  summary?: string;
  body_md?: string;
  read_aloud_md?: string;
  dm_notes_md?: string;
  secret_md?: string;
  fields?: Record<string, unknown>;
};

export type DoorInput = Partial<Omit<Door, "created_at" | "updated_at">> & Pick<Door, "floor_id" | "x" | "y">;
export type ObjectInput = Partial<Omit<MapObject, "created_at" | "updated_at">> & Pick<MapObject, "floor_id" | "x" | "y" | "name" | "kind">;
export type TokenInput = Partial<Omit<Token, "created_at" | "updated_at">> & Pick<Token, "floor_id" | "x" | "y" | "name">;
export type MarkerInput = Partial<Omit<MapMarker, "created_at" | "updated_at">> & Pick<MapMarker, "floor_id" | "x" | "y" | "title" | "kind">;

const ROOM_SELECT = `SELECT r.id, r.floor_id, r.number, r.x, r.y, r.w, r.h, r.lighting, r.terrain, r.state, r.color,
  e.campaign_id, e.world_id, e.parent_id, e.kind, e.subtype, e.name, e.summary, e.body_md, e.read_aloud_md, e.dm_notes_md, e.secret_md,
  e.tags, e.fields, e.status, e.sort_order, e.image_asset, e.created_at, e.updated_at
  FROM rooms r JOIN entities e ON e.id = r.id`;

export class DungeonRepository {
  private readonly entities: EntityRepository;

  constructor(private readonly db: SqlDriver) {
    this.entities = new EntityRepository(db);
  }

  // ---- floors ----

  async createFloor(input: FloorInput): Promise<DungeonFloor> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO dungeon_floors (id, dungeon_id, name, level, width, height, cell_feet, walls, terrain, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.dungeon_id,
        input.name,
        input.level ?? 0,
        input.width,
        input.height,
        input.cell_feet ?? 5,
        json(input.walls ?? []),
        json(input.terrain ?? []),
        input.sort_order ?? 0,
        ts,
        ts,
      ],
    );
    return this.getFloor(id);
  }

  async getFloor(id: string): Promise<DungeonFloor> {
    const rows = await this.db.select("SELECT * FROM dungeon_floors WHERE id = ?", [id]);
    return mapFloor(requireRow(rows, "Floor", id));
  }

  async findFloor(id: string | null | undefined): Promise<DungeonFloor | null> {
    if (!id) return null;
    const rows = await this.db.select("SELECT * FROM dungeon_floors WHERE id = ?", [id]);
    return rows[0] ? mapFloor(rows[0]) : null;
  }

  async floors(dungeonId: string): Promise<DungeonFloor[]> {
    const rows = await this.db.select("SELECT * FROM dungeon_floors WHERE dungeon_id = ? ORDER BY level DESC, sort_order, name", [dungeonId]);
    return rows.map(mapFloor);
  }

  async updateFloor(id: string, patch: Partial<Omit<DungeonFloor, "id" | "created_at">>): Promise<DungeonFloor> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { walls: json, terrain: json });
    if (!empty) await this.db.execute(`UPDATE dungeon_floors SET ${set} WHERE id = ?`, [...params, id]);
    return this.getFloor(id);
  }

  async deleteFloor(id: string): Promise<void> {
    // rooms are entities: cascade from rooms table does not remove the entity row, so do it explicitly
    await this.db.batch([
      { sql: "DELETE FROM entities WHERE id IN (SELECT id FROM rooms WHERE floor_id = ?)", params: [id] },
      { sql: "DELETE FROM dungeon_floors WHERE id = ?", params: [id] },
    ]);
  }

  async loadFloor(floorId: string): Promise<FloorData> {
    const [floor, rooms, doors, objects, tokens, markers] = await Promise.all([
      this.getFloor(floorId),
      this.rooms(floorId),
      this.doors(floorId),
      this.objects(floorId),
      this.tokens(floorId),
      this.markers(floorId),
    ]);
    return { floor, rooms, doors, objects, tokens, markers };
  }

  // ---- rooms ----

  async createRoom(input: RoomInput): Promise<Room> {
    const id = input.id ?? newId();
    const { statement } = this.entities.insertStatement(
      {
        id,
        kind: "room",
        name: input.name,
        campaign_id: input.campaign_id,
        parent_id: input.dungeon_id,
        summary: input.summary,
        body_md: input.body_md,
        read_aloud_md: input.read_aloud_md,
        dm_notes_md: input.dm_notes_md,
        secret_md: input.secret_md,
        fields: input.fields,
      },
      id,
    );
    await this.db.batch([
      statement,
      {
        sql: `INSERT INTO rooms (id, floor_id, number, x, y, w, h, lighting, terrain, state, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          input.floor_id,
          input.number ?? null,
          input.x,
          input.y,
          input.w,
          input.h,
          input.lighting ?? "dark",
          input.terrain ?? "stone floor",
          json(input.state ?? {}),
          input.color ?? null,
        ],
      },
    ]);
    return this.getRoom(id);
  }

  async getRoom(id: string): Promise<Room> {
    const rows = await this.db.select(`${ROOM_SELECT} WHERE r.id = ?`, [id]);
    return mapRoom(requireRow(rows, "Room", id));
  }

  async findRoom(id: string | null | undefined): Promise<Room | null> {
    if (!id) return null;
    const rows = await this.db.select(`${ROOM_SELECT} WHERE r.id = ?`, [id]);
    return rows[0] ? mapRoom(rows[0]) : null;
  }

  async rooms(floorId: string): Promise<Room[]> {
    const rows = await this.db.select(`${ROOM_SELECT} WHERE r.floor_id = ? ORDER BY r.number, e.name`, [floorId]);
    return rows.map(mapRoom);
  }

  async roomsForDungeon(dungeonId: string): Promise<Room[]> {
    const rows = await this.db.select(
      `${ROOM_SELECT} JOIN dungeon_floors f ON f.id = r.floor_id WHERE f.dungeon_id = ? ORDER BY f.level DESC, r.number, e.name`,
      [dungeonId],
    );
    return rows.map(mapRoom);
  }

  async updateRoom(
    id: string,
    patch: Partial<Pick<Room, "number" | "x" | "y" | "w" | "h" | "lighting" | "terrain" | "state" | "color">>,
    entityPatch?: Partial<Pick<Entity, "name" | "summary" | "body_md" | "read_aloud_md" | "dm_notes_md" | "secret_md" | "tags" | "fields" | "status">>,
  ): Promise<Room> {
    const { set, params, empty } = buildSet(patch, { state: json });
    if (!empty) await this.db.execute(`UPDATE rooms SET ${set} WHERE id = ?`, [...params, id]);
    if (entityPatch && Object.keys(entityPatch).length > 0) await this.entities.update(id, entityPatch);
    else await this.entities.touch(id);
    return this.getRoom(id);
  }

  async setRoomState(id: string, patch: RoomState): Promise<Room> {
    const room = await this.getRoom(id);
    return this.updateRoom(id, { state: { ...room.state, ...patch, modified: true } });
  }

  async deleteRoom(id: string): Promise<void> {
    await this.db.execute("DELETE FROM entities WHERE id = ?", [id]);
  }

  /** Rooms containing the grid cell. */
  roomAt(rooms: Room[], x: number, y: number): Room | undefined {
    return rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  }

  // ---- doors ----

  async createDoor(input: DoorInput): Promise<Door> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO doors (id, floor_id, x, y, orientation, kind, state, lock_dc, key_item_id, room_a, room_b, target_floor_id, hidden, discovered, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.floor_id,
        input.x,
        input.y,
        input.orientation ?? "h",
        input.kind ?? "door",
        input.state ?? "closed",
        input.lock_dc ?? null,
        input.key_item_id ?? null,
        input.room_a ?? null,
        input.room_b ?? null,
        input.target_floor_id ?? null,
        int(input.hidden ?? false),
        int(input.discovered ?? !(input.hidden ?? false)),
        input.notes ?? "",
        ts,
        ts,
      ],
    );
    return this.getDoor(id);
  }

  async getDoor(id: string): Promise<Door> {
    const rows = await this.db.select("SELECT * FROM doors WHERE id = ?", [id]);
    return mapDoor(requireRow(rows, "Door", id));
  }

  async doors(floorId: string): Promise<Door[]> {
    const rows = await this.db.select("SELECT * FROM doors WHERE floor_id = ?", [floorId]);
    return rows.map(mapDoor);
  }

  async updateDoor(id: string, patch: Partial<Omit<Door, "id" | "created_at">>): Promise<Door> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { hidden: int, discovered: int });
    if (!empty) await this.db.execute(`UPDATE doors SET ${set} WHERE id = ?`, [...params, id]);
    return this.getDoor(id);
  }

  async deleteDoor(id: string): Promise<void> {
    await this.db.execute("DELETE FROM doors WHERE id = ?", [id]);
  }

  // ---- objects ----

  async createObject(input: ObjectInput): Promise<MapObject> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO map_objects (id, floor_id, room_id, kind, name, x, y, w, h, rotation, state, hidden, discovered, interactions, entity_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.floor_id,
        input.room_id ?? null,
        input.kind,
        input.name,
        input.x,
        input.y,
        input.w ?? 1,
        input.h ?? 1,
        input.rotation ?? 0,
        json(input.state ?? {}),
        int(input.hidden ?? false),
        int(input.discovered ?? !(input.hidden ?? false)),
        json(input.interactions ?? []),
        input.entity_id ?? null,
        input.notes ?? "",
        ts,
        ts,
      ],
    );
    return this.getObject(id);
  }

  async getObject(id: string): Promise<MapObject> {
    const rows = await this.db.select("SELECT * FROM map_objects WHERE id = ?", [id]);
    return mapObject(requireRow(rows, "Object", id));
  }

  async objects(floorId: string): Promise<MapObject[]> {
    const rows = await this.db.select("SELECT * FROM map_objects WHERE floor_id = ?", [floorId]);
    return rows.map(mapObject);
  }

  /** All objects on every floor of every dungeon in a campaign (for inventory transfer targets). */
  async objectsForCampaign(campaignId: string): Promise<MapObject[]> {
    const rows = await this.db.select(
      `SELECT o.* FROM map_objects o
       JOIN dungeon_floors f ON f.id = o.floor_id
       JOIN entities d ON d.id = f.dungeon_id
       WHERE d.campaign_id = ? ORDER BY o.name COLLATE NOCASE`,
      [campaignId],
    );
    return rows.map(mapObject);
  }

  /** All floors across a campaign's dungeons. */
  async floorsForCampaign(campaignId: string): Promise<DungeonFloor[]> {
    const rows = await this.db.select(
      `SELECT f.* FROM dungeon_floors f JOIN entities d ON d.id = f.dungeon_id WHERE d.campaign_id = ? ORDER BY d.name COLLATE NOCASE, f.sort_order, f.level`,
      [campaignId],
    );
    return rows.map(mapFloor);
  }

  objectUpdateStatement(id: string, patch: Partial<Omit<MapObject, "id" | "created_at">>): Statement | null {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { state: json, interactions: json, hidden: int, discovered: int });
    if (empty) return null;
    return { sql: `UPDATE map_objects SET ${set} WHERE id = ?`, params: [...params, id] };
  }

  async updateObject(id: string, patch: Partial<Omit<MapObject, "id" | "created_at">>): Promise<MapObject> {
    const statement = this.objectUpdateStatement(id, patch);
    if (statement) await this.db.execute(statement.sql, statement.params);
    return this.getObject(id);
  }

  async setObjectState(id: string, patch: ObjectState): Promise<MapObject> {
    const object = await this.getObject(id);
    return this.updateObject(id, { state: { ...object.state, ...patch } });
  }

  async deleteObject(id: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM item_instances WHERE owner_type = 'object' AND owner_id = ?", params: [id] },
      { sql: "DELETE FROM map_objects WHERE id = ?", params: [id] },
    ]);
  }

  // ---- tokens ----

  async createToken(input: TokenInput): Promise<Token> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO tokens (id, floor_id, entity_id, name, kind, x, y, size, color, hidden, hp, max_hp, conditions, speed, movement_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.floor_id,
        input.entity_id ?? null,
        input.name,
        input.kind ?? "creature",
        input.x,
        input.y,
        input.size ?? 1,
        input.color ?? null,
        int(input.hidden ?? false),
        input.hp ?? null,
        input.max_hp ?? null,
        json(input.conditions ?? []),
        input.speed ?? 30,
        input.movement_used ?? 0,
        ts,
        ts,
      ],
    );
    return this.getToken(id);
  }

  async getToken(id: string): Promise<Token> {
    const rows = await this.db.select("SELECT * FROM tokens WHERE id = ?", [id]);
    return mapToken(requireRow(rows, "Token", id));
  }

  async findToken(id: string | null | undefined): Promise<Token | null> {
    if (!id) return null;
    const rows = await this.db.select("SELECT * FROM tokens WHERE id = ?", [id]);
    return rows[0] ? mapToken(rows[0]) : null;
  }

  async tokens(floorId: string): Promise<Token[]> {
    const rows = await this.db.select("SELECT * FROM tokens WHERE floor_id = ? ORDER BY kind, name", [floorId]);
    return rows.map(mapToken);
  }

  async tokensForEntity(entityId: string): Promise<Token[]> {
    const rows = await this.db.select("SELECT * FROM tokens WHERE entity_id = ?", [entityId]);
    return rows.map(mapToken);
  }

  async updateToken(id: string, patch: Partial<Omit<Token, "id" | "created_at">>): Promise<Token> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { conditions: json, hidden: int });
    if (!empty) await this.db.execute(`UPDATE tokens SET ${set} WHERE id = ?`, [...params, id]);
    return this.getToken(id);
  }

  async moveToken(id: string, x: number, y: number, movementUsed?: number, floorId?: string): Promise<Token> {
    return this.updateToken(id, { x, y, movement_used: movementUsed, floor_id: floorId });
  }

  async resetMovement(floorId: string): Promise<void> {
    await this.db.execute("UPDATE tokens SET movement_used = 0, updated_at = ? WHERE floor_id = ?", [now(), floorId]);
  }

  async deleteToken(id: string): Promise<void> {
    await this.db.execute("DELETE FROM tokens WHERE id = ?", [id]);
  }

  // ---- markers ----

  async createMarker(input: MarkerInput): Promise<MapMarker> {
    const id = input.id ?? newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO map_markers (id, floor_id, room_id, kind, title, body_md, x, y, w, h, trigger, trigger_ref, entity_id, encounter_id, dm_only, enabled, activated, activated_at, activation_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.floor_id,
        input.room_id ?? null,
        input.kind,
        input.title,
        input.body_md ?? "",
        input.x,
        input.y,
        input.w ?? 1,
        input.h ?? 1,
        input.trigger ?? "manual",
        input.trigger_ref ?? null,
        input.entity_id ?? null,
        input.encounter_id ?? null,
        int(input.dm_only ?? true),
        int(input.enabled ?? true),
        int(input.activated ?? false),
        input.activated_at ?? null,
        input.activation_count ?? 0,
        ts,
        ts,
      ],
    );
    return this.getMarker(id);
  }

  async getMarker(id: string): Promise<MapMarker> {
    const rows = await this.db.select("SELECT * FROM map_markers WHERE id = ?", [id]);
    return mapMarker(requireRow(rows, "Marker", id));
  }

  async markers(floorId: string): Promise<MapMarker[]> {
    const rows = await this.db.select("SELECT * FROM map_markers WHERE floor_id = ?", [floorId]);
    return rows.map(mapMarker);
  }

  async updateMarker(id: string, patch: Partial<Omit<MapMarker, "id" | "created_at">>): Promise<MapMarker> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { dm_only: int, enabled: int, activated: int });
    if (!empty) await this.db.execute(`UPDATE map_markers SET ${set} WHERE id = ?`, [...params, id]);
    return this.getMarker(id);
  }

  async activateMarker(id: string): Promise<MapMarker> {
    const marker = await this.getMarker(id);
    return this.updateMarker(id, {
      activated: true,
      activated_at: now(),
      activation_count: marker.activation_count + 1,
    });
  }

  async resetMarker(id: string): Promise<MapMarker> {
    return this.updateMarker(id, { activated: false, activated_at: null });
  }

  async deleteMarker(id: string): Promise<void> {
    await this.db.execute("DELETE FROM map_markers WHERE id = ?", [id]);
  }

  /** Markers on a floor whose automatic trigger matches. */
  async markersByTrigger(floorId: string, trigger: MapMarker["trigger"], ref?: string | null): Promise<MapMarker[]> {
    const markers = await this.markers(floorId);
    return markers.filter((m) => m.enabled && m.trigger === trigger && (ref === undefined || m.trigger_ref === ref || (m.trigger_ref === null && trigger !== "manual")));
  }
}
