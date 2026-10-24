# Inspiration sources

Reviewed 2026-10-23. These are not licenses to copy UI or data wholesale. We already have our own schema, SRD-shaped creature fields, and a dungeon map. Steal *behaviors*, not pixels.

## Mimir (`mimir-dm/mimir`)

Local-first desktop DM tool (Rust / Tauri), closest cousin to this app.

**Worth taking**

- **Play Mode vs prep.** Prep (modules, maps, monsters) is a different surface from running the table. We already split edit / play on the dungeon editor; combat should feel like play mode, not a thin banner on the encounter *template*.
- **Catalog + homebrew.** Searchable monster/spell/item catalog, then campaign-scoped homebrew. Our creatures are free-form `fields` JSON (`actions`, `reactions`, `legendary`). A structured action list would let the tracker press “Claw” the way Mimir’s catalog feeds play.
- **Maps as first-class session objects.** UVTT / image maps, grid, tokens, fog, lights. We have a grid dungeon editor, not a battle-map image layer. Image + grid overlay is a later phase.
- **Second screen.** DM sees the full sheet; players see tokens and fog. Out of scope until combat and loot are solid.
- **PDF / print.** Token cutouts and sheets. Nice; not blocking.

**Docs:** [mimir-dm.github.io](https://mimir-dm.github.io)

## Initiative Tracker (`ajones119/dnd-initiative-tracker`)

Astro + React table tracker. Monster data from the 5e SRD API.

**Worth taking**

- **Row is the unit of work.** Initiative, name, HP, AC, notes/actions live on one row. Clicking the name should expand or open the sheet — we currently cannot open a sheet at all.
- **Incrementable damage.** Focus HP, type `12`, hit −12 / +12. We have a separate `n` box; keep it, but also allow clicking the combatant to work from the sheet.
- **Monster autocomplete from a bestiary.** We pick entities via `EntityPicker`. Adding SRD search when creating a creature record is a later phase.
- **Drag to reorder initiative.** We sort by rolled init. Manual drag is a small later UX win.
- **Death saves.** Missing for PCs at 0 HP.

## D&D Maintainer (`drovani/dnd-maintainer`)

Self-hosted 5.5e campaign manager (React, local Supabase).

**Worth taking**

- **Session log owns loot and XP.** Encounters link *to* sessions; loot is recorded as session fact, not only an inventory transfer. We write a campaign-log line when treasure drops, but nothing on the map.
- **Encounter as a planned list + status**, then a run. We already have template vs `encounter_runs`. Keep that split.
- **Character sheet is a real object** (abilities, equipment, spells). Clicking a party combatant should open the PC record / a compact sheet, not only a creature block.
- **Notes categories** (plot, NPC, location, loot, rules). Our dungeon markers already have kinds including `treasure` — use that kind for dropped loot instead of inventing a new table.

## Dragon Fight Club (`dragonfightclub.app`)

Browser combat app: builder + tracker + monster builder. 2014 and 2024.

**Worth taking**

- **“Actions off the statblock.”** Each creature carries attacks; press one and the roll goes to a feed. This is the model for clicking a combatant: sheet + action buttons, DM still applies damage.
- **Numbered copies** of the same monster (`Goblin 3`). We already name `Cultist 1 / 2` when `count > 1`.
- **Difficulty live in the builder.** We store `fields.difficulty` and `xp_total` as text on the template; a live XP budget against the party would help *authoring*, not the live tracker.
- **Legendary / lair as first-class turn widgets.** We store `legendary` text and `legendary_actions` count on the creature, and copy legendary resources onto the combatant at run start — but never show a “use legendary action” control.
- **Group saves / mass damage** (community praise). Useful for 12 cultists. Later phase.

## MitzNSimz Encounter Tracker

Offline table tool. Full user guide is on the page itself.

**Worth taking**

- **`S` shows/hides the active combatant’s stat block.** Keyboard + click. We should do both: click any row; `S` toggles the current turn.
- **Condition tooltips** with 2014/2024 wording. We have chips and no reminder text.
- **Concentration:** mark it, prompt Con save on damage. We have a `concentrating` condition chip only.
- **Death saves** and temp HP (we have temp HP).
- **No grid on purpose** — they assume a physical map. We *have* a grid; loot and combatants should stay tied to rooms/tokens.
- **Spell tooltips in action text.** Later; our `actions` field is a markdown/plain string today.

## What we will not copy

- Hosted accounts, second-device sync, or sending campaign data off-box.
- Shipping a 3,000-monster OGL dump into the installer. Optional “import SRD JSON” is enough.
- Replacing Azgaar or the dungeon editor with someone else’s map stack.
