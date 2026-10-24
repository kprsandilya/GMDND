import { abilityModifier } from "./dice";
import type { Entity } from "./types";

/** Snapshot of a catalog creature/PC onto a combatant. Mutations stay on the instance. */
export function snapshotSheet(source: Entity | Record<string, unknown> | null | undefined): Record<string, unknown> {
  const fields = source && typeof source === "object" && "fields" in source ? ((source as Entity).fields ?? {}) : ((source as Record<string, unknown> | null) ?? {});
  return structuredClone(fields);
}

export interface ParsedAction {
  title: string;
  body: string;
  dice: string[];
  toHit: number | null;
}

const DICE_IN_TEXT = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/gi;

export function findDiceExpressions(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DICE_IN_TEXT)) {
    const raw = match[1]!.replace(/\s+/g, "");
    if (!seen.has(raw)) {
      seen.add(raw);
      found.push(raw);
    }
  }
  return found;
}

function toHitBonus(text: string): number | null {
  const match = /([+-]\s*\d+)\s+to hit/i.exec(text);
  if (!match) return null;
  return Number(match[1]!.replace(/\s+/g, ""));
}

function parseAttackBonus(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  const hit = toHitBonus(text);
  if (hit !== null) return hit;
  const bare = /^([+-]?\d+)$/.exec(text);
  return bare ? Number(bare[1]) : null;
}

function weaponsFromSheet(sheet: Record<string, unknown>): ParsedAction[] {
  const out: ParsedAction[] = [];
  for (const n of [1, 2, 3] as const) {
    const name = String(sheet[`weapon${n}_name`] ?? "").trim();
    if (!name) continue;
    const atk = String(sheet[`weapon${n}_atk`] ?? "").trim();
    const damage = String(sheet[`weapon${n}_damage`] ?? "").trim();
    const body = [name, atk && `${atk} to hit`, damage].filter(Boolean).join(". ");
    out.push({ title: name, body, dice: findDiceExpressions(damage), toHit: parseAttackBonus(atk) });
  }
  return out;
}

export function parseActionBlob(text: string): ParsedAction[] {
  if (!text?.trim()) return [];
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((body) => {
      const first = body.split("\n")[0] ?? body;
      const titled = /^([^.\n]+?)(?:\s*[.(]|$)/.exec(first);
      const title = (titled?.[1] ?? first).replace(/\s+$/, "").trim() || "Action";
      return { title, body, dice: findDiceExpressions(body), toHit: toHitBonus(body) };
    });
}

export function actionsFromSheet(sheet: Record<string, unknown>): ParsedAction[] {
  const list = sheet.action_list;
  if (Array.isArray(list) && list.length > 0) {
    return list
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const rec = entry as Record<string, unknown>;
        const body = String(rec.body ?? rec.text ?? rec.title ?? "").trim();
        const title = String(rec.title ?? rec.name ?? body.split("\n")[0] ?? "Action").trim() || "Action";
        if (!body && !title) return null;
        return { title, body: body || title, dice: findDiceExpressions(body), toHit: toHitBonus(body) };
      })
      .filter((x): x is ParsedAction => !!x);
  }
  const blob = [sheet.actions, sheet.attacks].filter((x) => typeof x === "string" && x.trim()).join("\n\n");
  const parsed = parseActionBlob(blob);
  const weapons = weaponsFromSheet(sheet).filter((w) => !parsed.some((a) => a.title.toLowerCase() === w.title.toLowerCase()));
  return [...weapons, ...parsed];
}

export function writeActionsToSheet(sheet: Record<string, unknown>, actions: ParsedAction[]): Record<string, unknown> {
  return {
    ...sheet,
    action_list: actions.map((a) => ({ title: a.title, body: a.body })),
    actions: actions.map((a) => (a.body.startsWith(a.title) ? a.body : `${a.title}. ${a.body}`)).join("\n\n"),
  };
}

export const CONDITION_REMINDERS: Record<string, string> = {
  blinded: "Auto-fail sight checks. Attacks against have advantage; yours have disadvantage.",
  charmed: "Cannot attack the charmer. The charmer has advantage on social checks against you.",
  deafened: "Auto-fail hearing checks.",
  frightened: "Disadvantage on checks and attacks while the source is in line of sight. Cannot move closer.",
  grappled: "Speed 0. Ends if the grappler is incapacitated or you are moved away.",
  incapacitated: "Cannot take actions or reactions.",
  invisible: "Impossible to see without magic. Attacks against have disadvantage; yours have advantage.",
  paralyzed: "Incapacitated, cannot move or speak. Auto-fail Str/Dex saves. Attacks against have advantage; melee hits are crits.",
  petrified: "Transformed to stone. Resistance to all damage. Unaware of surroundings.",
  poisoned: "Disadvantage on attack rolls and ability checks.",
  prone: "Melee attacks against have advantage; ranged have disadvantage. Your attacks have disadvantage. Crawl or use half movement to stand.",
  restrained: "Speed 0. Attacks against have advantage; yours have disadvantage. Dex saves at disadvantage.",
  stunned: "Incapacitated, cannot move, can speak only falteringly. Auto-fail Str/Dex saves. Attacks against have advantage.",
  unconscious: "Incapacitated, drop what you hold, fall prone. Auto-fail Str/Dex saves. Attacks against have advantage; melee hits are crits.",
  concentrating: "Damage forces a Constitution save, DC 10 or half the damage (whichever is higher), or the spell ends.",
  exhaustion: "Cumulative: 1 disadvantage on checks, 2 speed halved, 3 disadvantage on attacks and saves, 4 HP max halved, 5 speed 0, 6 death.",
};

/** 2014 DMG XP thresholds per character level: easy, medium, hard, deadly. */
export const XP_THRESHOLDS_2014: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],
  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],
  14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],
  18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900],
  20: [2800, 5700, 8500, 12700],
};

export function encounterMultiplier(monsterCount: number): number {
  if (monsterCount <= 0) return 1;
  if (monsterCount === 1) return 1;
  if (monsterCount === 2) return 1.5;
  if (monsterCount <= 6) return 2;
  if (monsterCount <= 10) return 2.5;
  if (monsterCount <= 14) return 3;
  return 4;
}

export type EncounterBand = "trivial" | "easy" | "medium" | "hard" | "deadly";

export interface EncounterBudget {
  monsterXp: number;
  adjustedXp: number;
  multiplier: number;
  party: { easy: number; medium: number; hard: number; deadly: number };
  band: EncounterBand;
}

export function partyXpBudget(levels: number[]): EncounterBudget["party"] {
  const sums = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const raw of levels) {
    const level = Math.max(1, Math.min(20, Math.round(raw) || 1));
    const t = XP_THRESHOLDS_2014[level] ?? XP_THRESHOLDS_2014[1]!;
    sums.easy += t[0];
    sums.medium += t[1];
    sums.hard += t[2];
    sums.deadly += t[3];
  }
  return sums;
}

export function assessEncounter(monsterXp: number, monsterCount: number, partyLevels: number[]): EncounterBudget {
  const multiplier = encounterMultiplier(monsterCount);
  const adjustedXp = Math.floor(monsterXp * multiplier);
  const party = partyXpBudget(partyLevels);
  let band: EncounterBand = "trivial";
  if (adjustedXp >= party.deadly && party.deadly > 0) band = "deadly";
  else if (adjustedXp >= party.hard && party.hard > 0) band = "hard";
  else if (adjustedXp >= party.medium && party.medium > 0) band = "medium";
  else if (adjustedXp >= party.easy && party.easy > 0) band = "easy";
  return { monsterXp, adjustedXp, multiplier, party, band };
}

export function sheetAbilityMod(sheet: Record<string, unknown>, ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): number {
  const abilities = (sheet.abilities ?? {}) as Record<string, number>;
  return abilityModifier(Number(abilities[ability] ?? 10) || 10);
}

export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}
