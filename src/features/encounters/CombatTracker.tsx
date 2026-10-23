import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Dices, Flag, Heart, Map as MapIcon, Minus, Plus, Shield, Skull, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { qk, useAction } from "@/app/queries";
import { EntityPicker } from "@/components/EntityPicker";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { d20 } from "@/domain/dice";
import type { Combatant, EncounterOutcomes, Entity } from "@/domain/types";
import { finishEncounter, syncCombatantToToken } from "@/domain/workflows/encounterWorkflow";
import { cn, errorMessage } from "@/lib/utils";
import { sortCombatants } from "@/persistence/repositories/encounters";

const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "concentrating"];

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
      <div className="grid grid-cols-[1fr_280px] gap-3 px-4 pb-3">
        <ul className="space-y-1">
          {ordered.map((c) => (
            <CombatantRow key={c.id} combatant={c} active={current?.id === c.id} editable={r.status !== "completed" && r.status !== "aborted"} onAct={act} />
          ))}
          {ordered.length === 0 && <li className="text-[12px] text-ink-faint">No combatants.</li>}
        </ul>
        <div className="max-h-72 overflow-y-auto rounded border border-border bg-bg p-2 text-[11.5px]">
          <div className="label">Run log</div>
          {[...r.log].reverse().map((l, i) => (
            <div key={i} className={cn("py-0.5", l.kind === "round" && "text-ember-soft", l.kind === "damage" && "text-blood", l.kind === "heal" && "text-moss")}>
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
        </div>
      </div>
      <FinishDialog open={finishing} onOpenChange={setFinishing} runId={runId} roomBound={!!r.room_id} hasHoard={true} onDone={() => { refresh(); void qc.invalidateQueries({ queryKey: ["inventory"] }); void qc.invalidateQueries({ queryKey: ["quests"] }); }} />
      <AddCombatantDialog open={adding} onOpenChange={setAdding} runId={runId} onDone={refresh} />
    </div>
  );
}

function CombatantRow({ combatant: c, active, editable, onAct }: { combatant: Combatant; active: boolean; editable: boolean; onAct: <T>(fn: () => Promise<T>, sync?: (r: T) => Combatant | null) => Promise<void> }) {
  const repos = useRepos();
  const [amount, setAmount] = useState("");
  const [cond, setCond] = useState("");
  const n = Math.max(0, Number(amount) || 0);
  const pct = c.max_hp ? Math.max(0, Math.min(1, c.hp / c.max_hp)) : 0;
  const sync = (x: Combatant) => x;
  return (
    <li className={cn("rounded border px-2 py-1.5", active ? "border-ember bg-bg-active" : "border-border bg-bg", c.defeated && "opacity-50")}>
      <div className="flex items-center gap-2 text-[12.5px]">
        <Input type="number" className="w-12 text-center" value={c.initiative ?? ""} placeholder="init" disabled={!editable} onChange={(e) => onAct(() => repos.encounters.setInitiative(c.id, e.target.value === "" ? null : Number(e.target.value)))} />
        <span className={cn("font-semibold", c.side === "party" ? "text-water" : c.side === "enemy" ? "text-blood" : c.side === "ally" ? "text-moss" : "")}>{c.name}</span>
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
              <Button size="sm" variant="danger" disabled={!n} onClick={() => { void onAct(() => repos.encounters.damage(c.id, n), sync); setAmount(""); }} title="Damage">
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
        {c.conditions.map((k) => (
          <button key={k.name} className="chip hover:border-blood hover:text-blood" disabled={!editable} onClick={() => onAct(() => repos.encounters.removeCondition(c.id, k.name), sync)} title="Remove">
            {k.name}
            {k.duration !== null ? ` (${k.duration})` : ""} ×
          </button>
        ))}
        {editable && (
          <Select value={cond} className="h-6 w-32 text-[11px]" onChange={(e) => { if (e.target.value) { void onAct(() => repos.encounters.addCondition(c.id, { name: e.target.value, duration: null }), sync); setCond(""); } }}>
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
      const f = (entity?.fields ?? {}) as Record<string, unknown>;
      const max = Number(hp) || Number(f.max_hp ?? f.hp ?? 10) || 10;
      return repos.encounters.addCombatant(runId, { entity_id: entity?.id ?? null, name: name.trim() || entity?.name || "Combatant", side, hp: max, max_hp: max, ac: Number(f.ac ?? 10) || null, initiative_mod: Math.floor(((Number((f.abilities as Record<string, number> | undefined)?.dex ?? 10) || 10) - 10) / 2) });
    },
    { success: "Combatant added", invalidate: [["encounters"]], onSuccess: () => { onOpenChange(false); onDone(); setEntity(null); setName(""); } },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add combatant" width="max-w-sm" footer={<Button variant="primary" onClick={() => add.mutate(undefined as never)}>Add</Button>}>
      <div className="space-y-2">
        <Field label="From record (optional)">
          <EntityPicker kinds={["creature", "npc", "pc"]} value={entity?.id ?? null} onChange={(_, e) => { setEntity(e); if (e) setHp(String(e.fields.max_hp ?? e.fields.hp ?? 10)); }} allowNone />
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
