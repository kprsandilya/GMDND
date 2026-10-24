# Gap analysis

## What already works

| Area | Today |
| --- | --- |
| Encounter **templates** | Entity `kind: encounter`, participants, hoard inventory, tactics in body |
| **Runs** | `encounter_runs` + `combatants`; template is not mutated |
| Tracker | Initiative, HP, temp HP, AC, conditions, next turn, finish outcomes |
| Map bind | Optional floor/room; tokens placed for enemies; HP syncs to tokens |
| Dungeon play | Tokens, doors, objects, interactions, inventory on rooms/objects/characters |
| Markers | Kinds include `treasure`; gold `$` glyph on the canvas (`MapCanvas.tsx`) |
| Creature data | `creatureFieldsSchema`: AC, HP, abilities, traits, **actions / reactions / legendary** as text |
| PC data | `characterFieldsSchema`: AC, HP, attacks, features |
| Loot drop | Finish → `award_treasure` moves hoard items to `owner_type: "room"` |

## Gaps the inspiration tools make obvious

| Need | Inspiration | Our gap |
| --- | --- | --- |
| Open the **stat block mid-fight** | DFC, MitzNSimz `S`, Mimir play mode | Combatant row is name + HP only. `entity_id` is unused in the UI. |
| **Press an action** (to-hit / damage in the log) | DFC “actions off the statblock” | `fields.actions` is a blob; no parse, no buttons. |
| **Legendary actions** between turns | DFC combat cards | Resource copied to `combatant.resources.legendary`, never shown. |
| **Loot is visible on the map** | Maintainer session loot + our own treasure markers | Items sit on the room inventory. No marker. Easy to forget the floor has gold. |
| Death saves | Initiative tracker, MitzNSimz | At 0 HP we only mark `defeated`. |
| Concentration save prompt | MitzNSimz | Condition chip only. |
| Condition rule reminder | MitzNSimz ⓘ | Chip has no tooltip body. |
| Encounter **difficulty vs party** | DFC builder | Static fields on the template. |
| Bestiary search | All five | Manual creature records only. |
| Image battle maps / FoW | Mimir | Grid editor only. |
| Player-facing display | Mimir | None. |

## Code touchpoints (do not reinvent)

- Tracker UI: `src/features/encounters/CombatTracker.tsx` (`CombatantRow`)
- Run workflow / treasure transfer: `src/domain/workflows/encounterWorkflow.ts` (`finishEncounter`)
- Marker CRUD: `src/persistence/repositories/dungeons.ts` `createMarker`
- Marker draw: `src/features/dungeons/MapCanvas.tsx` (`MARKER_COLOR.treasure`, `$`)
- Room inspector already lists `useInventory({ owner_type: "room" })`
- Creature fields: `src/domain/schemas.ts` `creatureFieldsSchema`
- Combatant type: `src/domain/types.ts` — has `entity_id`, `resources`, `notes`
