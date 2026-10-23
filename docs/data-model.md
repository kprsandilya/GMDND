# Data model

All campaign data lives in one SQLite database (`workbench.sqlite`) plus an `assets/` folder for files
(world `.map` files, images). The schema is created and upgraded by forward-only migrations in
`src/persistence/migrations.ts`; the current version is recorded in `schema_migrations` and shown in
**Settings & Data**. Types mirror the tables in `src/domain/types.ts`; kind-specific JSON fields are validated
by the Zod schemas in `src/domain/schemas.ts`.

## 1. Entities – the knowledge base

Every worldbuilding record is a row in **`entities`** regardless of kind. This keeps linking, search,
breadcrumbs, duplication, import/export and the "everything is a record" rule uniform.

| Column | Meaning |
| --- | --- |
| `id` | UUID |
| `campaign_id` | owning campaign (itself an entity of kind `campaign`; `NULL` only for the campaign row) |
| `world_id` | owning world (kind `world`) for geographic scoping |
| `parent_id` | containment: continent → kingdom → region → settlement → district → building; dungeon → room; faction → members, … |
| `kind` | one of the kinds below |
| `subtype` | free-form refinement (e.g. settlement "town", encounter "combat") |
| `name`, `summary` | title and one-line summary |
| `body_md` | main text (Markdown, `[[Name]]` wiki links) |
| `read_aloud_md` | boxed text to read to players |
| `dm_notes_md` | private notes |
| `secret_md` | secrets (never shown in read-aloud contexts) |
| `tags` | JSON string array |
| `fields` | JSON object validated per kind (see below) |
| `status` | lifecycle: draft/active/completed/… depending on kind |
| `image_asset` | relative asset path |

**Kinds** (`ENTITY_KINDS`): `campaign`, `world`, `continent`, `region`, `kingdom`, `settlement`, `district`,
`building`, `location`, `dungeon`, `room`, `pc`, `npc`, `creature`, `item`, `spell`, `faction`, `religion`,
`deity`, `quest`, `event`, `trap`, `shop`, `secret`, `article`, `document`, `encounter`, `session`.

**Kind-specific `fields` schemas**

| Schema | Kinds | Notable fields |
| --- | --- | --- |
| `campaignFieldsSchema` | campaign | `calendar` (months, weekdays, era, current year/month/day), `party_location_id`, `active_session_id`, `level_range` |
| `characterFieldsSchema` | pc, npc | race, class, level, AC, HP, speed, abilities, skills, attacks, occupation, motive, voice, attitude, player name, passive perception |
| `creatureFieldsSchema` | creature | size, type, CR, XP, AC, HP (+formula), speed, abilities, saves, senses, traits, actions, reactions, legendary |
| `itemFieldsSchema` | item | category, rarity, weight, value, damage, properties, AC, charges, attunement |
| `spellFieldsSchema` | spell | level, school, casting time, range, components, duration |
| `factionFieldsSchema` | faction, religion | type, goals, leader_id, headquarters_id, influence |
| `questFieldsSchema` | quest | giver_id, level, reward, status, hooks |
| `trapFieldsSchema` | trap | trigger, DC, damage, effect |
| `secretFieldsSchema` | secret | revealed flag, revealed-to notes |
| `encounterFieldsSchema` | encounter | type (combat/social/exploration/trap), difficulty, XP, environment, tactics |
| `sessionFieldsSchema` | session | number, real date, status (planned/live/done), outline, planned encounter and location ids, recap |
| `locationFieldsSchema` | settlement … location | population, government, type, climate, notable features, discovered/visited flags |
| `dungeonFieldsSchema` | dungeon | levels, theme, danger, default lighting |

**`entity_links`** – typed, directional relations between any two entities (`relation` such as `member_of`,
`rules`, `located_in`, `knows`, `enemy_of`; `note` free text). Mentions via `[[wiki links]]` in Markdown are
resolved at render time and listed as implicit links.

## 2. World atlas

| Table | Purpose |
| --- | --- |
| `world_maps` | one Fantasy Map Generator map: `seed`, `map_asset` (saved `.map` in assets), `fmg_version`, size, notes, optional `world_id` |
| `map_feature_links` | link from a generator feature (`feature_type` = burg / state / province / marker / river / culture / religion / point, `feature_id`, `feature_name`, `x`, `y`) to an `entity_id` |
| `map_annotations` | DM-only pins on the map (`kind` = poi / note / secret / quest / encounter / danger, title, Markdown body, optional entity, colour, hidden) |

## 3. Dungeons and battle maps

```
entities(kind=dungeon) ──< dungeon_floors ──< rooms (id = entities.id, kind=room)
                                      │ ──< doors
                                      │ ──< map_objects ──< item_instances (owner_type=object)
                                      │ ──< tokens ───────── entities (pc/npc/creature)
                                      │ ──< map_markers ──── entities (encounter, any)
```

| Table | Key fields |
| --- | --- |
| `dungeon_floors` | `dungeon_id`, `name`, `level`, `width` × `height` cells, `cell_feet`, `walls` (JSON segments `{id,x1,y1,x2,y2}`), `terrain` (JSON), `background_asset` |
| `rooms` | **also an entity** (`id` references `entities.id`): `floor_id`, `number`, rectangle `x,y,w,h`, `lighting`, `terrain`, `state` JSON (`discovered`, `explored`, `cleared`, `locked`, `trapped`, `flooded`, …), `color` |
| `doors` | cell-edge position `x,y` + `orientation` (h/v), `kind` (door, secret, portcullis, window, passage, stairs_up, stairs_down), `state` (open, closed, locked, barred, broken), `lock_dc`, `key_item_id`, `room_a`/`room_b`, `target_floor_id`, `hidden`, `discovered` |
| `map_objects` | `kind` (container, furniture, trap, hazard, mechanism, statue, bookshelf, document, altar, decoration, secret_passage), position/size/rotation, `state` JSON (`locked`, `open`, `searched`, `disarmed`, `triggered`, `lock_dc`, `key_item_id`, `trap_dc`, `trap_damage`, …), `hidden`, `discovered`, `interactions` (JSON, see §6), optional `entity_id` |
| `tokens` | `entity_id` (pc/npc/creature record), `name`, `kind`, cell `x,y`, `size`, `color`, `hidden`, `hp`/`max_hp`, `conditions`, `speed`, `movement_used` |
| `map_markers` | `kind` (event, encounter, trap, treasure, clue, npc, secret, note), area `x,y,w,h`, `trigger` (manual, enter_room, enter_area, open_door, interact_object, discover_secret, step_trap, defeat_creature), `trigger_ref`, `entity_id`, `encounter_id`, `dm_only`, `enabled`, `activated`, `activation_count` |

## 4. Items and inventories

- **Definition** = `entities` row of kind `item` (or `spell`): the catalogue entry with stats and value.
- **Instance** = `item_instances` row: `definition_id`, `quantity`, `owner_type` + `owner_id`, `state` JSON
  (`equipped`, `attuned`, `charges`, `identified`, custom notes).
- **Owner types**: `character` (pc/npc/creature entity), `object` (map object such as a chest), `room`
  (lying on the floor), `shop` (shop entity), `hoard` (encounter treasure), `party`, `unassigned`.
- Every move goes through `InventoryRepository.transfer`, which splits/merges stacks inside one transaction
  and appends to **`inventory_log`** (`from_type/from_id → to_type/to_id`, quantity, note). Destroying,
  granting and consuming are special cases of the same path.

## 5. Encounters and combat

- **Template**: `entities` row of kind `encounter` + **`encounter_participants`** (`entity_id` of a
  creature/npc, `count`, `side` = enemy/ally/neutral/party, notes).
- **Execution instance**: **`encounter_runs`** (`encounter_id`, optional `session_id`, `room_id`,
  `floor_id`, `status` prepared/active/completed/aborted, `round`, `turn_index`, `log` JSON, `outcomes` JSON,
  timestamps) with **`combatants`** (`entity_id`, optional `token_id`, `side`, `initiative`,
  `initiative_mod`, `hp`/`max_hp`/`temp_hp`, `ac`, `conditions`, `resources`, `defeated`).
- Activating a run bound to a room creates creature tokens in that room and links them to combatants;
  HP/condition changes sync to the tokens. Finishing a run writes outcomes (defeated creatures, room cleared,
  treasure moved to the room/hoard) back to the map and campaign log.

## 6. Interactions (data-driven object actions)

Stored as JSON in `map_objects.interactions` (`InteractionDefinition[]`):

```ts
{
  id, label, verb?, description?, once?,
  preconditions?: ({type:"state",key,equals} | {type:"not_state",key,equals} | {type:"has_item",definition_id,quantity?} | {type:"discovered"})[],
  check?: { ability: "Dexterity (Thieves' Tools)" | "Investigation" | ..., dc },
  success: Effect[], failure?: Effect[]
}
Effect = set_state | set_room_state | transfer_items | consume_item | reveal_object | reveal_door
       | set_door_state | activate_marker | damage_actor | log
```

`domain/interactions.ts` lists the available interactions for an actor (token) and object, evaluates
preconditions, asks for a manual roll when `check` is present, and applies effects through the repositories
in a single transaction. `defaultInteractionsFor(kind, state)` generates sensible defaults per object kind
(open/close/unlock/pick lock/force for containers, search for furniture and bookshelves, disarm/trigger for
traps, pull/press for mechanisms, read for documents, …) which the DM can edit as JSON in the inspector.

## 7. Quests, timeline, sessions, log

| Table | Purpose |
| --- | --- |
| `quest_objectives` | `quest_id`, title, `status` open/done/failed, optional flag, order, notes |
| `timeline_events` | campaign-calendar dated events (`year`, `month`, `day`, `kind` history/campaign/scheduled/session, `secret`, optional `entity_id`) |
| `session_notes` | quick notes during a live session (`kind` note/todo/consequence, `promoted_to` entity, `resolved`) |
| `campaign_log` | append-only audit trail of consequences (`kind`, message, `refs` JSON, optional `session_id`) written by workflows: movement, interactions, doors, markers, combat, inventory, quest changes, date changes |
| `assets` | registry of files under `assets/` (`rel_path`, `kind`, size) |
| `settings` | key/value app-level settings stored in the database (UI preferences live in the renderer's persisted store) |

## 8. Calendar

Campaign time is stored in the campaign entity's `fields.calendar`: ordered months with day counts,
weekday names, era suffix and the current date. `domain/calendar.ts` provides day arithmetic
(`addDays`, `compareDates`, `dayOfYear`, `weekdayName`, `formatDate`), used by the dashboard clock, session
"advance time" buttons and the timeline.

## 9. Referential rules

- Deleting a campaign cascades through every table via `campaign_id`/`ON DELETE CASCADE`.
- Deleting a dungeon cascades to floors, rooms (and their entity rows), doors, objects, tokens, markers.
- Deleting an object or room that holds items moves the items to `unassigned` first (restorable by the
  editor's undo), never silently destroying them.
- Entities referenced by tokens, markers, links or map features use `ON DELETE SET NULL`, so maps survive
  record deletion; the UI shows "(missing record)" where appropriate and `findMissingReferences` reports
  dangling ids after import.
