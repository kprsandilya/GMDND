import { Dices, Plus, RotateCcw, Skull, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { abilityModifier, formatModifier, roll } from "@/domain/dice";
import { actionsFromSheet, writeActionsToSheet, type ParsedAction } from "@/domain/statblock";
import type { Combatant, EntityKind } from "@/domain/types";
import { cn } from "@/lib/utils";

const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;

function catalogPath(kind?: string | null, id?: string | null): string | null {
  if (!id) return null;
  if (kind === "creature") return `/creatures/${id}`;
  if (kind === "pc" || kind === "npc") return `/characters/${id}`;
  return null;
}

export function CombatantSheet({
  combatant: c,
  catalogName,
  catalogKind,
  editable,
  onPatch,
  onUseAction,
  onSpendLegendary,
  onReset,
  onDeathSave,
}: {
  combatant: Combatant;
  catalogName?: string | null;
  catalogKind?: EntityKind | string | null;
  editable: boolean;
  onPatch: (patch: Partial<Combatant>) => void;
  onUseAction: (action: ParsedAction, dice?: string) => void;
  onSpendLegendary: () => void;
  onReset?: () => void;
  onDeathSave?: () => void;
}) {
  const sheet = c.sheet ?? {};
  const actions = useMemo(() => actionsFromSheet(sheet), [sheet]);
  const abilities = (sheet.abilities ?? {}) as Record<string, number>;
  const [name, setName] = useState(c.name);
  const [notes, setNotes] = useState(c.notes);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  useEffect(() => {
    setName(c.name);
    setNotes(c.notes);
  }, [c.id, c.name, c.notes]);

  const setSheet = (next: Record<string, unknown>, extra: Partial<Combatant> = {}) => {
    const ac = next.ac !== undefined ? Number(next.ac) : c.ac;
    const maxHp = Number(next.max_hp ?? next.hp ?? c.max_hp) || c.max_hp;
    onPatch({ sheet: next, ac, max_hp: maxHp, ...extra });
  };
  const setField = (key: string, value: unknown) => setSheet({ ...sheet, [key]: value });
  const path = catalogPath(catalogKind, c.entity_id);
  const legendaryLeft = Number(c.resources.legendary ?? 0);
  const legendaryMax = Number(c.resources.legendary_max ?? sheet.legendary_actions ?? 0);
  const dying = c.side === "party" && c.hp === 0 && !c.defeated;

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

      <div className="grid grid-cols-4 gap-1.5">
        <MiniField label="AC" value={String(sheet.ac ?? c.ac ?? "")} editable={editable} onCommit={(v) => setField("ac", Number(v) || 0)} />
        <MiniField label="Max HP" value={String(sheet.max_hp ?? sheet.hp ?? c.max_hp)} editable={editable} onCommit={(v) => setField("max_hp", Number(v) || c.max_hp)} />
        <MiniField label="Speed" value={String(sheet.speed ?? "")} editable={editable} onCommit={(v) => setField("speed", v)} />
        <MiniField label="CR / lvl" value={String(sheet.cr ?? sheet.level ?? "")} editable={editable} onCommit={(v) => setField(sheet.level !== undefined ? "level" : "cr", v)} />
      </div>
      <div className="text-[11px] text-ink-muted">
        {[sheet.size, sheet.type, sheet.alignment].filter(Boolean).join(" · ")}
        {sheet.senses ? ` · ${String(sheet.senses)}` : ""}
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
          {editable && onDeathSave && (
            <Button size="sm" variant="outline" onClick={onDeathSave}>
              <Dices size={11} /> Roll death save
            </Button>
          )}
        </div>
      )}

      {["traits", "resistances", "immunities", "saves", "skills"].map((key) =>
        sheet[key] || editable ? (
          <BlobField key={key} label={key} value={String(sheet[key] ?? "")} editable={editable} onCommit={(v) => setField(key, v)} />
        ) : null,
      )}

      <div>
        <div className="label">Actions (this copy)</div>
        <ul className="space-y-1.5">
          {actions.map((action, i) => {
            const toHit = action.toHit;
            return (
            <li key={`${action.title}-${i}`} className="rounded border border-border bg-bg p-1.5">
              {editing === i && editable ? (
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
                      onClick={() => onUseAction(action)}
                    >
                      {action.title}
                    </button>
                    {editable && (
                      <span className="ml-auto flex gap-1">
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
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-ink-muted">{action.body}</div>
                  {editable && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {toHit !== null && (
                        <Button size="sm" variant="outline" onClick={() => onUseAction(action, `1d20${toHit >= 0 ? "+" : ""}${toHit}`)}>
                          <Dices size={11} /> To hit {formatModifier(toHit)}
                        </Button>
                      )}
                      {action.dice.map((d) => (
                        <Button key={d} size="sm" variant="outline" onClick={() => onUseAction(action, d)}>
                          <Dices size={11} /> {d}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => onUseAction(action)}>
                        Log use
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
            );
          })}
          {actions.length === 0 && <li className="text-[11.5px] text-ink-faint">No actions on this copy yet.</li>}
        </ul>
        {editable && (
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

      {(sheet.reactions || editable) && <BlobField label="reactions" value={String(sheet.reactions ?? "")} editable={editable} onCommit={(v) => setField("reactions", v)} />}
      {(sheet.legendary || legendaryMax > 0 || editable) && (
        <div>
          <BlobField label="legendary" value={String(sheet.legendary ?? "")} editable={editable} onCommit={(v) => setField("legendary", v)} />
          {legendaryMax > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">
                Legendary actions {legendaryLeft}/{legendaryMax}
              </span>
              {editable && (
                <Button size="sm" variant="outline" disabled={legendaryLeft <= 0} onClick={onSpendLegendary}>
                  Spend 1
                </Button>
              )}
            </div>
          )}
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

      {editable && onReset && c.entity_id && (
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw size={11} /> Reset this copy to the catalog template (keeps current HP)
        </Button>
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
