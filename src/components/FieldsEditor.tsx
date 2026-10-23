import { z } from "zod";
import { KIND_FIELD_SCHEMAS } from "@/domain/schemas";
import type { EntityKind } from "@/domain/types";
import { Checkbox, Field, Input, Select, Textarea } from "./ui";
import { EntityPicker } from "./EntityPicker";

const LONG_TEXT = new Set(["skills", "attacks", "features", "traits", "actions", "reactions", "legendary", "goals", "resources", "hook", "consequences", "reward", "effects", "restrictions", "properties", "notable_features", "rumors", "services", "history", "inhabitants", "entrance", "reinforcements", "treasure", "alternative_outcomes", "conditional_events", "effect", "trigger", "reveal_condition", "motive", "voice", "saves", "senses", "languages", "resistances", "immunities"]);
const HIDDEN = new Set(["party_location_id", "active_session_id", "is_demo", "calendar", "planned_encounter_ids", "location_ids", "started_at", "ended_at", "outline_md", "recap_md", "rewards_md", "revealed_at"]);
const PICKERS: Record<string, EntityKind[]> = { giver_id: ["npc", "pc", "faction"], leader_id: ["npc", "pc"], headquarters_id: ["settlement", "building", "location", "dungeon", "district"] };

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

const titleCase = (key: string) => key.replace(/_id$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bHp\b/, "HP").replace(/\bAc\b/, "AC").replace(/\bCr\b/, "CR").replace(/\bXp\b/, "XP").replace(/\bDc\b/, "DC").replace(/\bGp\b/, "GP");

/** Generates a form for a kind's Zod field schema; unknown shapes fall back to JSON text. */
export function FieldsEditor({ kind, value, onChange }: { kind: EntityKind; value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const schema = KIND_FIELD_SCHEMAS[kind];
  if (!schema) return <div className="text-[12px] text-ink-faint">This kind has no structured fields.</div>;
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  const entries = Object.entries(shape).filter(([key]) => !HIDDEN.has(key));
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {entries.map(([key, raw]) => {
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
        if (type === "string") {
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
      })}
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
    .filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== false && !(typeof v === "number" && v === 0 && false));
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
