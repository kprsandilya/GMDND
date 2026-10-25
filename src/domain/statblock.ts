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

/** Reads "+5 to hit" (2014 style) or "Melee Attack Roll: +5" (2024 style). */
export function toHitBonus(text: string): number | null {
  const match = /attack roll:\s*([+-]\s*\d+)/i.exec(text) ?? /([+-]\s*\d+)\s+to hit/i.exec(text);
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

/** 2024 DMG XP budget per character level: low, moderate, high. */
export const XP_BUDGET_2024: Record<number, [number, number, number]> = {
  1: [50, 75, 100],
  2: [100, 150, 200],
  3: [150, 225, 400],
  4: [250, 375, 500],
  5: [500, 750, 1100],
  6: [600, 1000, 1400],
  7: [750, 1300, 1700],
  8: [1000, 1700, 2100],
  9: [1300, 2000, 2600],
  10: [1600, 2300, 3100],
  11: [1900, 2900, 4100],
  12: [2200, 3700, 4700],
  13: [2600, 4200, 5400],
  14: [2900, 4900, 6200],
  15: [3300, 5400, 7800],
  16: [3800, 6100, 9800],
  17: [4500, 7200, 11700],
  18: [5000, 8700, 14200],
  19: [5500, 10700, 17200],
  20: [6400, 13200, 22000],
};

export type BudgetRules = "2014" | "2024";

/**
 * 2024 rules: no group multiplier. Low/moderate/high map onto easy/medium/hard; anything past 1.5× the
 * high budget is labelled deadly so both rule sets share one difficulty scale.
 */
export function assessEncounter2024(monsterXp: number, partyLevels: number[]): EncounterBudget {
  const party = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const raw of partyLevels) {
    const level = Math.max(1, Math.min(20, Math.round(raw) || 1));
    const [low, moderate, high] = XP_BUDGET_2024[level]!;
    party.easy += low;
    party.medium += moderate;
    party.hard += high;
  }
  party.deadly = Math.floor(party.hard * 1.5);
  let band: EncounterBand = "trivial";
  if (party.deadly > 0 && monsterXp >= party.deadly) band = "deadly";
  else if (party.hard > 0 && monsterXp >= party.hard) band = "hard";
  else if (party.medium > 0 && monsterXp >= party.medium) band = "medium";
  else if (party.easy > 0 && monsterXp >= party.easy) band = "easy";
  return { monsterXp, adjustedXp: monsterXp, multiplier: 1, party, band };
}

export function assessWithRules(rules: BudgetRules, monsterXp: number, monsterCount: number, partyLevels: number[]): EncounterBudget {
  return rules === "2024" ? assessEncounter2024(monsterXp, partyLevels) : assessEncounter(monsterXp, monsterCount, partyLevels);
}

export interface MoraleState {
  /** Share of the enemy side's combined max HP still standing, 0–1. */
  hpFraction: number;
  standing: number;
  total: number;
  broken: boolean;
}

/** Enemy morale: broken once the standing enemies' HP falls to the template's flee threshold. */
export function enemyMorale(combatants: { side: string; hp: number; max_hp: number; defeated: boolean }[], fleeAtPercent: number): MoraleState {
  const enemies = combatants.filter((c) => c.side === "enemy");
  const max = enemies.reduce((s, c) => s + Math.max(0, c.max_hp), 0);
  const hp = enemies.filter((c) => !c.defeated).reduce((s, c) => s + Math.max(0, c.hp), 0);
  const hpFraction = max > 0 ? hp / max : 0;
  const standing = enemies.filter((c) => !c.defeated && c.hp > 0).length;
  const broken = fleeAtPercent > 0 && enemies.length > 0 && standing > 0 && hpFraction * 100 <= fleeAtPercent;
  return { hpFraction, standing, total: enemies.length, broken };
}

export function sheetAbilityMod(sheet: Record<string, unknown>, ability: "str" | "dex" | "con" | "int" | "wis" | "cha"): number {
  const abilities = (sheet.abilities ?? {}) as Record<string, number>;
  return abilityModifier(Number(abilities[ability] ?? 10) || 10);
}

export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

// ---- limited-use abilities (recharge, X/Day) ----

export type UsageLimit = { kind: "recharge"; min: number } | { kind: "per_day"; uses: number };

/** Reads "(Recharge 5–6)", "(Recharge 6)" or "(3/Day)" from the first line of an ability. */
export function usageLimit(text: string): UsageLimit | null {
  const first = (text ?? "").split("\n")[0] ?? "";
  const recharge = /recharge\s+(\d)(?:\s*[-–—]\s*6)?/i.exec(first);
  if (recharge) return { kind: "recharge", min: Math.max(1, Math.min(6, Number(recharge[1]))) };
  const perDay = /\((\d+)\/day/i.exec(first);
  if (perDay) return { kind: "per_day", uses: Math.max(1, Number(perDay[1])) };
  return null;
}

export function abilitySlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resource key that tracks one limited ability on a combatant. */
export function usageKey(limit: UsageLimit, title: string): string {
  return `${limit.kind === "recharge" ? "recharge" : "uses"}:${abilitySlug(title)}`;
}

export type ActionGroup = "action" | "bonus" | "reaction" | "legendary";

export interface GroupedAction extends ParsedAction {
  group: ActionGroup;
  limit: UsageLimit | null;
  save: { ability: string; dc: number } | null;
}

const SAVE_ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

/** Reads "Constitution Saving Throw: DC 12" (2024) or "DC 13 Dexterity saving throw" (2014). */
export function saveFromText(text: string): { ability: string; dc: number } | null {
  const a = /(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw:?\s*dc\s*(\d+)/i.exec(text);
  if (a) return { ability: a[1]!.toLowerCase(), dc: Number(a[2]) };
  const b = /dc\s*(\d+)\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i.exec(text);
  if (b) return { ability: b[2]!.toLowerCase(), dc: Number(b[1]) };
  return null;
}

/** Every usable entry on a sheet, grouped: actions, bonus actions, reactions and legendary actions. */
export function groupedActions(sheet: Record<string, unknown>): GroupedAction[] {
  const decorate = (a: ParsedAction, group: ActionGroup): GroupedAction => ({ ...a, group, limit: usageLimit(a.body), save: saveFromText(a.body) });
  const out: GroupedAction[] = actionsFromSheet(sheet).map((a) => decorate(a, "action"));
  const extra: [unknown, ActionGroup][] = [
    [sheet.bonus_actions, "bonus"],
    [sheet.reactions, "reaction"],
    [sheet.legendary, "legendary"],
  ];
  for (const [blob, group] of extra) if (typeof blob === "string") out.push(...parseActionBlob(blob).map((a) => decorate(a, group)));
  return out;
}

/** Ability → save bonus from a "Dexterity +3, Wisdom +2" string, falling back to the ability modifier. */
export function saveBonus(sheet: Record<string, unknown>, ability: string): number {
  const full = ability.toLowerCase();
  const short = full.slice(0, 3) as "str" | "dex" | "con" | "int" | "wis" | "cha";
  const text = String(sheet.saves ?? "");
  const match = new RegExp(`\\b(${full}|${short})\\w*\\s*([+-]\\s*\\d+)`, "i").exec(text);
  if (match) return Number(match[2]!.replace(/\s+/g, ""));
  return sheetAbilityMod(sheet, short);
}

export const SAVE_ABILITY_NAMES = SAVE_ABILITIES;

// ---- spell slots ----

/** Parses "1st: 4, 2nd: 3", "1:4 2:3" or "4/3/2" into { 1: 4, 2: 3, ... }. */
export function parseSpellSlots(text: unknown): Record<number, number> {
  const raw = String(text ?? "").trim();
  const out: Record<number, number> = {};
  if (!raw) return out;
  if (/^\d+(\s*\/\s*\d+)+$/.test(raw)) {
    raw.split("/").forEach((n, i) => {
      const v = Number(n.trim());
      if (v > 0 && i < 9) out[i + 1] = v;
    });
    return out;
  }
  for (const m of raw.matchAll(/([1-9])(?:st|nd|rd|th)?(?:\s*level)?\s*[:=]\s*(\d+)/gi)) {
    const level = Number(m[1]);
    const count = Number(m[2]);
    if (count > 0) out[level] = count;
  }
  return out;
}

/** Fresh per-run counters derived from a sheet: legendary actions/resistances, spell slots, limited uses. */
export function initialResources(sheet: Record<string, unknown>): Record<string, number> {
  const res: Record<string, number> = {};
  const legendary = Number(sheet.legendary_actions ?? 0) || 0;
  if (legendary) Object.assign(res, { legendary, legendary_max: legendary });
  const legres = Number(sheet.legendary_resistances ?? 0) || 0;
  if (legres) Object.assign(res, { legres, legres_max: legres });
  for (const [level, count] of Object.entries(parseSpellSlots(sheet.spell_slots))) {
    res[`slot_${level}`] = count;
    res[`slot_${level}_max`] = count;
  }
  for (const a of groupedActions(sheet)) {
    if (!a.limit) continue;
    res[usageKey(a.limit, a.title)] = a.limit.kind === "recharge" ? 1 : a.limit.uses;
  }
  return res;
}

/** Remaining uses of a limited ability: recharge is 1 (ready) or 0 (spent); X/Day counts down. */
export function usesLeft(resources: Record<string, number>, action: Pick<GroupedAction, "limit" | "title">): number | null {
  if (!action.limit) return null;
  const key = usageKey(action.limit, action.title);
  const value = resources[key];
  if (value === undefined) return action.limit.kind === "recharge" ? 1 : action.limit.uses;
  return value;
}

/** Spends one use; returns the new resources and whether the use was allowed. */
export function spendUse(resources: Record<string, number>, action: Pick<GroupedAction, "limit" | "title">): { resources: Record<string, number>; ok: boolean } {
  const left = usesLeft(resources, action);
  if (left === null) return { resources, ok: true };
  if (left <= 0) return { resources, ok: false };
  return { resources: { ...resources, [usageKey(action.limit!, action.title)]: left - 1 }, ok: true };
}

/** Start-of-turn recharge rolls for every spent recharge ability. */
export function rollRecharges(
  sheet: Record<string, unknown>,
  resources: Record<string, number>,
  random: () => number = Math.random,
): { resources: Record<string, number>; messages: string[] } {
  const next = { ...resources };
  const messages: string[] = [];
  for (const a of groupedActions(sheet)) {
    if (a.limit?.kind !== "recharge") continue;
    const key = usageKey(a.limit, a.title);
    if ((next[key] ?? 1) > 0) continue;
    const rolled = 1 + Math.floor(random() * 6);
    if (rolled >= a.limit.min) {
      next[key] = 1;
      messages.push(`${a.title} recharges (rolled ${rolled}).`);
    } else {
      messages.push(`${a.title} does not recharge (rolled ${rolled}, needs ${a.limit.min}+).`);
    }
  }
  return { resources: next, messages };
}

// ---- attack and damage rolls ----

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface AttackRoll {
  d20: number;
  rolls: number[];
  total: number;
  crit: boolean;
  fumble: boolean;
}

export function rollAttack(bonus: number, mode: RollMode = "normal", random: () => number = Math.random): AttackRoll {
  const one = () => 1 + Math.floor(random() * 20);
  const rolls = mode === "normal" ? [one()] : [one(), one()];
  const d20 = mode === "advantage" ? Math.max(...rolls) : mode === "disadvantage" ? Math.min(...rolls) : rolls[0]!;
  return { d20, rolls, total: d20 + bonus, crit: d20 === 20, fumble: d20 === 1 };
}

/** Rolls a damage expression; a critical hit doubles the number of dice (not the modifier). */
export function rollDamage(expression: string, crit = false, random: () => number = Math.random): { total: number; rolls: number[]; modifier: number } | null {
  const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(expression);
  if (!m) return null;
  const count = (m[1] ? Number(m[1]) : 1) * (crit ? 2 : 1);
  const sides = Number(m[2]);
  const modifier = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(random() * sides));
  return { total: rolls.reduce((s, x) => s + x, 0) + modifier, rolls, modifier };
}
