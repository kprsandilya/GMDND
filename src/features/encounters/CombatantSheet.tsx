import { Dices, Minus, Plus, RotateCcw, Skull, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { abilityModifier, formatModifier, roll } from "@/domain/dice";
import {
  actionsFromSheet,
  groupedActions,
  rollAttack,
  rollDamage,
  usageKey,
  usesLeft,
  writeActionsToSheet,
  type ActionGroup,
  type GroupedAction,
  type ParsedAction,
  type RollMode,
} from "@/domain/statblock";
import type { Combatant, EntityKind } from "@/domain/types";
import { cn, errorMessage } from "@/lib/utils";

const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;

const GROUP_LABELS: Record<ActionGroup, string> = {
  action: "Actions (this copy)",
  bonus: "Bonus actions",
  reaction: "Reactions",
  legendary: "Legendary actions",
};

function catalogPath(kind?: string | null, id?: string | null): string | null {
  if (!id) return null;
  if (kind === "creature") return `/creatures/${id}`;
  if (kind === "pc" || kind === "npc") return `/characters/${id}`;
  return null;
}

export interface GroupSaveRequest {
  ability: string;
  dc: number;
  damage: string | null;
  source: string;
}

/**
 * One combatant's own sheet. Every edit, roll and counter writes to this combatant only (never the
 * catalog entity). `onChanged` is called after each write so the caller can refresh and sync tokens.
 */
export function CombatantSheet({
  combatant: c,
  catalogName,
  catalogKind,
  editable,
  onChanged,
  onGroupSave,
}: {
  combatant: Combatant;
  catalogName?: string | null;
  catalogKind?: EntityKind | string | null;
  editable: boolean;
  onChanged: (updated: Combatant | null) => void;
  onGroupSave?: (request: GroupSaveRequest) => void;
}) {
  const repos = useRepos();
  const sheet = c.sheet ?? {};
  const actions = useMemo(() => actionsFromSheet(sheet), [sheet]);
  const grouped = useMemo(() => groupedActions(sheet), [sheet]);
  const abilities = (sheet.abilities ?? {}) as Record<string, number>;
  const [name, setName] = useState(c.name);
  const [notes, setNotes] = useState(c.notes);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [mode, setMode] = useState<RollMode>("normal");
  const [crit, setCrit] = useState(false);
  useEffect(() => {
    setName(c.name);
    setNotes(c.notes);
  }, [c.id, c.name, c.notes]);

  const run = async (fn: () => Promise<Combatant | null | void>) => {
    try {
      const result = await fn();
      onChanged(result ?? null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const onPatch = (patch: Partial<Combatant>) => void run(() => repos.encounters.updateCombatant(c.id, patch));
  const setSheet = (next: Record<string, unknown>, extra: Partial<Combatant> = {}) => {
    const ac = next.ac !== undefined ? Number(next.ac) : c.ac;
    const maxHp = Number(next.max_hp ?? next.hp ?? c.max_hp) || c.max_hp;
    onPatch({ sheet: next, ac, max_hp: maxHp, ...extra });
  };
  const setField = (key: string, value: unknown) => setSheet({ ...sheet, [key]: value });
  const logAbility = (action: GroupedAction, message: string) => void run(() => repos.encounters.useAbility(c.id, action, message));
  const adjust = (key: string, delta: number, label: string) => void run(() => repos.encounters.adjustResource(c.id, key, delta, label));

  const path = catalogPath(catalogKind, c.entity_id);
  const legendaryLeft = Number(c.resources.legendary ?? 0);
  const legendaryMax = Number(c.resources.legendary_max ?? sheet.legendary_actions ?? 0);
  const legresMax = Number(c.resources.legres_max ?? 0);
  const slotLevels = Object.keys(c.resources)
    .map((k) => /^slot_(\d)_max$/.exec(k)?.[1])
    .filter((x): x is string => !!x)
    .sort();
  const stable = c.conditions.some((x) => x.name === "stable");
  const dying = c.side === "party" && c.hp === 0 && !c.defeated && !stable;

  return (
    <div className="space-y-3 text-[12.5px]">
      <div>
        <div className="flex items-center gap-2">
          {editable ? (
            <Input
              className="h-7 font-semibold"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== c.name && onPatch({ name: name.trim() })}
            />
          ) : (
            <div className="font-semibold">{c.name}</div>
          )}
          <Badge tone={c.side === "party" ? "water" : c.side === "enemy" ? "blood" : c.side === "ally" ? "moss" : "default"}>{c.side}</Badge>
        </div>
        <div className="mt-1 text-[11px] text-ink-faint">
          {catalogName ? (
            <>
              Instance of{" "}
              {path ? (
                <Link to={path} className="text-ember-soft hover:underline" title="Catalog entry — not this copy">
                  {catalogName}
                </Link>
              ) : (
                catalogName
              )}
              {" · "}
              edits stay on this combatant
            </>
          ) : (
            "No catalog template — this copy is the whole sheet"
          )}
        </div>
      </div>

      <div className="text-[11px] text-ink-muted">
        {[sheet.class, sheet.level != null && sheet.level !== "" ? `Level ${sheet.level}` : null, sheet.background, sheet.race, sheet.size, sheet.type, sheet.alignment, sheet.cr != null && sheet.cr !== "" ? `CR ${sheet.cr}` : null]
          .filter(Boolean)
          .join(" · ")}
        {sheet.senses ? ` · ${String(sheet.senses)}` : ""}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <MiniField label="Armor Class" value={String(sheet.ac ?? c.ac ?? "")} editable={editable} onCommit={(v) => setField("ac", Number(v) || 0)} />
        <MiniField label="Initiative" value={String(sheet.initiative ?? c.initiative_mod ?? "")} editable={editable} onCommit={(v) => setField("initiative", Number(v) || 0)} />
        <MiniField label="Speed" value={String(sheet.speed ?? "")} editable={editable} onCommit={(v) => setField("speed", v)} />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <MiniField label="HP Max" value={String(sheet.max_hp ?? sheet.hp ?? c.max_hp)} editable={editable} onCommit={(v) => setField("max_hp", Number(v) || c.max_hp)} />
        <MiniField label="Temp HP" value={String(sheet.temp_hp ?? c.temp_hp ?? 0)} editable={editable} onCommit={(v) => setField("temp_hp", Number(v) || 0)} />
        <MiniField label="Hit Dice" value={String(sheet.hit_dice ?? "")} editable={editable} onCommit={(v) => setField("hit_dice", v)} />
        <MiniField label="Prof. Bonus" value={String(sheet.proficiency_bonus ?? "")} editable={editable} onCommit={(v) => setField("proficiency_bonus", Number(v) || 0)} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <MiniField label="Passive Perc." value={String(sheet.passive_perception ?? "")} editable={editable} onCommit={(v) => setField("passive_perception", Number(v) || 0)} />
        <MiniField label="Inspiration" value={sheet.inspiration ? "yes" : ""} editable={editable} onCommit={(v) => setField("inspiration", /^(1|y|yes|true)$/i.test(v.trim()))} />
        <MiniField
          label={sheet.cr !== undefined && sheet.cr !== "" ? "Challenge" : "XP"}
          value={String(sheet.cr ?? sheet.xp ?? "")}
          editable={editable}
          onCommit={(v) => setField(sheet.cr !== undefined ? "cr" : "xp", sheet.cr !== undefined ? v : Number(v) || 0)}
        />
      </div>

      <div className="grid grid-cols-6 gap-1">
        {ABILS.map((a) => {
          const score = Number(abilities[a] ?? 10) || 10;
          return (
            <label key={a} className="text-center">
              <span className="block text-[10px] uppercase text-ink-faint">{a}</span>
              {editable ? (
                <Input
                  type="number"
                  min={1}
                  max={30}
                  className="h-7 text-center"
                  value={score}
                  onChange={(e) => setField("abilities", { ...abilities, [a]: Number(e.target.value) || 10 })}
                />
              ) : (
                <div className="font-mono">{score}</div>
              )}
              <div className="text-[10px] text-ink-faint">{formatModifier(abilityModifier(score))}</div>
            </label>
          );
        })}
      </div>

      {dying && (
        <div className="rounded border border-blood/50 bg-blood/10 p-2">
          <div className="mb-1 flex items-center gap-1 font-semibold text-blood">
            <Skull size={12} /> Dying · successes {c.resources.death_success ?? 0}/3 · failures {c.resources.death_fail ?? 0}/3
          </div>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => void run(() => repos.encounters.rollDeathSave(c.id))}>
              <Dices size={11} /> Roll death save
            </Button>
          )}
        </div>
      )}
      {stable && c.hp === 0 && <div className="rounded border border-moss/50 bg-moss/10 p-2 text-moss">Stable at 0 HP. Any damage restarts death saves.</div>}

      {(legresMax > 0 || slotLevels.length > 0) && (
        <div className="space-y-1 rounded border border-border p-1.5">
          <div className="label">Resources this fight</div>
          {legresMax > 0 && (
            <Counter label="Legendary resistance" value={Number(c.resources.legres ?? 0)} max={legresMax} editable={editable} onAdjust={(d) => adjust("legres", d, "legendary resistance")} />
          )}
          {slotLevels.map((level) => (
            <Counter
              key={level}
              label={`Level ${level} slots`}
              value={Number(c.resources[`slot_${level}`] ?? 0)}
              max={Number(c.resources[`slot_${level}_max`] ?? 0)}
              editable={editable}
              onAdjust={(d) => adjust(`slot_${level}`, d, `a level ${level} spell slot`)}
            />
          ))}
        </div>
      )}

      {["saves", "save_proficiencies", "skills", "skill_proficiencies", "other_proficiencies", "languages", "traits", "vulnerabilities", "resistances", "immunities", "condition_immunities"].map((key) =>
        sheet[key] ? (
          <BlobField key={key} label={key.replace(/_/g, " ")} value={String(sheet[key] ?? "")} editable={editable} onCommit={(v) => setField(key, v)} />
        ) : null,
      )}

      {editable && grouped.length > 0 && (
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-ink-faint">Attack rolls:</span>
          {(["normal", "advantage", "disadvantage"] as const).map((m) => (
            <button key={m} className={cn("chip", mode === m && "border-ember text-ember-soft")} onClick={() => setMode(m)}>
              {m === "normal" ? "normal" : m === "advantage" ? "adv" : "dis"}
            </button>
          ))}
          <button className={cn("chip ml-2", crit && "border-blood text-blood")} onClick={() => setCrit(!crit)} title="Double the damage dice">
            crit damage
          </button>
        </div>
      )}

      {(["action", "bonus", "reaction", "legendary"] as const).map((group) => {
        const entries = grouped.map((a, i) => ({ a, i })).filter(({ a }) => a.group === group);
        if (group !== "action" && entries.length === 0) return null;
        return (
          <div key={group}>
            <div className="label flex items-center gap-2">
              {GROUP_LABELS[group]}
              {group === "legendary" && legendaryMax > 0 && (
                <span className="flex items-center gap-1 normal-case text-ink-muted">
                  {legendaryLeft}/{legendaryMax} left
                  {editable && (
                    <Button size="sm" variant="outline" disabled={legendaryLeft <= 0} onClick={() => void run(() => repos.encounters.spendLegendary(c.id))}>
                      Spend 1
                    </Button>
                  )}
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {entries.map(({ a: action, i }) => {
                const left = usesLeft(c.resources, action);
                const exhausted = left !== null && left <= 0;
                const limitLabel = action.limit
                  ? action.limit.kind === "recharge"
                    ? `Recharge ${action.limit.min}${action.limit.min < 6 ? "–6" : ""} · ${exhausted ? "spent" : "ready"}`
                    : `${left}/${action.limit.uses} per day`
                  : null;
                const use = (message: string) => {
                  if (exhausted) {
                    toast.error(`${action.title} is ${action.limit?.kind === "recharge" ? "not recharged" : "used up"}.`);
                    return;
                  }
                  logAbility(action, message);
                };
                return (
                  <li key={`${group}-${action.title}-${i}`} className={cn("rounded border border-border bg-bg p-1.5", exhausted && "opacity-60")}>
                    {group === "action" && editing === i && editable ? (
                      <div className="space-y-1">
                        <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                        <Textarea rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              const next = actions.map((a, j) => (j === i ? { ...a, title: editTitle.trim() || a.title, body: editBody.trim() || a.body } : a));
                              setSheet(writeActionsToSheet(sheet, next));
                              setEditing(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-1">
                          <button
                            className={cn("text-left font-semibold text-ember-soft hover:underline", !editable && "cursor-default hover:no-underline")}
                            disabled={!editable}
                            onClick={() => use(`${c.name} uses ${action.title}.`)}
                          >
                            {action.title}
                          </button>
                          {limitLabel && (
                            <span className={cn("chip text-[10px]", exhausted ? "text-blood" : "text-moss")}>
                              {limitLabel}
                            </span>
                          )}
                          {editable && (
                            <span className="ml-auto flex gap-1">
                              {exhausted && action.limit && (
                                <button
                                  className="text-[11px] text-ink-faint hover:text-ink"
                                  onClick={() => adjust(usageKey(action.limit!, action.title), 1, action.title)}
                                  title="Restore one use by hand"
                                >
                                  restore
                                </button>
                              )}
                              {group === "action" && (
                                <>
                                  <button
                                    className="text-[11px] text-ink-faint hover:text-ink"
                                    onClick={() => {
                                      setEditing(i);
                                      setEditTitle(action.title);
                                      setEditBody(action.body);
                                    }}
                                  >
                                    edit
                                  </button>
                                  <button
                                    className="text-ink-faint hover:text-blood"
                                    onClick={() => setSheet(writeActionsToSheet(sheet, actions.filter((_, j) => j !== i)))}
                                    title="Remove from this copy"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-ink-muted">{action.body}</div>
                        {editable && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {action.toHit !== null && (
                              <Button size="sm" variant="outline" onClick={() => use(formatAttack(c.name, action, action.toHit!, mode))}>
                                <Dices size={11} /> To hit {formatModifier(action.toHit)}
                                {mode !== "normal" ? ` (${mode === "advantage" ? "adv" : "dis"})` : ""}
                              </Button>
                            )}
                            {action.dice.map((d) => (
                              <Button key={d} size="sm" variant="outline" onClick={() => use(formatDamage(c.name, action, d, crit))}>
                                <Dices size={11} /> {d}
                                {crit ? " ×crit" : ""}
                              </Button>
                            ))}
                            {action.save && onGroupSave && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  use(`${c.name} uses ${action.title} (DC ${action.save!.dc} ${action.save!.ability} save).`);
                                  onGroupSave({ ability: action.save!.ability, dc: action.save!.dc, damage: action.dice[0] ?? null, source: `${c.name}: ${action.title}` });
                                }}
                              >
                                <Users size={11} /> Group save DC {action.save.dc} {action.save.ability.slice(0, 3)}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => use(`${c.name} uses ${action.title}.`)}>
                              Log use
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
              {group === "action" && entries.length === 0 && <li className="text-[11.5px] text-ink-faint">No actions on this copy yet.</li>}
            </ul>
            {group === "action" && editable && (
              <div className="mt-2 space-y-1 rounded border border-dashed border-border p-1.5">
                <Input placeholder="Action name" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                <Textarea rows={2} placeholder="Reed Knife. +3 to hit, 1d4+1 slashing." value={newBody} onChange={(e) => setNewBody(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newTitle.trim() && !newBody.trim()}
                  onClick={() => {
                    const title = newTitle.trim() || "Action";
                    const body = newBody.trim() || title;
                    setSheet(writeActionsToSheet(sheet, [...actions, { title, body, dice: [], toHit: null }]));
                    setNewTitle("");
                    setNewBody("");
                  }}
                >
                  <Plus size={11} /> Add action to this copy
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {editable && <BlobField label="bonus actions (text)" value={String(sheet.bonus_actions ?? "")} editable={editable} onCommit={(v) => setField("bonus_actions", v)} />}
      {editable && <BlobField label="reactions (text)" value={String(sheet.reactions ?? "")} editable={editable} onCommit={(v) => setField("reactions", v)} />}
      {editable && <BlobField label="legendary (text)" value={String(sheet.legendary ?? "")} editable={editable} onCommit={(v) => setField("legendary", v)} />}
      {Boolean(sheet.features || sheet.additional_features) && (
        <>
          {sheet.features ? <BlobField label="features & traits" value={String(sheet.features)} editable={editable} onCommit={(v) => setField("features", v)} /> : null}
          {sheet.additional_features ? <BlobField label="additional features" value={String(sheet.additional_features)} editable={editable} onCommit={(v) => setField("additional_features", v)} /> : null}
        </>
      )}
      {Boolean(sheet.spellcasting_class || sheet.spells) && (
        <div className="space-y-1.5">
          <div className="label">Spellcasting</div>
          <div className="grid grid-cols-2 gap-1.5">
            <MiniField label="Class" value={String(sheet.spellcasting_class ?? "")} editable={editable} onCommit={(v) => setField("spellcasting_class", v)} />
            <MiniField label="Ability" value={String(sheet.spellcasting_ability ?? "")} editable={editable} onCommit={(v) => setField("spellcasting_ability", v)} />
            <MiniField label="Save DC" value={String(sheet.spell_save_dc ?? "")} editable={editable} onCommit={(v) => setField("spell_save_dc", Number(v) || 0)} />
            <MiniField label="Spell atk" value={String(sheet.spell_attack_bonus ?? "")} editable={editable} onCommit={(v) => setField("spell_attack_bonus", Number(v) || 0)} />
          </div>
          <MiniField label="Slots (e.g. 1st: 4, 2nd: 3)" value={String(sheet.spell_slots ?? "")} editable={editable} onCommit={(v) => setField("spell_slots", v)} />
          <BlobField label="spells" value={String(sheet.spells ?? "")} editable={editable} onCommit={(v) => setField("spells", v)} />
        </div>
      )}
      {Boolean(sheet.personality_traits || sheet.ideals || sheet.bonds || sheet.flaws) && (
        <div className="space-y-1.5">
          <div className="label">Personality</div>
          <BlobField label="personality traits" value={String(sheet.personality_traits ?? "")} editable={editable} onCommit={(v) => setField("personality_traits", v)} />
          <BlobField label="ideals" value={String(sheet.ideals ?? "")} editable={editable} onCommit={(v) => setField("ideals", v)} />
          <BlobField label="bonds" value={String(sheet.bonds ?? "")} editable={editable} onCommit={(v) => setField("bonds", v)} />
          <BlobField label="flaws" value={String(sheet.flaws ?? "")} editable={editable} onCommit={(v) => setField("flaws", v)} />
        </div>
      )}

      <Field label="Instance notes">
        <Textarea
          rows={2}
          value={notes}
          disabled={!editable}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== c.notes && onPatch({ notes })}
          placeholder="This copy is missing a knife, already used a potion…"
        />
      </Field>

      {editable && c.entity_id && (
        <Button size="sm" variant="ghost" onClick={() => void run(() => repos.encounters.resetSheetFromTemplate(c.id))}>
          <RotateCcw size={11} /> Reset this copy to the catalog template (keeps current HP)
        </Button>
      )}
    </div>
  );
}


function Counter({ label, value, max, editable, onAdjust }: { label: string; value: number; max: number; editable: boolean; onAdjust: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="w-36 text-ink-muted">{label}</span>
      <span className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cn("h-2.5 w-2.5 rounded-full border", i < value ? "border-ember bg-ember" : "border-border-strong")} />
        ))}
      </span>
      <span className="font-mono text-ink-faint">
        {value}/{max}
      </span>
      {editable && (
        <span className="ml-auto flex gap-0.5">
          <Button size="sm" variant="ghost" disabled={value <= 0} onClick={() => onAdjust(-1)} title="Use one">
            <Minus size={10} />
          </Button>
          <Button size="sm" variant="ghost" disabled={value >= max} onClick={() => onAdjust(1)} title="Restore one">
            <Plus size={10} />
          </Button>
        </span>
      )}
    </div>
  );
}

function MiniField({ label, value, editable, onCommit }: { label: string; value: string; editable: boolean; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Field label={label}>
      <Input className="h-7" value={local} disabled={!editable} onChange={(e) => setLocal(e.target.value)} onBlur={() => local !== value && onCommit(local)} />
    </Field>
  );
}

function BlobField({ label, value, editable, onCommit }: { label: string; value: string; editable: boolean; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  if (!editable && !value) return null;
  return (
    <Field label={label}>
      {editable ? <Textarea rows={2} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => local !== value && onCommit(local)} /> : <div className="whitespace-pre-wrap text-ink-muted">{value}</div>}
    </Field>
  );
}

/** "Goblin 2 attacks with Scimitar: 17 (d20 15 +2, advantage 15/9)". Nat 20 / nat 1 are called out. */
export function formatAttack(name: string, action: Pick<ParsedAction, "title">, bonus: number, mode: RollMode = "normal", random?: () => number): string {
  const r = rollAttack(bonus, mode, random);
  const detail = mode === "normal" ? `d20 ${r.d20}` : `${mode} ${r.rolls.join("/")} → ${r.d20}`;
  const flag = r.crit ? " — natural 20, critical hit!" : r.fumble ? " — natural 1, miss." : "";
  return `${name} attacks with ${action.title}: ${r.total} to hit (${detail} ${formatModifier(bonus)})${flag}`;
}

export function formatDamage(name: string, action: Pick<ParsedAction, "title">, expression: string, crit = false, random?: () => number): string {
  const r = rollDamage(expression, crit, random);
  if (!r) return `${name} uses ${action.title} (${expression}).`;
  const mod = r.modifier ? ` ${formatModifier(r.modifier)}` : "";
  return `${name} ${action.title} damage${crit ? " (critical)" : ""}: ${expression} = ${r.total} [${r.rolls.join(", ")}]${mod}.`;
}

/** Kept for callers that log a free-form roll. */
export function formatActionRoll(name: string, action: ParsedAction, expression?: string): string {
  if (!expression) return `${name} uses ${action.title}.`;
  try {
    const result = roll(expression);
    const detail = result.rolls.length ? ` [${result.rolls.join(", ")}]${result.expression.modifier ? ` ${formatModifier(result.expression.modifier)}` : ""}` : "";
    return `${name} uses ${action.title}: ${expression} = ${result.total}${detail}.`;
  } catch {
    return `${name} uses ${action.title} (${expression}).`;
  }
}
