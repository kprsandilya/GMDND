# P0 — Click a combatant to open their sheet and actions

## Behavior

- Click the combatant **name** (or the row, ignoring damage buttons) in `CombatTracker`.
- A side panel (or dialog on a narrow tracker) shows:
  - Identity: name, side, CR / level, size/type if a creature
  - Defenses: AC, HP, temp HP, speed, senses
  - Ability scores
  - Traits
  - **Actions / attacks** as a list
  - Reactions, legendary text, remaining legendary actions this run
- `S` toggles the sheet for the **current turn** combatant (MitzNSimz).
- Clicking the same combatant again closes the sheet.
- “Open full record” jumps to `/creatures/:id`, `/characters/:id`, etc.

## Data we already have

From `combatant.entity_id` → `entities.get`:

- Creature: `fields.actions`, `reactions`, `legendary`, `legendary_actions`, abilities, AC, speed, traits, resistances, …
- PC / NPC: `fields.attacks`, `features`, abilities, AC, speed

If `entity_id` is null, show the combatant’s name, HP, AC, conditions, and notes only.

## Action buttons (minimum)

Do not block the sheet on a full 5e rules engine.

1. Split `fields.actions` / `fields.attacks` on blank lines or headings into entries.
2. Each entry is a button. Click appends to the run log: `{name} uses {action}` and, if we can see a dice expression (`1d8+3`), offer **Roll** via existing `d20` / dice helpers.
3. Damage is **never auto-applied** to a target (Dragon Fight Club rule: the DM applies HP). The log is the feed; the existing − / + boxes stay.

Legendary: if `combatant.resources.legendary > 0`, show “Spend legendary action” which decrements the resource and logs it.

## UI sketch

```
CombatTracker
  left: combatant list (existing)
  right:  [ selected ? StatSheet : Run log ]
```

The log stays available as a tab on the right column so we do not lose it.

## Files

- New: `src/features/encounters/CombatantSheet.tsx`
- Edit: `CombatTracker.tsx` — selection state, `S` shortcut, click on name
- Optional helper: `src/domain/statblock.ts` — `parseActionBlob(text) => { title, body, dice? }[]`

## Tests

- Parse a sample `actions` string into titled entries.
- Sheet renders creature fields from a seeded cultist.
- Clicking a combatant without `entity_id` still opens a fallback sheet.
