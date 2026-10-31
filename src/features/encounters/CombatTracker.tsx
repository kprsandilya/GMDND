import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Dices, Flag, GripVertical, Heart, Map as MapIcon, Minus, Plus, Shield, Skull, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { qk, useAction } from "@/app/queries";
import { EntityPicker } from "@/components/EntityPicker";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, TabPanel, Tabs, Textarea, Tooltip } from "@/components/ui";
import { d20 } from "@/domain/dice";
import { CONDITION_REMINDERS, concentrationDc, enemyMorale, initialResources, snapshotSheet } from "@/domain/statblock";
import type { Combatant, EncounterOutcomes, Entity } from "@/domain/types";
import { finishEncounter, syncCombatantToToken } from "@/domain/workflows/encounterWorkflow";
import { cn, errorMessage } from "@/lib/utils";
import { sortCombatants } from "@/persistence/repositories/encounters";
import { CombatantSheet } from "./CombatantSheet";
import { GroupSaveDialog, type GroupSavePreset } from "./GroupSaveDialog";

const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "concentrating", "exhaustion"];

/** Initiative order, HP/conditions per combatant, round/turn control and the outcome commit dialog. */
export function CombatTracker({ runId, encounter }: { runId: string; encounter: Entity }) {
  const repos = useRepos();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const run = useQuery({ queryKey: qk.run(runId), queryFn: () => repos.encounters.getRun(runId) });
  const floor = useQuery({ queryKey: qk.floor(run.data?.floor_id ?? null), queryFn: () => repos.dungeons.findFloor(run.data?.floor_id), enabled: !!run.data?.floor_id });
  const combatants = useQuery({ queryKey: ["encounters", "combatants", runId], queryFn: () => repos.encounters.combatants(runId) });
  const [finishing, setFinishing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState("sheet");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupSave, setGroupSave] = useState<GroupSavePreset | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const invalidate = [qk.run(runId), ["encounters", "combatants", runId], ["encounters", "runs"], ["dungeon"], ["entities"]];
  const refresh = () => invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k as unknown[] }));

  const act = async <T,>(fn: () => Promise<T>, sync?: (r: T) => Combatant | null) => {
    try {
      const r = await fn();
      const c = sync?.(r);
      if (c) await syncCombatantToToken(repos, c);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const begin = () => act(() => repos.encounters.begin(runId));
  const next = () => act(() => repos.encounters.nextTurn(runId));
  const selected = (combatants.data ?? []).find((c) => c.id === selectedId) ?? null;
  const selectedEntity = useQuery({
    queryKey: ["entity", selected?.entity_id ?? null],
    queryFn: () => repos.entities.find(selected!.entity_id),
    enabled: !!selected?.entity_id,
  });

  useEffect(() => {
    if (!selectedId) return;
    const prev = (combatants.data ?? []).find((x) => x.id === selectedId);
    if (prev && Object.keys(prev.sheet).length > 0) return;
    void repos.encounters.ensureSheet(selectedId).then((c) => {
      if (Object.keys(c.sheet).length > 0) refresh();
    });
  }, [selectedId, combatants.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key.toLowerCase() !== "s" || e.ctrlKey || e.metaKey || e.altKey) return;
      const currentId = run.data?.status === "active" ? sortCombatants(combatants.data ?? [])[run.data.turn_index % Math.max(1, combatants.data?.length ?? 1)]?.id : null;
      if (!currentId) return;
      e.preventDefault();
      setSelectedId((id) => (id === currentId ? null : currentId));
      setRightTab("sheet");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run.data?.status, run.data?.turn_index, combatants.data]);
  const rollAll = () =>
    act(async () => {
      for (const c of combatants.data ?? []) if (c.initiative === null) await repos.encounters.setInitiative(c.id, d20() + c.initiative_mod);
      await repos.encounters.appendLog(runId, "Initiative rolled for remaining combatants.");
    });

  if (!run.data) return <div className="border-b border-border bg-bg-elevated px-4 py-2 text-[12px] text-ink-faint">Loading run…</div>;
  const r = run.data;
  const ordered = sortCombatants(combatants.data ?? []);
  const current = r.status === "active" ? ordered[r.turn_index % Math.max(1, ordered.length)] : null;
  const dungeonId = params.get("dungeon") ?? floor.data?.dungeon_id ?? null;

  return (
    <div className="border-b border-border bg-bg-elevated">
      <div className="flex items-center gap-2 px-4 py-2">
        <Badge tone={r.status === "active" ? "ember" : r.status === "completed" ? "moss" : r.status === "aborted" ? "blood" : "default"}>{r.status}</Badge>
        <span className="font-display text-[15px]">{r.name}</span>
        {r.status === "active" && <span className="text-[12.5px] text-ink-muted">Round {r.round}</span>}
        <span className="ml-auto flex items-center gap-1">
          {(r.floor_id || dungeonId) && (
            <Button size="sm" variant="ghost" onClick={() => navigate(dungeonId ? `/dungeons/${dungeonId}?floor=${r.floor_id ?? ""}` : "/dungeons")}>
              <MapIcon size={12} /> Map
            </Button>
          )}
          {r.status === "prepared" && (
            <>
              <Button size="sm" variant="outline" onClick={rollAll}>
                <Dices size={12} /> Roll initiative
              </Button>
              <Button size="sm" variant="primary" onClick={begin}>
                Begin
              </Button>
            </>
          )}
          {r.status === "active" && (
            <>
              <Button size="sm" variant="outline" onClick={rollAll}>
                <Dices size={12} /> Roll missing
              </Button>
              <Button size="sm" variant="primary" onClick={next}>
                Next turn <ChevronRight size={12} />
              </Button>
            </>
          )}
          {(r.status === "active" || r.status === "prepared") && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setGroupSave({})} title="Group saving throw or mass damage (select rows first, or pick targets in the dialog)">
                <Users size={12} /> Group save{picked.size ? ` (${picked.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus size={12} /> Combatant
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setFinishing(true)}>
                <Flag size={12} /> Finish
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate(`/encounters/${encounter.id}`)} title="Close tracker">
            <X size={12} />
          </Button>
        </span>
      </div>
      <TacticsBar encounter={encounter} combatants={ordered} active={r.status === "active"} onLog={(m) => act(() => repos.encounters.appendLog(runId, m, "info"))} />
      {r.status === "active" && <LegendaryStrip combatants={ordered} currentId={current?.id ?? null} onAct={act} />}
      {/* Both columns share a window-relative height and scroll on their own, so long fights stay usable. */}
      <div className="grid grid-cols-[1fr_340px] gap-3 px-4 pb-3">
        <ul className="max-h-[60vh] min-h-0 space-y-1 overflow-y-auto pr-1">
          {ordered.map((c) => (
            <CombatantRow
              key={c.id}
              combatant={c}
              active={current?.id === c.id}
              selected={selectedId === c.id}
              editable={r.status !== "completed" && r.status !== "aborted"}
              picked={picked.has(c.id)}
              onPick={() => {
                const next = new Set(picked);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                setPicked(next);
              }}
              dragging={dragId === c.id}
              onDragStart={() => setDragId(c.id)}
              onDragEnd={() => setDragId(null)}
              onDropOn={() => {
                if (!dragId || dragId === c.id) return;
                const ids = ordered.map((x) => x.id).filter((id) => id !== dragId);
                ids.splice(ids.indexOf(c.id), 0, dragId);
                setDragId(null);
                void act(() => repos.encounters.reorderInitiative(runId, ids));
              }}
              onAct={act}
              onSelect={() => {
                setSelectedId((id) => (id === c.id ? null : c.id));
                setRightTab("sheet");
              }}
            />
          ))}
          {ordered.length === 0 && <li className="text-[12px] text-ink-faint">No combatants.</li>}
        </ul>
        <div className="flex max-h-[60vh] flex-col overflow-hidden rounded border border-border bg-bg">
          <Tabs
            value={selected ? rightTab : "log"}
            onValueChange={setRightTab}
            tabs={[
              { value: "sheet", label: "Sheet" },
              { value: "log", label: "Run log" },
            ]}
          >
            <TabPanel value="sheet" className="overflow-y-auto p-2">
              {selected ? (
                <CombatantSheet
                  combatant={selected}
                  catalogName={selectedEntity.data?.name}
                  catalogKind={selectedEntity.data?.kind}
                  editable={r.status !== "completed" && r.status !== "aborted"}
                  onChanged={(updated) => void act(async () => updated, (x) => x)}
                  onGroupSave={(req) => {
                    const foes = ordered.filter((x) => !x.defeated && x.id !== selected.id && (selected.side === "party" || selected.side === "ally" ? x.side === "enemy" : x.side === "party" || x.side === "ally"));
                    setPicked(new Set(foes.map((x) => x.id)));
                    setGroupSave({ ability: req.ability, dc: req.dc, damage: req.damage, source: req.source });
                  }}
                />
              ) : (
                <div className="text-[12px] text-ink-faint">Click a combatant (or press S on the current turn) to open that instance’s sheet.</div>
              )}
            </TabPanel>
            <TabPanel value="log" className="overflow-y-auto p-2 text-[11.5px]">
              {[...r.log].reverse().map((l, i) => (
                <div key={i} className={cn("py-0.5", l.kind === "round" && "text-ember-soft", l.kind === "damage" && "text-blood", l.kind === "heal" && "text-moss", l.kind === "action" && "text-violet")}>
                  <span className="text-ink-faint">R{l.round} </span>
                  {l.message}
                </div>
              ))}
              {r.log.length === 0 && <div className="text-ink-faint">Nothing yet.</div>}
              {r.status === "completed" && r.outcomes && Object.keys(r.outcomes).length > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <div className="label">Outcomes applied</div>
                  <ul className="text-ink-muted">
                    {r.outcomes.mark_defeated && <li>Defeated creatures marked</li>}
                    {r.outcomes.room_cleared && <li>Room marked cleared</li>}
                    {r.outcomes.award_treasure && <li>Treasure dropped in room</li>}
                    {r.outcomes.remove_defeated_tokens && <li>Defeated tokens removed</li>}
                    {r.outcomes.notes && <li>{r.outcomes.notes}</li>}
                  </ul>
                </div>
              )}
            </TabPanel>
          </Tabs>
        </div>
      </div>
      <FinishDialog open={finishing} onOpenChange={setFinishing} runId={runId} roomBound={!!r.room_id} hasHoard={true} onDone={() => { refresh(); void qc.invalidateQueries({ queryKey: ["inventory"] }); void qc.invalidateQueries({ queryKey: ["quests"] }); }} />
      <GroupSaveDialog
        open={groupSave !== null}
        onOpenChange={(o) => !o && setGroupSave(null)}
        runId={runId}
        combatants={ordered}
        initialTargets={picked.size ? [...picked] : ordered.filter((x) => !x.defeated && x.side === "enemy").map((x) => x.id)}
        preset={groupSave}
        onDone={() => {
          setPicked(new Set());
          refresh();
        }}
      />
      <AddCombatantDialog open={adding} onOpenChange={setAdding} runId={runId} onDone={refresh} />
    </div>
  );
}

/** Template tactics and morale, with a prompt once the enemies drop to the flee threshold. */
function TacticsBar({ encounter, combatants, active, onLog }: { encounter: Entity; combatants: Combatant[]; active: boolean; onLog: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const tactics = String(encounter.fields.tactics ?? "");
  const morale = String(encounter.fields.morale ?? "");
  const flee = Number(encounter.fields.flee_at_percent ?? 0) || 0;
  const state = enemyMorale(combatants, flee);
  if (!tactics && !morale && !flee) return null;
  return (
    <div className="mx-4 mb-2 rounded border border-border bg-bg px-2 py-1 text-[11.5px]">
      <div className="flex items-center gap-2">
        <button className="font-semibold text-ember-soft hover:underline" onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} Tactics & morale
        </button>
        {state.total > 0 && (
          <span className="text-ink-muted">
            Enemies {state.standing}/{state.total} standing · {Math.round(state.hpFraction * 100)}% HP
          </span>
        )}
        {active && state.broken && (
          <span className="ml-auto flex items-center gap-1 text-gold">
            Morale breaks at {flee}% — check morale / flee
            <Button size="sm" variant="ghost" onClick={() => onLog(`Morale check: enemies at ${Math.round(state.hpFraction * 100)}% HP.${morale ? ` ${morale}` : ""}`)}>
              Log
            </Button>
          </span>
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-1 whitespace-pre-wrap text-ink-muted">
          {tactics && <div>{tactics}</div>}
          {morale && (
            <div>
              <span className="text-ink-faint">Morale: </span>
              {morale}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Legendary actions and resistances for every legendary combatant, usable between other creatures' turns. */
function LegendaryStrip({
  combatants,
  currentId,
  onAct,
}: {
  combatants: Combatant[];
  currentId: string | null;
  onAct: <T>(fn: () => Promise<T>, sync?: (r: T) => Combatant | null) => Promise<void>;
}) {
  const repos = useRepos();
  const legendary = combatants.filter((c) => !c.defeated && (Number(c.resources.legendary_max ?? 0) > 0 || Number(c.resources.legres_max ?? 0) > 0));
  if (legendary.length === 0) return null;
  return (
    <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded border border-violet/40 bg-violet/5 px-2 py-1 text-[11.5px]">
      <span className="font-semibold text-violet">Legendary</span>
      {legendary.map((c) => {
        const left = Number(c.resources.legendary ?? 0);
        const max = Number(c.resources.legendary_max ?? 0);
        const lr = Number(c.resources.legres ?? 0);
        const lrMax = Number(c.resources.legres_max ?? 0);
        return (
          <span key={c.id} className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5">
            <span className={cn(c.id === currentId && "text-ember-soft")}>{c.name}</span>
            {max > 0 && (
              <Button size="sm" variant="ghost" disabled={left <= 0 || c.id === currentId} onClick={() => onAct(() => repos.encounters.spendLegendary(c.id), (x) => x)} title="Spend a legendary action (at the end of another creature's turn)">
                LA {left}/{max}
              </Button>
            )}
            {lrMax > 0 && (
              <Button size="sm" variant="ghost" disabled={lr <= 0} onClick={() => onAct(() => repos.encounters.adjustResource(c.id, "legres", -1, "legendary resistance"), (x) => x)} title="Turn a failed save into a success">
                LR {lr}/{lrMax}
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function CombatantRow({
  combatant: c,
  active,
  selected,
  editable,
  picked,
  onPick,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onAct,
  onSelect,
}: {
  combatant: Combatant;
  active: boolean;
  selected: boolean;
  editable: boolean;
  picked: boolean;
  onPick: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onAct: <T>(fn: () => Promise<T>, sync?: (r: T) => Combatant | null) => Promise<void>;
  onSelect: () => void;
}) {
  const repos = useRepos();
  const [amount, setAmount] = useState("");
  const [cond, setCond] = useState("");
  const n = Math.max(0, Number(amount) || 0);
  const pct = c.max_hp ? Math.max(0, Math.min(1, c.hp / c.max_hp)) : 0;
  const sync = (x: Combatant) => x;
  const applyDamage = async () => {
    const concentrating = c.conditions.some((x) => x.name === "concentrating");
    await onAct(() => repos.encounters.damage(c.id, n), sync);
    if (concentrating) toast.warning(`${c.name}: Constitution save DC ${concentrationDc(n)} to keep concentrating.`);
    setAmount("");
  };
  return (
    <li
      className={cn("rounded border px-2 py-1.5", active ? "border-ember bg-bg-active" : selected ? "border-ember/60 bg-bg-hover" : "border-border bg-bg", c.defeated && "opacity-50", dragging && "opacity-40")}
      onDragOver={(e) => editable && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
    >
      <div className="flex items-center gap-2 text-[12.5px]">
        {editable && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c.id);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            className="cursor-grab text-ink-faint hover:text-ink"
            title="Drag to reorder initiative"
          >
            <GripVertical size={12} />
          </span>
        )}
        {editable && <input type="checkbox" checked={picked} onChange={onPick} title="Select for a group save" className="accent-[var(--color-ember)]" />}
        <Input type="number" className="w-12 text-center" value={c.initiative ?? ""} placeholder="init" disabled={!editable} onChange={(e) => onAct(() => repos.encounters.setInitiative(c.id, e.target.value === "" ? null : Number(e.target.value)))} />
        <button type="button" className={cn("text-left font-semibold hover:underline", c.side === "party" ? "text-water" : c.side === "enemy" ? "text-blood" : c.side === "ally" ? "text-moss" : "")} onClick={onSelect} title="Open this instance’s stat sheet">
          {c.name}
        </button>
        {c.defeated && <Skull size={12} className="text-ink-faint" />}
        {c.ac !== null && (
          <span className="flex items-center gap-0.5 text-ink-muted">
            <Shield size={11} /> {c.ac}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-0.5">
            <Heart size={11} className={pct > 0.5 ? "text-moss" : pct > 0.25 ? "text-gold" : "text-blood"} />
            <span className="font-mono">
              {c.hp}/{c.max_hp}
              {c.temp_hp > 0 && <span className="text-water"> +{c.temp_hp}</span>}
            </span>
          </span>
          {editable && (
            <>
              <Input type="number" className="w-14" placeholder="n" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button size="sm" variant="danger" disabled={!n} onClick={() => void applyDamage()} title="Damage">
                <Minus size={11} />
              </Button>
              <Button size="sm" variant="outline" disabled={!n} onClick={() => { void onAct(() => repos.encounters.heal(c.id, n), sync); setAmount(""); }} title="Heal">
                <Plus size={11} />
              </Button>
              <Button size="sm" variant="ghost" disabled={!n} onClick={() => { void onAct(() => repos.encounters.setTempHp(c.id, n), sync); setAmount(""); }} title="Temp HP">
                THP
              </Button>
            </>
          )}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {c.conditions.map((k) =>
          k.name === "exhaustion" ? (
            <Tooltip key={k.name} content={CONDITION_REMINDERS.exhaustion}>
              <span className="chip gap-1">
                exhaustion {k.level ?? 1}
                {editable && (
                  <>
                    <button className="hover:text-moss" onClick={() => onAct(() => repos.encounters.setExhaustion(c.id, (k.level ?? 1) - 1), sync)} title="One level less">
                      −
                    </button>
                    <button className="hover:text-blood" onClick={() => onAct(() => repos.encounters.setExhaustion(c.id, (k.level ?? 1) + 1), sync)} title="One level more">
                      +
                    </button>
                  </>
                )}
              </span>
            </Tooltip>
          ) : (
            <Tooltip key={k.name} content={CONDITION_REMINDERS[k.name] ?? "Click to remove"}>
              <button className="chip hover:border-blood hover:text-blood" disabled={!editable} onClick={() => onAct(() => repos.encounters.removeCondition(c.id, k.name), sync)}>
                {k.name}
                {k.duration !== null ? ` (${k.duration})` : ""} ×
              </button>
            </Tooltip>
          ),
        )}
        {editable && (
          <Select
            value={cond}
            className="h-6 w-32 text-[11px]"
            onChange={(e) => {
              const name = e.target.value;
              if (!name) return;
              if (name === "exhaustion") void onAct(() => repos.encounters.setExhaustion(c.id, 1), sync);
              else void onAct(() => repos.encounters.addCondition(c.id, { name, duration: null }), sync);
              setCond("");
            }}
          >
            <option value="">+ condition</option>
            {CONDITIONS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        )}
        {editable && (
          <button className="ml-auto text-[11px] text-ink-faint hover:text-ink" onClick={() => onAct(() => repos.encounters.updateCombatant(c.id, { defeated: !c.defeated }), sync)}>
            {c.defeated ? "revive" : "mark defeated"}
          </button>
        )}
        {editable && (
          <button className="text-ink-faint hover:text-blood" onClick={() => onAct(() => repos.encounters.removeCombatant(c.id))} title="Remove from run">
            <X size={11} />
          </button>
        )}
      </div>
    </li>
  );
}

function FinishDialog({ open, onOpenChange, runId, roomBound, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; runId: string; roomBound: boolean; hasHoard: boolean; onDone: () => void }) {
  const repos = useRepos();
  const [outcomes, setOutcomes] = useState<EncounterOutcomes>({ mark_defeated: true, room_cleared: roomBound, award_treasure: roomBound, remove_defeated_tokens: false, notes: "" });
  const finish = useAction((status: "completed" | "aborted") => finishEncounter(repos, runId, status, outcomes), {
    success: (r) => (r.applied.length ? `Applied: ${r.applied.join(", ")}` : "Encounter finished"),
    invalidate: [["encounters"], ["dungeon"], ["entities"], ["inventory"], ["campaignLog"]],
    onSuccess: () => {
      onOpenChange(false);
      onDone();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Finish encounter"
      description="Choose which consequences become permanent. The encounter template is not modified."
      footer={
        <>
          <Button variant="ghost" onClick={() => finish.mutate("aborted")}>
            Abort (no consequences)
          </Button>
          <Button variant="primary" disabled={finish.isPending} onClick={() => finish.mutate("completed")}>
            Complete & apply
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Checkbox label="Mark defeated creatures/NPCs (status dead, HP 0 on tokens)" checked={!!outcomes.mark_defeated} onChange={(v) => setOutcomes({ ...outcomes, mark_defeated: v })} />
        <Checkbox label="Remove defeated tokens from the map" checked={!!outcomes.remove_defeated_tokens} onChange={(v) => setOutcomes({ ...outcomes, remove_defeated_tokens: v })} />
        <Checkbox label="Mark the room as cleared" checked={!!outcomes.room_cleared} onChange={(v) => setOutcomes({ ...outcomes, room_cleared: v })} className={cn(!roomBound && "opacity-50")} />
        <Checkbox label="Drop the encounter's treasure hoard in the room" checked={!!outcomes.award_treasure} onChange={(v) => setOutcomes({ ...outcomes, award_treasure: v })} className={cn(!roomBound && "opacity-50")} />
        <Field label="Notes for the campaign log">
          <Textarea rows={3} value={outcomes.notes ?? ""} onChange={(e) => setOutcomes({ ...outcomes, notes: e.target.value })} />
        </Field>
        <p className="text-[11.5px] text-ink-faint">Party HP is always written back to the character records and their tokens.</p>
      </div>
    </Dialog>
  );
}

function AddCombatantDialog({ open, onOpenChange, runId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; runId: string; onDone: () => void }) {
  const repos = useRepos();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [name, setName] = useState("");
  const [hp, setHp] = useState("10");
  const [side, setSide] = useState<Combatant["side"]>("enemy");
  const add = useAction(
    async () => {
      const sheet = snapshotSheet(entity);
      const max = Number(hp) || Number(sheet.max_hp ?? sheet.hp ?? 10) || 10;
      return repos.encounters.addCombatant(runId, {
        entity_id: entity?.id ?? null,
        name: name.trim() || entity?.name || "Combatant",
        side,
        hp: max,
        max_hp: max,
        ac: sheet.ac !== undefined ? Number(sheet.ac) : null,
        initiative_mod: Number(sheet.initiative ?? Math.floor(((Number((sheet.abilities as Record<string, number> | undefined)?.dex ?? 10) || 10) - 10) / 2)),
        resources: initialResources(sheet),
        sheet,
      });
    },
    { success: "Combatant added", invalidate: [["encounters"]], onSuccess: () => { onOpenChange(false); onDone(); setEntity(null); setName(""); } },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add combatant" width="max-w-sm" footer={<Button variant="primary" onClick={() => add.mutate(undefined as never)}>Add</Button>}>
      <div className="space-y-2">
        <Field label="From record (optional)">
          <EntityPicker kinds={["creature", "npc", "pc"]} value={entity?.id ?? null} onChange={(_, e) => { setEntity(e); if (e) setHp(String(e.fields.max_hp ?? e.fields.hp ?? 10)); }} allowNone includeGlobal />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={entity?.name ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="HP">
            <Input type="number" value={hp} onChange={(e) => setHp(e.target.value)} />
          </Field>
          <Field label="Side">
            <Select value={side} onChange={(e) => setSide(e.target.value as Combatant["side"])}>
              {["enemy", "ally", "neutral", "party"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
