import { z } from "zod";
import { ENTITY_KINDS } from "./types";

/** Zod schemas: validation at the UI boundary and for import files. */

export const abilityScoresSchema = z.object({
  str: z.number().int().min(1).max(30).default(10),
  dex: z.number().int().min(1).max(30).default(10),
  con: z.number().int().min(1).max(30).default(10),
  int: z.number().int().min(1).max(30).default(10),
  wis: z.number().int().min(1).max(30).default(10),
  cha: z.number().int().min(1).max(30).default(10),
});
export type AbilityScores = z.infer<typeof abilityScoresSchema>;

export const characterFieldsSchema = z.object({
  race: z.string().default(""),
  class: z.string().default(""),
  level: z.number().int().min(0).max(30).default(1),
  alignment: z.string().default(""),
  ac: z.number().int().min(0).default(10),
  hp: z.number().int().min(0).default(10),
  max_hp: z.number().int().min(0).default(10),
  speed: z.number().int().min(0).default(30),
  abilities: abilityScoresSchema.default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
  skills: z.string().default(""),
  attacks: z.string().default(""),
  features: z.string().default(""),
  occupation: z.string().default(""),
  motive: z.string().default(""),
  voice: z.string().default(""),
  attitude: z.enum(["friendly", "neutral", "hostile", "unknown"]).default("neutral"),
  player_name: z.string().default(""),
  passive_perception: z.number().int().min(0).default(10),
});
export type CharacterFields = z.infer<typeof characterFieldsSchema>;

export const creatureFieldsSchema = z.object({
  size: z.string().default("Medium"),
  type: z.string().default("humanoid"),
  alignment: z.string().default("unaligned"),
  cr: z.string().default("0"),
  xp: z.number().int().min(0).default(0),
  ac: z.number().int().min(0).default(10),
  hp: z.number().int().min(0).default(10),
  hp_formula: z.string().default(""),
  speed: z.string().default("30 ft."),
  abilities: abilityScoresSchema.default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
  saves: z.string().default(""),
  skills: z.string().default(""),
  senses: z.string().default(""),
  languages: z.string().default(""),
  resistances: z.string().default(""),
  immunities: z.string().default(""),
  traits: z.string().default(""),
  actions: z.string().default(""),
  reactions: z.string().default(""),
  legendary: z.string().default(""),
  legendary_actions: z.number().int().min(0).default(0),
});
export type CreatureFields = z.infer<typeof creatureFieldsSchema>;

export const ITEM_CATEGORIES = [
  "weapon",
  "armor",
  "shield",
  "equipment",
  "consumable",
  "potion",
  "scroll",
  "wondrous",
  "artifact",
  "quest",
  "key",
  "currency",
  "treasure",
  "material",
  "tool",
  "document",
  "custom",
] as const;

export const ITEM_RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "artifact", "varies"] as const;

export const itemFieldsSchema = z.object({
  category: z.enum(ITEM_CATEGORIES).default("equipment"),
  rarity: z.enum(ITEM_RARITIES).default("common"),
  weight: z.number().min(0).default(0),
  value_gp: z.number().min(0).default(0),
  damage: z.string().default(""),
  damage_type: z.string().default(""),
  properties: z.string().default(""),
  armor_class: z.string().default(""),
  charges_max: z.number().int().min(0).default(0),
  attunement: z.boolean().default(false),
  attunement_requirements: z.string().default(""),
  effects: z.string().default(""),
  restrictions: z.string().default(""),
  edition: z.string().default("5e (2014)"),
  stackable: z.boolean().default(true),
  magical: z.boolean().default(false),
  homebrew: z.boolean().default(false),
});
export type ItemFields = z.infer<typeof itemFieldsSchema>;

export const spellFieldsSchema = z.object({
  level: z.number().int().min(0).max(9).default(0),
  school: z.string().default(""),
  casting_time: z.string().default("1 action"),
  range: z.string().default(""),
  components: z.string().default(""),
  duration: z.string().default(""),
  classes: z.string().default(""),
  ritual: z.boolean().default(false),
  concentration: z.boolean().default(false),
});

export const factionFieldsSchema = z.object({
  faction_type: z.string().default("organization"),
  leader_id: z.string().nullable().default(null),
  headquarters_id: z.string().nullable().default(null),
  goals: z.string().default(""),
  resources: z.string().default(""),
  influence: z.number().int().min(0).max(10).default(5),
});

export const questFieldsSchema = z.object({
  giver_id: z.string().nullable().default(null),
  reward: z.string().default(""),
  level_range: z.string().default(""),
  hook: z.string().default(""),
  consequences: z.string().default(""),
  priority: z.enum(["main", "side", "personal", "rumor"]).default("side"),
});

export const trapFieldsSchema = z.object({
  trigger: z.string().default(""),
  effect: z.string().default(""),
  detect_dc: z.number().int().min(0).default(12),
  disarm_dc: z.number().int().min(0).default(12),
  save: z.string().default(""),
  damage: z.string().default(""),
  severity: z.enum(["setback", "dangerous", "deadly"]).default("setback"),
});

export const secretFieldsSchema = z.object({
  reveal_condition: z.string().default(""),
  revealed: z.boolean().default(false),
  revealed_at: z.string().nullable().default(null),
  importance: z.enum(["minor", "major", "campaign"]).default("minor"),
});

export const encounterFieldsSchema = z.object({
  encounter_type: z.enum(["combat", "social", "exploration", "puzzle", "hazard"]).default("combat"),
  difficulty: z.enum(["trivial", "easy", "medium", "hard", "deadly"]).default("medium"),
  environment: z.string().default(""),
  reinforcements: z.string().default(""),
  treasure: z.string().default(""),
  alternative_outcomes: z.string().default(""),
  conditional_events: z.string().default(""),
  xp_total: z.number().int().min(0).default(0),
});

export const sessionFieldsSchema = z.object({
  number: z.number().int().min(0).default(1),
  real_date: z.string().default(""),
  status: z.enum(["planned", "live", "completed"]).default("planned"),
  outline_md: z.string().default(""),
  recap_md: z.string().default(""),
  rewards_md: z.string().default(""),
  planned_encounter_ids: z.array(z.string()).default([]),
  location_ids: z.array(z.string()).default([]),
  started_at: z.string().nullable().default(null),
  ended_at: z.string().nullable().default(null),
});

export const locationFieldsSchema = z.object({
  population: z.string().default(""),
  government: z.string().default(""),
  climate: z.string().default(""),
  notable_features: z.string().default(""),
  rumors: z.string().default(""),
  services: z.string().default(""),
  discovered: z.boolean().default(false),
});

export const dungeonFieldsSchema = z.object({
  dungeon_type: z.string().default("dungeon"),
  threat_level: z.string().default(""),
  history: z.string().default(""),
  inhabitants: z.string().default(""),
  entrance: z.string().default(""),
});

export const calendarSchema = z.object({
  months: z.array(z.object({ name: z.string().min(1), days: z.number().int().min(1).max(400) })).min(1),
  weekdays: z.array(z.string()).default([]),
  era: z.string().default(""),
  year: z.number().int().default(1),
  month: z.number().int().min(1).default(1),
  day: z.number().int().min(1).default(1),
});

export const campaignFieldsSchema = z.object({
  edition: z.string().default("5e (2014)"),
  party_location_id: z.string().nullable().default(null),
  active_session_id: z.string().nullable().default(null),
  is_demo: z.boolean().default(false),
  calendar: calendarSchema.default({
    months: [
      "Frostfall",
      "Thawmoon",
      "Seedtide",
      "Greenrise",
      "Highsun",
      "Harvestmoon",
      "Emberwane",
      "Duskwind",
      "Deepcold",
      "Longnight",
      "Starfall",
      "Yearsend",
    ].map((name) => ({ name, days: 30 })),
    weekdays: ["Moonday", "Tideday", "Windsday", "Thornday", "Fireday", "Starday", "Sunday"],
    era: "AR",
    year: 1247,
    month: 4,
    day: 12,
  }),
});

export const KIND_FIELD_SCHEMAS: Partial<Record<(typeof ENTITY_KINDS)[number], z.ZodTypeAny>> = {
  campaign: campaignFieldsSchema,
  pc: characterFieldsSchema,
  npc: characterFieldsSchema,
  creature: creatureFieldsSchema,
  item: itemFieldsSchema,
  spell: spellFieldsSchema,
  faction: factionFieldsSchema,
  religion: factionFieldsSchema,
  quest: questFieldsSchema,
  trap: trapFieldsSchema,
  secret: secretFieldsSchema,
  encounter: encounterFieldsSchema,
  session: sessionFieldsSchema,
  settlement: locationFieldsSchema,
  region: locationFieldsSchema,
  kingdom: locationFieldsSchema,
  continent: locationFieldsSchema,
  district: locationFieldsSchema,
  building: locationFieldsSchema,
  location: locationFieldsSchema,
  dungeon: dungeonFieldsSchema,
};

/** Fills defaults for a kind's structured fields, keeping unknown keys. */
export function normalizeFields(kind: (typeof ENTITY_KINDS)[number], fields: unknown): Record<string, unknown> {
  const schema = KIND_FIELD_SCHEMAS[kind];
  const input = typeof fields === "object" && fields !== null ? (fields as Record<string, unknown>) : {};
  if (!schema) return input;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ...(schema.parse({}) as Record<string, unknown>), ...input };
  return { ...input, ...(parsed.data as Record<string, unknown>) };
}

export const entityInputSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(ENTITY_KINDS),
  name: z.string().trim().min(1, "Name is required").max(200),
  campaign_id: z.string().nullable().optional(),
  world_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  subtype: z.string().nullable().optional(),
  summary: z.string().max(2000).optional(),
  body_md: z.string().optional(),
  read_aloud_md: z.string().optional(),
  dm_notes_md: z.string().optional(),
  secret_md: z.string().optional(),
  tags: z.array(z.string()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  status: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
  image_asset: z.string().nullable().optional(),
});

export const diceRollSchema = z.number().int().min(1).max(100);
