/** Table helpers for the combat tracker: group saving throws, mass damage and initiative reordering. */
import { saveBonus } from "./statblock";
import type { Combatant } from "./types";

export interface GroupSaveOptions {
  ability: string;
  dc: number;
  /** Damage dealt on a failed save (rolled once for the whole group, as in 5e). 0 = save only. */
  damage: number;
  /** Successful saves take half damage (rounded down) instead of none. */
  halfOnSuccess: boolean;
}

export interface GroupSaveRow {
  id: string;
  name: string;
  roll: number;
  bonus: number;
  total: number;
  success: boolean;
  damage: number;
}

/** Rolls a save for each target with its own sheet's bonus. Rows stay editable before they are applied. */
export function rollGroupSave(targets: Pick<Combatant, "id" | "name" | "sheet">[], options: GroupSaveOptions, random: () => number = Math.random): GroupSaveRow[] {
  return targets.map((t) => {
    const roll = 1 + Math.floor(random() * 20);
    const bonus = saveBonus(t.sheet ?? {}, options.ability);
    return finalizeRow({ id: t.id, name: t.name, roll, bonus, total: 0, success: false, damage: 0 }, options);
  });
}

/**
 * Recomputes total, success and damage for a row after the DM edits the die or bonus. Saving throws
 * have no automatic success on a 20 or failure on a 1, so it is simply total ≥ DC.
 */
export function finalizeRow(row: GroupSaveRow, options: GroupSaveOptions): GroupSaveRow {
  const total = row.roll + row.bonus;
  const success = total >= options.dc;
  const damage = success ? (options.halfOnSuccess ? Math.floor(options.damage / 2) : 0) : options.damage;
  return { ...row, total, success, damage };
}

export function summarizeGroupSave(rows: GroupSaveRow[], options: GroupSaveOptions, source = ""): string {
  const ab = options.ability.slice(0, 3).toUpperCase();
  const parts = rows.map((r) => `${r.name} ${r.total}${r.success ? " ✓" : " ✗"}${options.damage ? ` (${r.damage})` : ""}`);
  return `${source ? `${source}: ` : ""}DC ${options.dc} ${ab} save${options.damage ? `, ${options.damage} damage${options.halfOnSuccess ? " (half on success)" : ""}` : ""} — ${parts.join(", ")}.`;
}

/**
 * Gives combatants initiative values that produce exactly `orderedIds` when sorted high → low, changing
 * as few values as possible. A combatant only moves (by tenths) when it would otherwise sort wrongly.
 */
export function reassignInitiative(combatants: Pick<Combatant, "id" | "initiative">[], orderedIds: string[]): Map<string, number> {
  const byId = new Map(combatants.map((c) => [c.id, c]));
  const known = combatants.map((c) => c.initiative).filter((x): x is number => x !== null);
  const top = known.length ? Math.max(...known) + 1 : 10;
  const out = new Map<string, number>();
  let prev = Infinity;
  for (const id of orderedIds) {
    const c = byId.get(id);
    if (!c) continue;
    let value = c.initiative;
    if (value === null || value >= prev) value = prev === Infinity ? (c.initiative ?? top) : round1(prev - 0.1);
    if (value >= prev) value = round1(prev - 0.1);
    out.set(id, value);
    prev = value;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
