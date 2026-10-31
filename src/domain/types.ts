/** Domain types shared by persistence, domain logic and the UI. Row shapes mirror the SQLite schema. */

export const ENTITY_KINDS = [
  "campaign",
  "world",
  "continent",
  "region",
  "kingdom",
  "settlement",
  "district",
  "building",
  "location",
  "dungeon",
  "room",
  "pc",
  "npc",
  "creature",
  "item",
  "spell",
  "faction",
  "religion",
  "deity",
  "quest",
  "event",
  "trap",
  "shop",
  "secret",
  "article",
  "document",
  "encounter",
  "session",
  "party",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const GEOGRAPHIC_KINDS: EntityKind[] = [
  "world",
  "continent",
  "region",
  "kingdom",
  "settlement",
  "district",
  "building",
  "location",
  "dungeon",
];

export const KIND_LABELS: Record<EntityKind, string> = {
  campaign: "Campaign",
  world: "World",
  continent: "Continent",
  region: "Region",
  kingdom: "Kingdom",
  settlement: "Settlement",
  district: "District",
  building: "Building",
  location: "Location",
  dungeon: "Dungeon",
  room: "Room",
  pc: "Player Character",
  npc: "NPC",
  creature: "Creature",
  item: "Item",
  spell: "Spell",
  faction: "Faction",
  religion: "Religion",
  deity: "Deity",
  quest: "Quest",
  event: "Event",
  trap: "Trap / Hazard",
  shop: "Shop",
  secret: "Secret",
  article: "Lore Article",
  document: "Document",
  encounter: "Encounter",
  session: "Session",
  party: "Party",
};

export interface Entity {
  id: string;
  campaign_id: string | null;
  world_id: string | null;
  parent_id: string | null;
  kind: EntityKind;
  subtype: string | null;
  name: string;
  summary: string;
  body_md: string;
  read_aloud_md: string;
  dm_notes_md: string;
  secret_md: string;
  tags: string[];
  fields: Record<string, unknown>;
  status: string | null;
  sort_order: number;
  image_asset: string | null;
  created_at: string;
  updated_at: string;
}

export type EntityInput = Partial<Omit<Entity, "id" | "created_at" | "updated_at" | "kind" | "name">> & {
  kind: EntityKind;
  name: string;
  id?: string;
};

export interface EntityLink {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  note: string;
  created_at: string;
}

export interface LinkedEntity extends EntityLink {
  entity: Entity;
  direction: "out" | "in";
}

export interface WorldMap {
  id: string;
  campaign_id: string;
  world_id: string | null;
  name: string;
  map_asset: string | null;
  seed: string | null;
  fmg_version: string | null;
  map_created: number | null;
  width: number | null;
  height: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type FeatureType = "burg" | "state" | "province" | "marker" | "culture" | "religion" | "river" | "point";

export interface MapFeatureLink {
  id: string;
  map_id: string;
  feature_type: FeatureType;
  feature_id: number | null;
  feature_name: string | null;
  x: number | null;
  y: number | null;
  entity_id: string;
  created_at: string;
}

export interface MapAnnotation {
  id: string;
  map_id: string;
  x: number;
  y: number;
  kind: "poi" | "note" | "secret" | "quest" | "encounter" | "danger";
  title: string;
  body_md: string;
  entity_id: string | null;
  color: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface WallSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TerrainCell {
  x: number;
  y: number;
  type: string;
}

export interface DungeonFloor {
  id: string;
  dungeon_id: string;
  name: string;
  level: number;
  width: number;
  height: number;
  cell_feet: number;
  walls: WallSegment[];
  terrain: TerrainCell[];
  background_asset: string | null;
  /** DM notes for this floor (Markdown, `[[Name]]` wiki links). */
  notes_md: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoomState {
  explored?: boolean;
  cleared?: boolean;
  locked?: boolean;
  trapped?: boolean;
  modified?: boolean;
  discovered?: boolean;
  [key: string]: unknown;
}

/** A room is an entity (name, description, read-aloud, DM notes, secrets) plus its geometry. */
export interface Room {
  id: string;
  floor_id: string;
  number: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  lighting: string;
  terrain: string;
  state: RoomState;
  color: string | null;
  entity: Entity;
}

export type DoorKind = "door" | "secret" | "portcullis" | "window" | "passage" | "stairs_up" | "stairs_down";
export type DoorState = "open" | "closed" | "locked" | "barred" | "broken";

export interface Door {
  id: string;
  floor_id: string;
  x: number;
  y: number;
  orientation: "h" | "v";
  kind: DoorKind;
  state: DoorState;
  lock_dc: number | null;
  key_item_id: string | null;
  room_a: string | null;
  room_b: string | null;
  target_floor_id: string | null;
  hidden: boolean;
  discovered: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ObjectKind =
  | "container"
  | "furniture"
  | "trap"
  | "hazard"
  | "mechanism"
  | "statue"
  | "bookshelf"
  | "document"
  | "altar"
  | "decoration"
  | "secret_passage";

export interface ObjectState {
  locked?: boolean;
  open?: boolean;
  searched?: boolean;
  disarmed?: boolean;
  triggered?: boolean;
  activated?: boolean;
  broken?: boolean;
  lock_dc?: number;
  key_item_id?: string | null;
  trap_dc?: number;
  trap_damage?: string;
  [key: string]: unknown;
}

export interface MapObject {
  id: string;
  floor_id: string;
  room_id: string | null;
  kind: ObjectKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  state: ObjectState;
  hidden: boolean;
  discovered: boolean;
  interactions: InteractionDefinition[];
  entity_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type TokenKind = "pc" | "npc" | "creature";

export interface Token {
  id: string;
  floor_id: string;
  entity_id: string | null;
  name: string;
  kind: TokenKind;
  x: number;
  y: number;
  size: number;
  color: string | null;
  hidden: boolean;
  hp: number | null;
  max_hp: number | null;
  conditions: string[];
  speed: number;
  movement_used: number;
  created_at: string;
  updated_at: string;
}

export type MarkerKind = "event" | "encounter" | "trap" | "treasure" | "clue" | "npc" | "secret" | "note";
export type MarkerTrigger =
  | "manual"
  | "enter_room"
  | "enter_area"
  | "open_door"
  | "interact_object"
  | "discover_secret"
  | "step_trap"
  | "defeat_creature";

export interface MapMarker {
  id: string;
  floor_id: string;
  room_id: string | null;
  kind: MarkerKind;
  title: string;
  body_md: string;
  x: number;
  y: number;
  w: number;
  h: number;
  trigger: MarkerTrigger;
  trigger_ref: string | null;
  entity_id: string | null;
  encounter_id: string | null;
  dm_only: boolean;
  enabled: boolean;
  activated: boolean;
  activated_at: string | null;
  activation_count: number;
  created_at: string;
  updated_at: string;
}

export type OwnerType = "character" | "object" | "room" | "shop" | "hoard" | "party" | "unassigned";

export interface ItemInstance {
  id: string;
  campaign_id: string;
  definition_id: string;
  quantity: number;
  owner_type: OwnerType;
  owner_id: string | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ItemInstanceWithDefinition extends ItemInstance {
  definition: Entity;
}

export interface InventoryLogEntry {
  id: string;
  campaign_id: string;
  at: string;
  instance_id: string | null;
  definition_id: string | null;
  quantity: number;
  from_type: string | null;
  from_id: string | null;
  to_type: string | null;
  to_id: string | null;
  note: string;
}

// ---- interactions (data-driven object actions) ----

export type Precondition =
  | { type: "state"; key: string; equals: unknown }
  | { type: "has_item"; definition_id: string; quantity?: number }
  | { type: "not_state"; key: string; equals: unknown }
  | { type: "discovered" };

export interface SkillCheck {
  ability: string; // e.g. "Dexterity (Thieves' Tools)", "Investigation"
  dc: number;
}

export type Effect =
  | { type: "set_state"; key: string; value: unknown }
  | { type: "set_room_state"; key: string; value: unknown }
  | { type: "transfer_items"; from: "object" | "actor"; to: "object" | "actor"; all?: boolean; definition_id?: string; quantity?: number }
  | { type: "consume_item"; definition_id: string; quantity?: number }
  | { type: "reveal_object"; object_id?: string }
  | { type: "reveal_door"; door_id: string }
  | { type: "set_door_state"; door_id: string; state: DoorState }
  | { type: "activate_marker"; marker_id: string }
  | { type: "damage_actor"; amount: string; note?: string }
  | { type: "log"; message: string };

export interface InteractionDefinition {
  id: string;
  label: string;
  verb?: string;
  description?: string;
  preconditions?: Precondition[];
  check?: SkillCheck | null;
  success: Effect[];
  failure?: Effect[];
  once?: boolean;
}

// ---- encounters ----

export type EncounterSide = "enemy" | "ally" | "neutral" | "party";

export interface EncounterParticipant {
  id: string;
  encounter_id: string;
  entity_id: string | null;
  label: string | null;
  count: number;
  side: EncounterSide;
  notes: string;
  sort_order: number;
}

export type RunStatus = "prepared" | "active" | "completed" | "aborted";

export interface RunLogEntry {
  at: string;
  round: number;
  message: string;
  kind?: string;
}

export interface EncounterOutcomes {
  mark_defeated?: boolean;
  room_cleared?: boolean;
  award_treasure?: boolean;
  remove_defeated_tokens?: boolean;
  quest_updates?: { objective_id: string; status: string }[];
  notes?: string;
  [key: string]: unknown;
}

export interface EncounterRun {
  id: string;
  campaign_id: string;
  encounter_id: string | null;
  session_id: string | null;
  room_id: string | null;
  floor_id: string | null;
  name: string;
  status: RunStatus;
  round: number;
  turn_index: number;
  log: RunLogEntry[];
  outcomes: EncounterOutcomes;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Condition {
  name: string;
  duration: number | null; // rounds, null = until removed
  note?: string;
  /** Exhaustion level 1–6 (only used by the "exhaustion" condition). */
  level?: number;
}

export interface Combatant {
  id: string;
  run_id: string;
  entity_id: string | null;
  token_id: string | null;
  name: string;
  side: EncounterSide;
  initiative: number | null;
  initiative_mod: number;
  hp: number;
  max_hp: number;
  temp_hp: number;
  ac: number | null;
  conditions: Condition[];
  resources: Record<string, number>;
  defeated: boolean;
  notes: string;
  sort_order: number;
  /** Deep copy of the creature/PC fields for this instance. Never written back to the catalog entity. */
  sheet: Record<string, unknown>;
}

export interface QuestObjective {
  id: string;
  quest_id: string;
  title: string;
  status: "open" | "done" | "failed";
  optional: boolean;
  sort_order: number;
  notes: string;
}

export interface TimelineEvent {
  id: string;
  campaign_id: string;
  entity_id: string | null;
  title: string;
  body_md: string;
  year: number | null;
  month: number | null;
  day: number | null;
  kind: "history" | "campaign" | "scheduled" | "session";
  secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionNote {
  id: string;
  session_id: string;
  campaign_id: string;
  body: string;
  kind: "note" | "todo" | "consequence";
  promoted_to: string | null;
  resolved: boolean;
  created_at: string;
}

export interface CampaignLogEntry {
  id: string;
  campaign_id: string;
  session_id: string | null;
  at: string;
  kind: string;
  message: string;
  refs: Record<string, string>;
}

export interface AssetRecord {
  id: string;
  campaign_id: string | null;
  rel_path: string;
  kind: string;
  file_name: string | null;
  size: number | null;
  created_at: string;
}

export interface CalendarMonth {
  name: string;
  days: number;
}

export interface CampaignCalendar {
  months: CalendarMonth[];
  weekdays: string[];
  era: string;
  year: number;
  month: number; // 1-based
  day: number; // 1-based
}

export interface CampaignFields {
  edition?: string;
  party_location_id?: string | null;
  active_session_id?: string | null;
  calendar?: CampaignCalendar;
  is_demo?: boolean;
  [key: string]: unknown;
}
