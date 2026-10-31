import type { SqlDriver } from "./driver";

/**
 * Versioned, forward-only schema migrations. Each entry runs once inside a transaction and is
 * recorded in `schema_migrations`. Never edit an applied migration: append a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every domain object (campaign, world, location, NPC, item definition, quest, lore...) has a row
-- here. Kind-specific structured fields live in the JSON "fields" column validated by Zod schemas;
-- tables below extend a few kinds that need relational queries (rooms, encounters, sessions).
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
  world_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  subtype TEXT,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  read_aloud_md TEXT NOT NULL DEFAULT '',
  dm_notes_md TEXT NOT NULL DEFAULT '',
  secret_md TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_asset TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_campaign_kind ON entities(campaign_id, kind);
CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_id);
CREATE INDEX IF NOT EXISTS idx_entities_world ON entities(world_id);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'related',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(from_id, to_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_links_to ON entity_links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON entity_links(from_id);

CREATE TABLE IF NOT EXISTS world_maps (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  world_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  map_asset TEXT,
  seed TEXT,
  fmg_version TEXT,
  map_created INTEGER,
  width INTEGER,
  height INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_maps_campaign ON world_maps(campaign_id);

CREATE TABLE IF NOT EXISTS map_feature_links (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES world_maps(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL,
  feature_id INTEGER,
  feature_name TEXT,
  x REAL,
  y REAL,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(map_id, feature_type, feature_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_feature_links_entity ON map_feature_links(entity_id);

CREATE TABLE IF NOT EXISTS map_annotations (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES world_maps(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'poi',
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  color TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_map ON map_annotations(map_id);

CREATE TABLE IF NOT EXISTS dungeon_floors (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  cell_feet INTEGER NOT NULL DEFAULT 5,
  walls TEXT NOT NULL DEFAULT '[]',
  terrain TEXT NOT NULL DEFAULT '[]',
  background_asset TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floors_dungeon ON dungeon_floors(dungeon_id);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  floor_id TEXT NOT NULL REFERENCES dungeon_floors(id) ON DELETE CASCADE,
  number TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  lighting TEXT NOT NULL DEFAULT 'dark',
  terrain TEXT NOT NULL DEFAULT 'stone floor',
  state TEXT NOT NULL DEFAULT '{}',
  color TEXT
);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor_id);

CREATE TABLE IF NOT EXISTS doors (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES dungeon_floors(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'h',
  kind TEXT NOT NULL DEFAULT 'door',
  state TEXT NOT NULL DEFAULT 'closed',
  lock_dc INTEGER,
  key_item_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  room_a TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  room_b TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  target_floor_id TEXT REFERENCES dungeon_floors(id) ON DELETE SET NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  discovered INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doors_floor ON doors(floor_id);

CREATE TABLE IF NOT EXISTS map_objects (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES dungeon_floors(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL DEFAULT 1,
  h REAL NOT NULL DEFAULT 1,
  rotation REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT '{}',
  hidden INTEGER NOT NULL DEFAULT 0,
  discovered INTEGER NOT NULL DEFAULT 1,
  interactions TEXT NOT NULL DEFAULT '[]',
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objects_floor ON map_objects(floor_id);
CREATE INDEX IF NOT EXISTS idx_objects_room ON map_objects(room_id);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES dungeon_floors(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'creature',
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  hp INTEGER,
  max_hp INTEGER,
  conditions TEXT NOT NULL DEFAULT '[]',
  speed INTEGER NOT NULL DEFAULT 30,
  movement_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_floor ON tokens(floor_id);
CREATE INDEX IF NOT EXISTS idx_tokens_entity ON tokens(entity_id);

CREATE TABLE IF NOT EXISTS map_markers (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES dungeon_floors(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL DEFAULT 1,
  h REAL NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL DEFAULT 'manual',
  trigger_ref TEXT,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  encounter_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  dm_only INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  activated INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  activation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_markers_floor ON map_markers(floor_id);

CREATE TABLE IF NOT EXISTS item_instances (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  owner_type TEXT NOT NULL,
  owner_id TEXT,
  state TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_owner ON item_instances(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_items_campaign ON item_instances(campaign_id);
CREATE INDEX IF NOT EXISTS idx_items_definition ON item_instances(definition_id);

CREATE TABLE IF NOT EXISTS inventory_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  instance_id TEXT,
  definition_id TEXT,
  quantity INTEGER NOT NULL,
  from_type TEXT,
  from_id TEXT,
  to_type TEXT,
  to_id TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_inventory_log_campaign ON inventory_log(campaign_id, at);

CREATE TABLE IF NOT EXISTS encounter_participants (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
  label TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  side TEXT NOT NULL DEFAULT 'enemy',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_participants_encounter ON encounter_participants(encounter_id);

CREATE TABLE IF NOT EXISTS encounter_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  encounter_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  floor_id TEXT REFERENCES dungeon_floors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  round INTEGER NOT NULL DEFAULT 0,
  turn_index INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  outcomes TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_campaign ON encounter_runs(campaign_id, status);

CREATE TABLE IF NOT EXISTS combatants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES encounter_runs(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  token_id TEXT REFERENCES tokens(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'enemy',
  initiative INTEGER,
  initiative_mod INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  temp_hp INTEGER NOT NULL DEFAULT 0,
  ac INTEGER,
  conditions TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '{}',
  defeated INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_combatants_run ON combatants(run_id);

CREATE TABLE IF NOT EXISTS quest_objectives (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  optional INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_objectives_quest ON quest_objectives(quest_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  year INTEGER,
  month INTEGER,
  day INTEGER,
  kind TEXT NOT NULL DEFAULT 'history',
  secret INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_campaign ON timeline_events(campaign_id, year, month, day);

CREATE TABLE IF NOT EXISTS session_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  promoted_to TEXT REFERENCES entities(id) ON DELETE SET NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_notes_session ON session_notes(session_id);

CREATE TABLE IF NOT EXISTS campaign_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  session_id TEXT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  refs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_campaign_log ON campaign_log(campaign_id, at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  file_name TEXT,
  size INTEGER,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "combatant instance sheets",
    sql: `
ALTER TABLE combatants ADD COLUMN sheet TEXT NOT NULL DEFAULT '{}';
`,
  },
  {
    version: 3,
    name: "character journeys",
    sql: `
-- Party memberships (time-aware)
CREATE TABLE IF NOT EXISTS party_memberships (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '',
  joined_session_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  left_session_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  joined_year INTEGER,
  joined_month INTEGER,
  joined_day INTEGER,
  left_year INTEGER,
  left_month INTEGER,
  left_day INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_party ON party_memberships(party_id);
CREATE INDEX IF NOT EXISTS idx_memberships_entity ON party_memberships(entity_id);

-- Journeys
CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dm_notes TEXT NOT NULL DEFAULT '',
  route_certainty TEXT NOT NULL DEFAULT 'known',
  start_year INTEGER,
  start_month INTEGER,
  start_day INTEGER,
  end_year INTEGER,
  end_month INTEGER,
  end_day INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journeys_campaign ON journeys(campaign_id);
CREATE INDEX IF NOT EXISTS idx_journeys_party ON journeys(party_id);
CREATE INDEX IF NOT EXISTS idx_journeys_session ON journeys(session_id);

-- Travel segments
CREATE TABLE IF NOT EXISTS travel_segments (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  origin_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  destination_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  waypoints TEXT NOT NULL DEFAULT '[]',
  start_year INTEGER,
  start_month INTEGER,
  start_day INTEGER,
  end_year INTEGER,
  end_month INTEGER,
  end_day INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  route_certainty TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_journey ON travel_segments(journey_id);

-- Segment participants
CREATE TABLE IF NOT EXISTS segment_participants (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES travel_segments(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'traveler',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(segment_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_seg_participants_segment ON segment_participants(segment_id);
CREATE INDEX IF NOT EXISTS idx_seg_participants_entity ON segment_participants(entity_id);

-- Timeline event participants (multi-character events)
CREATE TABLE IF NOT EXISTS timeline_event_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(event_id, entity_id, role)
);

-- Extend timeline_events with journey-related columns
ALTER TABLE timeline_events ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE timeline_events ADD COLUMN session_id TEXT REFERENCES entities(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN journey_id TEXT REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN segment_id TEXT REFERENCES travel_segments(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN location_id TEXT REFERENCES entities(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN confidence TEXT NOT NULL DEFAULT 'certain';
ALTER TABLE timeline_events ADD COLUMN manual_order INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 4,
    name: "floor notes",
    sql: `
ALTER TABLE dungeon_floors ADD COLUMN notes_md TEXT NOT NULL DEFAULT '';
`,
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export async function getSchemaVersion(driver: SqlDriver): Promise<number> {
  await driver.executeScript(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
  );
  const rows = await driver.select<{ v: number | null }>("SELECT max(version) AS v FROM schema_migrations");
  return rows[0]?.v ?? 0;
}

/** Drops a leftover BEGIN so the next write is not "cannot start a transaction within a transaction". */
export async function abandonOpenTransaction(driver: SqlDriver): Promise<void> {
  try {
    await driver.executeScript("ROLLBACK");
  } catch {
    // already autocommit
  }
}

function isIgnorableMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
}

export async function migrate(driver: SqlDriver): Promise<{ from: number; to: number }> {
  await abandonOpenTransaction(driver);
  const from = await getSchemaVersion(driver);
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This database uses schema v${from}, but this version of DM Workbench only understands up to v${CURRENT_SCHEMA_VERSION}. Update the application or restore an older backup.`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    // Do not wrap DDL in BEGIN/COMMIT. ALTER TABLE starts its own transaction; nesting it
    // produces "cannot start a transaction within a transaction" and can leave the connection dirty.
    try {
      await driver.executeScript(migration.sql);
    } catch (error) {
      if (!isIgnorableMigrationError(error)) throw error;
    }
    await driver.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
      migration.version,
      migration.name,
      new Date().toISOString(),
    ]);
  }
  return { from, to: CURRENT_SCHEMA_VERSION };
}
