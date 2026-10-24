import type { EntityInput } from "./types";

export interface ImportedCreature {
  name: string;
  fields: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickArray(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  const rec = asRecord(root);
  if (!rec) return [];
  for (const key of ["monsters", "creatures", "monster", "results", "srd"]) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

function numberish(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.value === "number") return rec.value;
    if (typeof rec.average === "number") return rec.average;
  }
  return fallback;
}

function stringifyActions(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const rec = asRecord(entry);
        if (!rec) return "";
        const name = String(rec.name ?? rec.title ?? "");
        const desc = String(rec.desc ?? rec.description ?? rec.body ?? rec.text ?? "");
        return [name, desc].filter(Boolean).join(". ");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(value);
}

function creatureFromUnknown(raw: unknown): ImportedCreature | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const name = String(rec.name ?? rec.title ?? "").trim();
  if (!name) return null;
  const abilities = asRecord(rec.abilities) ?? {
    str: numberish(rec.strength ?? rec.str, 10),
    dex: numberish(rec.dexterity ?? rec.dex, 10),
    con: numberish(rec.constitution ?? rec.con, 10),
    int: numberish(rec.intelligence ?? rec.int, 10),
    wis: numberish(rec.wisdom ?? rec.wis, 10),
    cha: numberish(rec.charisma ?? rec.cha, 10),
  };
  return {
    name,
    fields: {
      size: rec.size ?? "Medium",
      type: rec.type ?? rec.subtype ?? "humanoid",
      alignment: rec.alignment ?? "unaligned",
      cr: rec.challenge_rating ?? rec.cr ?? "0",
      xp: numberish(rec.xp, 0),
      ac: numberish(rec.armor_class ?? rec.ac, 10),
      ac_notes: rec.armor_desc ?? rec.ac_notes ?? "",
      hp: numberish(rec.hit_points ?? rec.hp, 10),
      max_hp: numberish(rec.hit_points ?? rec.max_hp ?? rec.hp, 10),
      hp_formula: rec.hit_dice ?? rec.hp_formula ?? "",
      hit_dice: rec.hit_dice ?? rec.hp_formula ?? "",
      initiative: numberish(rec.initiative, Math.floor((numberish(abilities.dex, 10) - 10) / 2)),
      proficiency_bonus: numberish(rec.proficiency_bonus ?? rec.prof_bonus, 2),
      speed: typeof rec.speed === "string" ? rec.speed : JSON.stringify(rec.speed ?? "30 ft."),
      abilities,
      saves: stringifyActions(rec.saves ?? rec.saving_throws),
      skills: stringifyActions(rec.skills),
      senses: typeof rec.senses === "string" ? rec.senses : "",
      languages: typeof rec.languages === "string" ? rec.languages : "",
      vulnerabilities: stringifyActions(rec.damage_vulnerabilities ?? rec.vulnerabilities),
      resistances: stringifyActions(rec.damage_resistances ?? rec.resistances),
      immunities: stringifyActions(rec.damage_immunities ?? rec.immunities),
      condition_immunities: stringifyActions(rec.condition_immunities),
      traits: stringifyActions(rec.special_abilities ?? rec.traits),
      actions: stringifyActions(rec.actions),
      bonus_actions: stringifyActions(rec.bonus_actions),
      reactions: stringifyActions(rec.reactions),
      legendary: stringifyActions(rec.legendary_actions),
      legendary_actions: Array.isArray(rec.legendary_actions) ? rec.legendary_actions.length : numberish(rec.legendary_actions, 0),
      legendary_resistances: numberish(rec.legendary_resistances ?? rec.legendary_resistance, 0),
      lair: stringifyActions(rec.lair_actions ?? rec.lair),
      mythic: stringifyActions(rec.mythic_actions ?? rec.mythic),
    },
  };
}

export function parseSrdCreatures(json: unknown): ImportedCreature[] {
  const out: ImportedCreature[] = [];
  const seen = new Set<string>();
  for (const raw of pickArray(json)) {
    const creature = creatureFromUnknown(raw);
    if (!creature || seen.has(creature.name.toLowerCase())) continue;
    seen.add(creature.name.toLowerCase());
    out.push(creature);
  }
  const single = creatureFromUnknown(json);
  if (single && !seen.has(single.name.toLowerCase())) out.push(single);
  return out;
}

export function creatureInputs(campaignId: string, creatures: ImportedCreature[]): EntityInput[] {
  return creatures.map((c) => ({
    kind: "creature" as const,
    campaign_id: campaignId,
    name: c.name,
    fields: c.fields,
    summary: `CR ${String(c.fields.cr ?? "?")} · imported`,
  }));
}
