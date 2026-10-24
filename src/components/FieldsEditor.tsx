import { z } from "zod";
import { KIND_FIELD_SCHEMAS } from "@/domain/schemas";
import type { EntityKind } from "@/domain/types";
import { Checkbox, Field, Input, Select, Textarea } from "./ui";
import { EntityPicker } from "./EntityPicker";

const LONG_TEXT = new Set([
  "skills",
  "skill_proficiencies",
  "save_proficiencies",
  "attacks",
  "features",
  "additional_features",
  "traits",
  "actions",
  "bonus_actions",
  "reactions",
  "legendary",
  "lair",
  "mythic",
  "goals",
  "resources",
  "hook",
  "consequences",
  "reward",
  "effects",
  "restrictions",
  "properties",
  "notable_features",
  "rumors",
  "services",
  "history",
  "inhabitants",
  "entrance",
  "reinforcements",
  "treasure",
  "alternative_outcomes",
  "conditional_events",
  "effect",
  "trigger",
  "reveal_condition",
  "motive",
  "voice",
  "saves",
  "senses",
  "languages",
  "other_proficiencies",
  "resistances",
  "immunities",
  "vulnerabilities",
  "condition_immunities",
  "personality_traits",
  "ideals",
  "bonds",
  "flaws",
  "appearance",
  "allies",
  "backstory",
  "treasure_notes",
  "equipment",
  "spells",
  "spell_slots",
  "ac_notes",
]);
const HIDDEN = new Set(["party_location_id", "active_session_id", "is_demo", "calendar", "planned_encounter_ids", "location_ids", "started_at", "ended_at", "outline_md", "recap_md", "rewards_md", "revealed_at"]);
const PICKERS: Record<string, EntityKind[]> = { giver_id: ["npc", "pc", "faction"], leader_id: ["npc", "pc"], headquarters_id: ["settlement", "building", "location", "dungeon", "district"] };

const CHARACTER_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Identity", keys: ["race", "class", "level", "background", "alignment", "xp", "player_name"] },
  { title: "Combat", keys: ["inspiration", "proficiency_bonus", "ac", "initiative", "speed", "hp", "max_hp", "temp_hp", "hit_dice", "hit_dice_current"] },
  { title: "Ability scores", keys: ["abilities"] },
  { title: "Saving throws & skills", keys: ["save_proficiencies", "saves", "skill_proficiencies", "skills", "passive_perception", "other_proficiencies", "languages"] },
  { title: "Attacks & spellcasting", keys: ["weapon1_name", "weapon1_atk", "weapon1_damage", "weapon2_name", "weapon2_atk", "weapon2_damage", "weapon3_name", "weapon3_atk", "weapon3_damage", "attacks", "spellcasting_class", "spellcasting_ability", "spell_save_dc", "spell_attack_bonus", "spell_slots", "spells"] },
  { title: "Features & traits", keys: ["features", "additional_features"] },
  { title: "Personality", keys: ["personality_traits", "ideals", "bonds", "flaws"] },
  { title: "Appearance & story", keys: ["age", "height", "weight", "eyes", "skin", "hair", "appearance", "allies", "faction", "backstory", "treasure_notes", "equipment"] },
  { title: "Coins", keys: ["cp", "sp", "ep", "gp", "pp"] },
  { title: "NPC", keys: ["occupation", "motive", "voice", "attitude"] },
];

const CREATURE_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Identity", keys: ["size", "type", "alignment", "cr", "xp", "proficiency_bonus"] },
  { title: "Combat", keys: ["ac", "ac_notes", "initiative", "speed", "hp", "max_hp", "hp_formula", "temp_hp", "hit_dice", "inspiration"] },
  { title: "Ability scores", keys: ["abilities"] },
  { title: "Saves, skills & senses", keys: ["save_proficiencies", "saves", "skill_proficiencies", "skills", "passive_perception", "senses", "languages", "other_proficiencies"] },
  { title: "Defenses", keys: ["vulnerabilities", "resistances", "immunities", "condition_immunities"] },
  { title: "Attacks & spellcasting", keys: ["weapon1_name", "weapon1_atk", "weapon1_damage", "weapon2_name", "weapon2_atk", "weapon2_damage", "weapon3_name", "weapon3_atk", "weapon3_damage", "attacks", "actions", "bonus_actions", "reactions", "spellcasting_class", "spellcasting_ability", "spell_save_dc", "spell_attack_bonus", "spell_slots", "spells"] },
  { title: "Traits & legendary", keys: ["traits", "legendary", "legendary_actions", "legendary_resistances", "lair", "mythic"] },
];

const FIELD_GROUPS: Partial<Record<EntityKind, { title: string; keys: string[] }[]>> = {
  pc: CHARACTER_GROUPS,
  npc: CHARACTER_GROUPS,
  creature: CREATURE_GROUPS,
};

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: z.ZodTypeAny = schema;
  for (;;) {
    const def = (s as unknown as { def?: { type?: string; innerType?: z.ZodTypeAny } }).def ?? (s as unknown as { _def?: { type?: string; innerType?: z.ZodTypeAny } })._def;
    if (def && (def.type === "default" || def.type === "optional" || def.type === "nullable") && def.innerType) s = def.innerType;
    else return s;
  }
}

function typeOf(schema: z.ZodTypeAny): string {
  const def = (schema as unknown as { def?: { type?: string } }).def ?? (schema as unknown as { _def?: { type?: string } })._def;
  return def?.type ?? "unknown";
}

function enumValues(schema: z.ZodTypeAny): string[] {
  const def = (schema as unknown as { def?: { entries?: Record<string, string> } }).def ?? (schema as unknown as { _def?: { entries?: Record<string, string> } })._def;
  return def?.entries ? Object.values(def.entries) : [];
}

const titleCase = (key: string) =>
  key
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHp\b/, "HP")
    .replace(/\bAc\b/, "AC")
    .replace(/\bCr\b/, "CR")
    .replace(/\bXp\b/, "XP")
    .replace(/\bDc\b/, "DC")
    .replace(/\bGp\b/, "GP")
    .replace(/\bCp\b/, "CP")
    .replace(/\bSp\b/, "SP")
    .replace(/\bEp\b/, "EP")
    .replace(/\bPp\b/, "PP")
    .replace(/\bAtk\b/, "Atk");

/** Generates a form for a kind's Zod field schema; unknown shapes fall back to JSON text. */
export function FieldsEditor({ kind, value, onChange }: { kind: EntityKind; value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const schema = KIND_FIELD_SCHEMAS[kind];
  if (!schema) return <div className="text-[12px] text-ink-faint">This kind has no structured fields.</div>;
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  const renderField = (key: string, raw: z.ZodTypeAny) => {
        const inner = unwrap(raw as z.ZodTypeAny);
        const type = typeOf(inner);
        const label = titleCase(key);
        const current = value[key];
        if (PICKERS[key]) {
          return (
            <Field key={key} label={label}>
              <EntityPicker kinds={PICKERS[key]!} value={(current as string | null) ?? null} onChange={(id) => set(key, id)} allowNone />
            </Field>
          );
        }
        if (type === "object" && key === "abilities") {
          const abilities = (current as Record<string, number>) ?? {};
          return (
            <div key={key} className="col-span-2">
              <span className="label">Ability scores</span>
              <div className="grid grid-cols-6 gap-1.5">
                {["str", "dex", "con", "int", "wis", "cha"].map((a) => (
                  <label key={a} className="text-center">
                    <span className="block text-[10px] uppercase text-ink-faint">{a}</span>
                    <Input type="number" min={1} max={30} className="text-center" value={abilities[a] ?? 10} onChange={(e) => set(key, { ...abilities, [a]: Number(e.target.value) })} />
                  </label>
                ))}
              </div>
            </div>
          );
        }
        if (type === "boolean") {
          return <Checkbox key={key} label={label} checked={Boolean(current)} onChange={(v) => set(key, v)} className="mt-5" />;
        }
        if (type === "number") {
          return (
            <Field key={key} label={label}>
              <Input type="number" value={typeof current === "number" ? current : ""} onChange={(e) => set(key, e.target.value === "" ? 0 : Number(e.target.value))} />
            </Field>
          );
        }
        if (type === "enum") {
          return (
            <Field key={key} label={label}>
              <Select value={String(current ?? "")} onChange={(e) => set(key, e.target.value)}>
                {enumValues(inner).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (type === "union" || type === "string") {
          if (LONG_TEXT.has(key)) {
            return (
              <Field key={key} label={label} className="col-span-2">
                <Textarea rows={3} value={String(current ?? "")} onChange={(e) => set(key, e.target.value)} />
              </Field>
            );
          }
          return (
            <Field key={key} label={label}>
              <Input value={String(current ?? "")} onChange={(e) => set(key, e.target.value)} />
            </Field>
          );
        }
        return (
          <Field key={key} label={`${label} (JSON)`} className="col-span-2">
            <Textarea
              rows={2}
              className="font-mono text-[11px]"
              defaultValue={JSON.stringify(current ?? null)}
              onBlur={(e) => {
                try {
                  set(key, JSON.parse(e.target.value));
                } catch {
                  /* keep previous */
                }
              }}
            />
          </Field>
        );
  };

  const groups = FIELD_GROUPS[kind];
  const used = new Set<string>();
  const grouped = (groups ?? [{ title: "", keys: Object.keys(shape).filter((k) => !HIDDEN.has(k)) }]).map((group) => ({
    ...group,
    keys: group.keys.filter((key) => key in shape && !HIDDEN.has(key)),
  })).filter((group) => group.keys.length > 0);
  grouped.forEach((group) => group.keys.forEach((key) => used.add(key)));
  const leftover = Object.keys(shape).filter((key) => !HIDDEN.has(key) && !used.has(key));
  if (leftover.length) grouped.push({ title: "Other", keys: leftover });

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.title || "fields"}>
          {group.title ? <div className="label mb-1.5">{group.title}</div> : null}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {group.keys.map((key) => renderField(key, shape[key] as z.ZodTypeAny))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact read-only rendering of structured fields for detail views. */
export function FieldsSummary({ kind, fields }: { kind: EntityKind; fields: Record<string, unknown> }) {
  const schema = KIND_FIELD_SCHEMAS[kind];
  if (!schema) return null;
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const rows = Object.keys(shape)
    .filter((k) => !HIDDEN.has(k) && k !== "abilities")
    .map((k) => [k, fields[k]] as const)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== false && !(typeof v === "number" && v === 0));
  const abilities = fields.abilities as Record<string, number> | undefined;
  return (
    <div className="space-y-2">
      {abilities && (
        <div className="grid grid-cols-6 gap-1 text-center">
          {["str", "dex", "con", "int", "wis", "cha"].map((a) => {
            const score = abilities[a] ?? 10;
            const mod = Math.floor((score - 10) / 2);
            return (
              <div key={a} className="rounded border border-border bg-bg p-1">
                <div className="text-[10px] uppercase text-ink-faint">{a}</div>
                <div className="font-semibold">{score}</div>
                <div className="text-[11px] text-ink-muted">{mod >= 0 ? `+${mod}` : mod}</div>
              </div>
            );
          })}
        </div>
      )}
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-faint">{titleCase(k)}</dt>
            <dd className={typeof v === "string" && v.length > 60 ? "col-span-2 whitespace-pre-wrap pl-2 text-ink" : "text-ink"}>{typeof v === "object" ? JSON.stringify(v) : String(v === true ? "yes" : v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
