# P0 — Click a combatant to open *that instance’s* sheet

## Rule

Creatures in the enemies list are **templates**. Combatants in a run are **instances**.

| Layer | What it is | Example |
| --- | --- | --- |
| Creature / NPC entity | Catalog entry. Shared. Do not mutate from combat. | `Fen Cultist` in Creatures |
| Encounter participant | “How many of that template in this fight” | `count: 3`, `entity_id → Fen Cultist` |
| Combatant (this run) | One copy on the table, with its own sheet | `Fen Cultist 1`, `Fen Cultist 2`, `Fen Cultist 3` |

Clicking **Fen Cultist 2** opens Fen Cultist 2’s snapshot. Editing AC, max HP, an action, a trait, or adding a one-off attack changes **only that combatant**. The creature record and the other copies stay as they were.

`entity_id` is a *lineage pointer* (“this instance was spawned from Fen Cultist”), not the live sheet.

## Why the first draft of this file was wrong

Reading `entities.get(combatant.entity_id)` at click time would show the **shared** cultist. Saving there would rewrite every future spawn and every other copy in the same fight. That is the opposite of granular control.

## What we copy today (not enough)

`startRun` only snapshots onto `combatants`:

- name, side, notes
- hp / max_hp / ac / initiative_mod
- `resources.legendary` if the template has `legendary_actions`

Everything else (abilities, speed, traits, **actions**, reactions, legendary text, senses, resistances) still lives only on the entity. The tracker can change HP, AC, conditions, notes — not the rest of the block.

`finishEncounter` already leaves the encounter *template* alone. It must also leave creature templates alone. Party HP writing back to the PC record is a separate, explicit exception (the PC *is* the instance).

## Behavior

- Click the combatant **name** (or the row, ignoring damage buttons).
- Side panel shows **this combatant’s sheet**, fully editable:
  - Identity: instance name, side, CR / level, size/type
  - Defenses: AC, current / max HP, temp HP, speed, senses
  - Ability scores
  - Traits, resistances, immunities
  - **Actions / attacks** — list you can use, edit, add, or remove on this copy
  - Reactions, legendary text, remaining legendary actions this run
  - Instance notes (wounded arm, stolen scimitar, already used a potion, …)
- Edits persist on the combatant for the rest of the run (and in the run record after finish).
- `S` toggles the sheet for the **current turn** instance.
- Clicking the same combatant again closes the sheet.
- “Open catalog entry” is a *read-only* jump to `/creatures/:id` (or characters). It is labeled so it is obvious you are leaving the instance.
- “Reset this copy to template” optional: re-snapshot from `entity_id` without touching HP/conditions unless asked.

## Data: snapshot on spawn

Add `sheet` JSON on `combatants` (migration). Shape = creature fields or character fields, copied at `startRun` / `addCombatant`.

```ts
combatant.entity_id  // Fen Cultist (template id, optional)
combatant.sheet      // { ac, abilities, actions, reactions, … }  // THIS copy
combatant.hp         // live pool (already a column)
combatant.max_hp     // keep in sync when the sheet’s max HP is edited
combatant.ac         // keep in sync when the sheet’s AC is edited
```

Spawn:

1. Load template `fields` (or empty if no `entity_id`).
2. Deep-copy into `combatant.sheet`.
3. Seed hp / max_hp / ac / legendary resource from that copy.
4. Never write `combatant.sheet` back to `entities.fields`.

Mid-fight add: same path — pick a creature from the list, spawn a new instance snapshot, then you can immediately customize it (this one is a champion, this one already took 4 damage, this one has no scimitar).

Existing runs with no `sheet`: lazy-fill from `entity_id` the first time the panel opens, then persist so later edits stay on the instance.

## Action buttons

1. Parse `sheet.actions` / `sheet.attacks` into entries (blank lines or headings).
2. Each entry is a button on **this** instance. Click logs `{instance name} uses {action}`. If a dice expression is visible, **Roll** uses existing dice helpers.
3. Damage is never auto-applied. The − / + boxes stay.
4. **Add action** / **Edit** / **Remove** writes to `combatant.sheet` only.
5. Legendary: decrement `combatant.resources.legendary` on this copy.

## UI sketch

```
CombatTracker
  left: instance list (Fen Cultist 1 / 2 / 3 are separate rows)
  right: [ selected instance sheet | Run log ]
```

Sheet header: instance name (editable) · “from Fen Cultist” (catalog link).

## Files

- Migration: `combatants.sheet TEXT NOT NULL DEFAULT '{}'`
- Types: `Combatant.sheet: Record<string, unknown>`
- `startRun` / `addCombatant`: copy template fields → sheet
- New: `src/features/encounters/CombatantSheet.tsx` — view + edit instance
- Edit: `CombatTracker.tsx` — selection, `S`, click name
- Helper: `src/domain/statblock.ts` — parse action blob; `snapshotSheet(entity)`

## Tests

- Three cultists from one template → three independent `sheet` objects.
- Edit Cultist 2’s actions → Cultist 1 and the creature entity unchanged.
- Parse a sample `actions` string into titled entries.
- Combatant with no `entity_id` still opens and can be given actions by hand.
- Finish encounter does not write instance sheet edits onto the creature.
