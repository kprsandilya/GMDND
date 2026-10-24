# Phased plan (after P0)

P0 is specified in [p0-combatant-sheet.md](p0-combatant-sheet.md) and [p0-loot-markers.md](p0-loot-markers.md). Do those first; they are small and unlock the rest of combat UX.

## P1 — Run the fight from the sheet

- Structured actions (optional JSON on `fields.action_list`) while keeping the text blob as fallback.
- Roll to-hit / damage into the run log; DM still clicks −HP.
- Legendary action button between turns; recharge notes.
- Concentration: on damage to a concentrating combatant, toast “Con save DC 10 or half damage”.
- Death saves for party at 0 HP instead of instant `defeated`.
- Condition ⓘ tooltips (short 5e reminders).

## P2 — Authoring encounters and dungeons

- Live XP / difficulty vs the campaign’s PCs (Dragon Fight Club builder math, 2014 first).
- Participant picker searches existing creatures *and* can clone from a local SRD JSON import (not bundled).
- Encounter template: tactics, flee/morale, treasure hoard more visible while authoring.
- Dungeon: “this room’s encounter + hoard + loot marker” summary in the room inspector.

## P3 — Maps

- Optional image under the grid (Mimir-style battle map) without replacing the editor.
- Token click in play mode opens the same `CombatantSheet` if that token is in the active run.
- Fog / explored rooms already exist as room state; show loot markers only in explored rooms if `dm_only` is false.

## P4 — Table extras (only if P0–P2 feel good)

- Player-facing second window (Mimir).
- Grouped saves / mass damage.
- Initiative drag-reorder.
- Session recap: auto list of dropped loot and defeated names (Maintainer session log).

## Out of scope

- Shipping copyrighted Monster Manual text.
- Replacing Azgaar.
- Online accounts or shared player clients.
