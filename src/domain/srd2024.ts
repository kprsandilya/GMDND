/**
 * Converts open5e's SRD-2024 data (Django fixture JSON) into DM Workbench entity records for the
 * shared standard library. These records live with `campaign_id = null` and carry
 * `fields.source = SRD_SOURCE` so the UI can tell "standard" apart from "custom" (campaign-made).
 *
 * The raw data is the `data/v2/wizards-of-the-coast/srd-2024` folder of the open5e-api repository
 * (https://github.com/open5e/open5e-api), © Wizards of the Coast, released under the SRD. The
 * conversion is pure so it can run in a build script and be unit-tested.
 */
import type { EntityInput } from "./types";

/** Marks a record as part of the bundled standard set. Stored in `fields.source`. */
export const SRD_SOURCE = "srd-2024";
/** Bump when the converter output changes so the seeder re-imports. */
export const SRD_LIBRARY_VERSION = 1;

/** Prefix for the deterministic ids of standard records (keeps re-seeding idempotent). */
export const SRD_ID_PREFIX = "srd::";

/**
 * Deterministic id for a standard record, namespaced by kind so that records sharing an open5e pk
 * across files (e.g. the Camel creature stat block and the Camel mount item) do not collide.
 */
export const srdEntityId = (pk: string, kind = "creature"): string => `${SRD_ID_PREFIX}${kind}::${pk}`;
export const isSrdEntityId = (id: string): boolean => id.startsWith(SRD_ID_PREFIX);

// ---- Django fixture shapes (only the fields we read) ----

interface Fixture<T> {
  fields: T;
  model: string;
  pk: string;
}

type CreatureFixture = Fixture<Record<string, unknown>>;
type ActionFixture = Fixture<{
  name?: string;
  desc?: string;
  action_type?: string;
  parent?: string;
  order_in_statblock?: number;
  legendary_action_cost?: number | null;
  uses_type?: string | null;
  uses_param?: number | null;
}>;
type TraitFixture = Fixture<{ name?: string; desc?: string; parent?: string }>;
type ItemFixture = Fixture<Record<string, unknown>>;
type WeaponFixture = Fixture<{
  name?: string;
  damage_dice?: string;
  damage_type?: string;
  range?: number;
  long_range?: number;
  is_simple?: boolean;
}>;
type ArmorFixture = Fixture<{
  name?: string;
  ac_base?: number;
  ac_add_dexmod?: boolean;
  ac_cap_dexmod?: number | null;
  grants_stealth_disadvantage?: boolean;
  strength_score_required?: number | null;
}>;

export interface SrdSource {
  creatures?: CreatureFixture[];
  creatureActions?: ActionFixture[];
  creatureTraits?: TraitFixture[];
  items?: ItemFixture[];
  magicItems?: ItemFixture[];
  weapons?: WeaponFixture[];
  armor?: ArmorFixture[];
}

// ---- helpers ----

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function abilityScore(value: unknown): number {
  const n = num(value, 10);
  return Math.max(1, Math.min(30, Math.round(n) || 10));
}

const titleCase = (s: string): string => s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());

/** "10.000" or "0.125" challenge rating → the usual 5e display ("10", "1/8"). */
function formatCr(raw: unknown): string {
  const n = num(raw, 0);
  if (n === 0) return "0";
  if (n >= 1) return String(Math.round(n * 1000) / 1000).replace(/\.0+$/, "");
  const fractions: [number, string][] = [
    [0.5, "1/2"],
    [0.25, "1/4"],
    [0.125, "1/8"],
  ];
  const match = fractions.find(([v]) => Math.abs(v - n) < 0.001);
  return match ? match[1] : String(n);
}

/** 2014/2024 CR → XP table (the open5e export often omits XP). */
const CR_XP: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900,
  "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000,
  "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

function xpForCr(cr: string, explicit: unknown): number {
  const given = num(explicit, 0);
  if (given > 0) return given;
  return CR_XP[cr] ?? 0;
}

/** Collects the per-ability skill_bonus_* / saving_throw_* fields into a readable string. */
function collectBonuses(fields: Record<string, unknown>, prefix: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(prefix) || value === null || value === undefined) continue;
    const label = titleCase(key.slice(prefix.length).replace(/_/g, " ").trim());
    const n = num(value);
    parts.push(`${label} ${n >= 0 ? "+" : ""}${n}`);
  }
  return parts.join(", ");
}

/** Walk / fly / swim / climb / burrow numbers → "30 ft., fly 60 ft." */
function formatSpeed(fields: Record<string, unknown>): string {
  const walk = num(fields.walk, 0);
  const parts: string[] = [`${walk} ft.`];
  for (const mode of ["burrow", "climb", "fly", "swim"] as const) {
    const v = fields[mode];
    if (v !== null && v !== undefined && num(v) > 0) {
      parts.push(`${mode} ${num(v)} ft.${mode === "fly" && fields.hover ? " (hover)" : ""}`);
    }
  }
  return parts.join(", ");
}

/** Senses: darkvision/blindsight/… ranges plus passive Perception. */
function formatSenses(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  const senses: [string, string][] = [
    ["blindsight_range", "blindsight"],
    ["darkvision_range", "darkvision"],
    ["tremorsense_range", "tremorsense"],
    ["truesight_range", "truesight"],
  ];
  for (const [key, label] of senses) {
    const v = fields[key];
    if (v !== null && v !== undefined && num(v) > 0) parts.push(`${label} ${num(v)} ft.`);
  }
  const pp = num(fields.passive_perception, 0);
  if (pp > 0) parts.push(`passive Perception ${pp}`);
  return parts.join(", ");
}

function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => titleCase(String(v).replace(/[-_]/g, " "))).join(", ");
  if (typeof value === "string") return value;
  return "";
}

function actionBlock(actions: ActionFixture[], type: string): string {
  return actions
    .filter((a) => (a.fields.action_type ?? "").toUpperCase() === type)
    .sort((a, b) => num(a.fields.order_in_statblock) - num(b.fields.order_in_statblock))
    .map((a) => {
      const uses = a.fields.uses_type ? ` (${a.fields.uses_param ?? ""} ${String(a.fields.uses_type).replace(/_/g, " ").toLowerCase()})`.replace("  ", " ") : "";
      return `${a.fields.name ?? "Action"}${uses}. ${a.fields.desc ?? ""}`.trim();
    })
    .join("\n\n");
}

function traitBlock(traits: TraitFixture[]): string {
  return traits.map((t) => `${t.fields.name ?? "Trait"}. ${t.fields.desc ?? ""}`.trim()).join("\n\n");
}

function countLegendary(actions: ActionFixture[]): number {
  const fromActions = actions.some((a) => (a.fields.action_type ?? "").toUpperCase() === "LEGENDARY_ACTION");
  // SRD legendary creatures use 3 legendary actions per round unless noted otherwise.
  return fromActions ? 3 : 0;
}

function legendaryResistances(traits: TraitFixture[]): number {
  const trait = traits.find((t) => /legendary resistance/i.test(t.fields.name ?? ""));
  if (!trait) return 0;
  const match = /(\d+)\s*\/\s*day/i.exec(trait.fields.name ?? "");
  return match ? Number(match[1]) : 3;
}

// ---- creature conversion ----

export function creatureToEntity(
  creature: CreatureFixture,
  actionsByParent: Map<string, ActionFixture[]>,
  traitsByParent: Map<string, TraitFixture[]>,
): EntityInput {
  const f = creature.fields;
  const actions = actionsByParent.get(creature.pk) ?? [];
  const traits = traitsByParent.get(creature.pk) ?? [];
  const cr = formatCr(f.challenge_rating);
  const xp = xpForCr(cr, f.experience_points_integer);
  const name = String(f.name ?? "Unknown Creature");

  const fields: Record<string, unknown> = {
    source: SRD_SOURCE,
    size: titleCase(String(f.size ?? "medium")),
    type: String(f.type ?? "humanoid"),
    alignment: String(f.alignment ?? "unaligned"),
    cr,
    xp,
    ac: num(f.armor_class, 10),
    ac_notes: String(f.armor_detail ?? ""),
    initiative: num(f.initiative_bonus, 0),
    hp: num(f.hit_points, 1),
    max_hp: num(f.hit_points, 1),
    hp_formula: String(f.hit_dice ?? ""),
    hit_dice: String(f.hit_dice ?? ""),
    proficiency_bonus: num(f.proficiency_bonus, 2) || 2,
    speed: formatSpeed(f),
    abilities: {
      str: abilityScore(f.ability_score_strength),
      dex: abilityScore(f.ability_score_dexterity),
      con: abilityScore(f.ability_score_constitution),
      int: abilityScore(f.ability_score_intelligence),
      wis: abilityScore(f.ability_score_wisdom),
      cha: abilityScore(f.ability_score_charisma),
    },
    saves: collectBonuses(f, "saving_throw_"),
    skills: collectBonuses(f, "skill_bonus_"),
    passive_perception: num(f.passive_perception, 10),
    senses: formatSenses(f),
    languages: String(f.languages_desc ?? joinList(f.languages)),
    vulnerabilities: String(f.damage_vulnerabilities_display ?? joinList(f.damage_vulnerabilities)),
    resistances: String(f.damage_resistances_display ?? joinList(f.damage_resistances)),
    immunities: String(f.damage_immunities_display ?? joinList(f.damage_immunities)),
    condition_immunities: String(f.condition_immunities_display ?? joinList(f.condition_immunities)),
    traits: traitBlock(traits),
    actions: actionBlock(actions, "ACTION"),
    bonus_actions: actionBlock(actions, "BONUS_ACTION"),
    reactions: actionBlock(actions, "REACTION"),
    legendary: actionBlock(actions, "LEGENDARY_ACTION"),
    legendary_actions: countLegendary(actions),
    legendary_resistances: legendaryResistances(traits),
    lair: actionBlock(actions, "LAIR_ACTION"),
    mythic: actionBlock(actions, "MYTHIC_ACTION"),
  };

  return {
    id: srdEntityId(creature.pk, "creature"),
    kind: "creature",
    campaign_id: null,
    name,
    summary: `${titleCase(String(f.size ?? "medium"))} ${String(f.type ?? "")} · CR ${cr} (${xp} XP) · SRD 2024`.replace(/\s+/g, " ").trim(),
    fields,
    tags: ["srd-2024"],
  };
}

// ---- item conversion ----

const ITEM_CATEGORY_MAP: Record<string, string> = {
  weapon: "weapon",
  armor: "armor",
  shield: "shield",
  "adventuring-gear": "equipment",
  gear: "equipment",
  tools: "tool",
  tool: "tool",
  potion: "potion",
  scroll: "scroll",
  "wondrous-item": "wondrous",
  ammunition: "material",
  "mounts-and-vehicles": "equipment",
  "trade-good": "treasure",
  currency: "currency",
};

const RARITY_MAP: Record<string, string> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  "very-rare": "very rare",
  "very rare": "very rare",
  legendary: "legendary",
  artifact: "artifact",
  varies: "varies",
};

function mapCategory(raw: unknown): string {
  const key = String(raw ?? "").toLowerCase().trim();
  return ITEM_CATEGORY_MAP[key] ?? "equipment";
}

function mapRarity(raw: unknown): string {
  const key = String(raw ?? "common").toLowerCase().trim();
  return RARITY_MAP[key] ?? "common";
}

export function itemToEntity(
  item: ItemFixture,
  opts: {
    magical: boolean;
    weaponsByPk?: Map<string, WeaponFixture>;
    armorByPk?: Map<string, ArmorFixture>;
  },
): EntityInput {
  const f = item.fields;
  const name = String(f.name ?? "Unknown Item");
  const category = opts.magical ? mapMagicCategory(f.type ?? f.category) : mapCategory(f.category);
  const rarity = mapRarity(f.rarity ?? (opts.magical ? "uncommon" : "common"));

  const fields: Record<string, unknown> = {
    source: SRD_SOURCE,
    category,
    rarity,
    weight: num(f.weight, 0),
    value_gp: num(f.cost, 0),
    properties: "",
    damage: "",
    damage_type: "",
    armor_class: "",
    effects: String(f.desc ?? f.description ?? ""),
    attunement: typeof f.requires_attunement === "string" ? f.requires_attunement.trim().length > 0 : Boolean(f.requires_attunement),
    attunement_requirements: typeof f.requires_attunement === "string" ? f.requires_attunement : "",
    edition: "5e (2024)",
    stackable: !opts.magical,
    magical: opts.magical,
    homebrew: false,
  };

  // Enrich weapons / armor from the detail tables when linked.
  const weaponPk = typeof f.weapon === "string" ? f.weapon : null;
  const weapon = weaponPk ? opts.weaponsByPk?.get(weaponPk) : undefined;
  if (weapon) {
    fields.damage = String(weapon.fields.damage_dice ?? "");
    fields.damage_type = String(weapon.fields.damage_type ?? "");
    const range = num(weapon.fields.range, 0);
    const long = num(weapon.fields.long_range, 0);
    if (range > 0 || long > 0) fields.properties = `Range ${range}/${long} ft.`;
  }
  const armorPk = typeof f.armor === "string" ? f.armor : null;
  const armor = armorPk ? opts.armorByPk?.get(armorPk) : undefined;
  if (armor) {
    const base = num(armor.fields.ac_base, 0);
    const dex = armor.fields.ac_add_dexmod
      ? armor.fields.ac_cap_dexmod != null
        ? ` + Dex (max ${num(armor.fields.ac_cap_dexmod)})`
        : " + Dex"
      : "";
    fields.armor_class = `${base}${dex}`;
    if (armor.fields.grants_stealth_disadvantage) fields.properties = "Disadvantage on Stealth";
  } else if (num(f.armor_class, 0) > 0) {
    fields.armor_class = String(num(f.armor_class));
  }

  return {
    id: srdEntityId(item.pk, "item"),
    kind: "item",
    campaign_id: null,
    name,
    summary: `${titleCase(category)}${opts.magical ? ` · ${rarity}` : ""} · SRD 2024`,
    body_md: String(f.desc ?? f.description ?? ""),
    fields,
    tags: ["srd-2024"],
  };
}

const MAGIC_CATEGORY_MAP: Record<string, string> = {
  weapon: "weapon",
  armor: "armor",
  shield: "shield",
  potion: "potion",
  "potions": "potion",
  scroll: "scroll",
  ring: "wondrous",
  rod: "wondrous",
  staff: "wondrous",
  wand: "wondrous",
  wondrous: "wondrous",
  "wondrous-item": "wondrous",
  "wondrous item": "wondrous",
};

function mapMagicCategory(raw: unknown): string {
  const key = String(raw ?? "").toLowerCase().trim();
  return MAGIC_CATEGORY_MAP[key] ?? "wondrous";
}

// ---- top-level conversion ----

function groupByParent<T extends { fields: { parent?: string } }>(rows: T[] | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows ?? []) {
    const parent = row.fields.parent;
    if (!parent) continue;
    const list = map.get(parent);
    if (list) list.push(row);
    else map.set(parent, [row]);
  }
  return map;
}

export interface SrdLibrary {
  version: number;
  creatures: EntityInput[];
  items: EntityInput[];
}

/** Converts the whole raw SRD-2024 source into the entity records bundled with the app. */
export function buildSrdLibrary(source: SrdSource): SrdLibrary {
  const actionsByParent = groupByParent(source.creatureActions);
  const traitsByParent = groupByParent(source.creatureTraits);
  const weaponsByPk = new Map((source.weapons ?? []).map((w) => [w.pk, w] as const));
  const armorByPk = new Map((source.armor ?? []).map((a) => [a.pk, a] as const));

  const creatures = (source.creatures ?? []).map((c) => creatureToEntity(c, actionsByParent, traitsByParent));
  const items = [
    ...(source.items ?? []).map((i) => itemToEntity(i, { magical: false, weaponsByPk, armorByPk })),
    ...(source.magicItems ?? []).map((i) => itemToEntity(i, { magical: true, weaponsByPk, armorByPk })),
  ];

  return { version: SRD_LIBRARY_VERSION, creatures, items };
}
