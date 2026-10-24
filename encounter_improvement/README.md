# Encounter, dungeon, and map improvements

Research branch for making combat, dungeon play, and battle maps more complete. This folder is the working brief: what the inspiration tools do well, what DM Workbench already has, and what to build next.

## Must-haves (this branch’s first implementation targets)

1. **Click a combatant** in a live run to open **that instance’s** stat sheet and actions. Enemies in the Creatures list are templates; each combatant is a separate copy you can change mid-fight without rewriting the catalog entry or the other copies.
2. **Loot on the floor** must leave a visible **treasure marker** in that room so the map shows there is something to pick up.

See [p0-combatant-sheet.md](p0-combatant-sheet.md) and [p0-loot-markers.md](p0-loot-markers.md).

## Documents

| File | Contents |
| --- | --- |
| [sources.md](sources.md) | Notes on the five inspiration products |
| [gap-analysis.md](gap-analysis.md) | What we already have vs what they do |
| [plan.md](plan.md) | Phased work after the two must-haves |

## Inspiration

- [mimir-dm/mimir](https://github.com/mimir-dm/mimir) — local-first Tauri DM desk, play mode, maps, catalog
- [ajones119/dnd-initiative-tracker](https://github.com/ajones119/dnd-initiative-tracker) — compact initiative table, monster autocomplete, notes/actions on the row
- [drovani/dnd-maintainer](https://github.com/drovani/dnd-maintainer) — campaign + session + encounter + loot logging
- [Dragon Fight Club](https://dragonfightclub.app/) — combat as “run the whole fight”: actions on the card, one-click rolls
- [MitzNSimz Encounter Tracker](https://mitznsimz-cpu.github.io/DnD-Encounter-Tracker/index.html) — `S` toggles the active stat block; conditions, concentration, death saves
