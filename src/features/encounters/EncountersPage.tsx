import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Swords, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { qk, useAction, useEntities, useRequiredCampaignId } from "@/app/queries";
import { EntityPicker } from "@/components/EntityPicker";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { InventoryPanel } from "@/components/InventoryPanel";
import { Badge, Button, Dialog, Field, Input, Select } from "@/components/ui";
import { assessEncounter } from "@/domain/statblock";
import { creatureInputs, parseSrdCreatures } from "@/domain/srdImport";
import type { EncounterParticipant, EncounterSide, Entity } from "@/domain/types";
import { activateEncounter } from "@/domain/workflows/encounterWorkflow";
import { errorMessage, formatDateTime } from "@/lib/utils";
import { CombatTracker } from "./CombatTracker";

export function EncountersPage() {
  const [params] = useSearchParams();
  const runId = params.get("run");
  return (
    <EntityWorkspace
      title="Encounters"
      kinds={["encounter"]}
      basePath="/encounters"
      description="Encounter templates: participants, difficulty, tactics, treasure and alternative outcomes. Running one creates an execution instance; the template never changes."
      rowMeta={(e) => `${e.fields.encounter_type ?? "combat"} · ${e.fields.difficulty ?? "medium"}`}
      overview={<RunsOverview />}
      extras={{
        banner: (e) => (runId ? <CombatTracker runId={runId} encounter={e} /> : <RunBar encounter={e} />),
        tabs: [
          { value: "participants", label: "Participants", render: (e) => <Participants encounter={e} /> },
          { value: "prep", label: "Prep", render: (e) => <PrepPanel encounter={e} /> },
          { value: "runs", label: "Runs", render: (e) => <RunsForEncounter encounter={e} /> },
        ],
      }}
    />
  );
}

function RunBar({ encounter }: { encounter: Entity }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sessionId = useAppStore((s) => s.activeSessionId);
  const [open, setOpen] = useState(false);
  const [floorId, setFloorId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const floors = useQuery({ queryKey: ["dungeon", "allFloors", campaignId], queryFn: () => repos.dungeons.floorsForCampaign(campaignId) });
  const rooms = useQuery({ queryKey: ["dungeon", "rooms", floorId], queryFn: () => repos.dungeons.rooms(floorId), enabled: !!floorId });
  const active = useQuery({ queryKey: ["encounters", "runsFor", encounter.id], queryFn: () => repos.encounters.runsForEncounter(encounter.id) });
  const live = (active.data ?? []).find((r) => r.status === "active" || r.status === "prepared");
  const start = async () => {
    try {
      const { run } = await activateEncounter(repos, { campaign_id: campaignId, encounter_id: encounter.id, floor_id: floorId || null, room_id: roomId || null, session_id: sessionId, placeTokens: !!roomId });
      void qc.invalidateQueries({ queryKey: ["encounters"] });
      void qc.invalidateQueries({ queryKey: ["dungeon"] });
      setOpen(false);
      navigate(`/encounters/${encounter.id}?run=${run.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-4 py-2 text-[12.5px]">
      <Badge tone="ember">{String(encounter.fields.encounter_type ?? "combat")}</Badge>
      <Badge>{String(encounter.fields.difficulty ?? "medium")}</Badge>
      {encounter.fields.xp_total ? <span className="text-ink-muted">{String(encounter.fields.xp_total)} XP</span> : null}
      <span className="ml-auto flex gap-1">
        {live && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/encounters/${encounter.id}?run=${live.id}`)}>
            Resume {live.status} run
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          <Swords size={12} /> Run encounter
        </Button>
      </span>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Run “${encounter.name}”`}
        description="Creates a new execution instance with its own combatants. Optionally bind it to a battle-map room so creature tokens are placed automatically."
        footer={
          <Button variant="primary" onClick={start}>
            Start
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Battle map floor (optional)">
            <Select value={floorId} onChange={(e) => { setFloorId(e.target.value); setRoomId(""); }}>
              <option value="">No map</option>
              {(floors.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room (optional)">
            <Select value={roomId} disabled={!floorId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">—</option>
              {(rooms.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number ? `${r.number}. ` : ""}
                  {r.entity.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

const SIDES: EncounterSide[] = ["enemy", "ally", "neutral", "party"];

function Participants({ encounter }: { encounter: Entity }) {
  const repos = useRepos();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: qk.participants(encounter.id), queryFn: () => repos.encounters.participants(encounter.id) });
  const entities = useQuery({
    queryKey: ["entities", "many", (list.data ?? []).map((p) => p.entity_id)],
    queryFn: () => repos.entities.getMany((list.data ?? []).map((p) => p.entity_id).filter((x): x is string => !!x)),
    enabled: (list.data ?? []).length > 0,
  });
  const [entityId, setEntityId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [side, setSide] = useState<EncounterSide>("enemy");
  const invalidate = [qk.participants(encounter.id)];
  const add = useAction(() => repos.encounters.addParticipant({ encounter_id: encounter.id, entity_id: entityId, label: null, count, side, notes: "", sort_order: (list.data?.length ?? 0) }), { invalidate, onSuccess: () => setEntityId(null) });
  const update = useAction(({ id, patch }: { id: string; patch: Partial<EncounterParticipant> }) => repos.encounters.updateParticipant(id, patch), { invalidate });
  const remove = useAction((id: string) => repos.encounters.removeParticipant(id), { invalidate });
  const name = (p: EncounterParticipant) => p.label ?? entities.data?.find((e) => e.id === p.entity_id)?.name ?? "Unnamed";
  const party = useEntities({ kinds: ["pc"] });
  const [importing, setImporting] = useState(false);
  const totalXp = (list.data ?? []).reduce((sum, p) => sum + p.count * Number(entities.data?.find((e) => e.id === p.entity_id)?.fields.xp ?? 0), 0);
  const monsterCount = (list.data ?? []).filter((p) => p.side === "enemy").reduce((s, p) => s + p.count, 0);
  const budget = assessEncounter(
    totalXp,
    monsterCount,
    (party.data ?? []).map((p) => Number(p.fields.level ?? 1) || 1),
  );
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded border border-border">
        {(list.data ?? []).map((p) => {
          const ent = entities.data?.find((e) => e.id === p.entity_id);
          return (
            <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
              <Input type="number" min={1} className="w-14" value={p.count} onChange={(e) => update.mutate({ id: p.id, patch: { count: Math.max(1, Number(e.target.value)) } })} />
              <span className="text-ink-faint">×</span>
              {ent ? (
                <Link to={`/${ent.kind === "creature" ? "creatures" : "characters"}/${ent.id}`} className="text-ember-soft hover:underline">
                  {name(p)}
                </Link>
              ) : (
                <span>{name(p)}</span>
              )}
              {ent && <span className="text-[11px] text-ink-faint">CR {String(ent.fields.cr ?? "?")} · AC {String(ent.fields.ac ?? "?")} · HP {String(ent.fields.hp ?? "?")}</span>}
              <Select value={p.side} className="ml-auto w-24" onChange={(e) => update.mutate({ id: p.id, patch: { side: e.target.value as EncounterSide } })}>
                {SIDES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <button className="text-ink-faint hover:text-blood" onClick={() => remove.mutate(p.id)}>
                <Trash2 size={12} />
              </button>
            </li>
          );
        })}
        {(list.data ?? []).length === 0 && <li className="p-3 text-[12px] text-ink-faint">No participants yet. The party is added automatically when a run starts.</li>}
      </ul>
      <div className="flex items-end gap-2">
        <Field label="Creature / NPC" className="flex-1">
          <EntityPicker kinds={["creature", "npc"]} value={entityId} onChange={(id) => setEntityId(id)} />
        </Field>
        <Field label="Count">
          <Input type="number" min={1} className="w-16" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label="Side">
          <Select value={side} onChange={(e) => setSide(e.target.value as EncounterSide)}>
            {SIDES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" disabled={!entityId} onClick={() => add.mutate(undefined as never)}>
          <Plus size={13} /> Add
        </Button>
      </div>
      <div className="rounded border border-border bg-bg-elevated p-2 text-[12px]">
        <div className="font-semibold text-ember-soft">Difficulty vs this campaign’s party (2014 XP)</div>
        <div className="mt-1 text-ink-muted">
          Monster XP {budget.monsterXp} × {budget.multiplier} = <span className="text-ink">{budget.adjustedXp} adjusted</span>
          {" · "}
          Party budget easy {budget.party.easy} / med {budget.party.medium} / hard {budget.party.hard} / deadly {budget.party.deadly}
        </div>
        <Badge tone={budget.band === "deadly" ? "blood" : budget.band === "hard" ? "ember" : budget.band === "easy" || budget.band === "trivial" ? "moss" : "gold"} className="mt-1">
          {budget.band}
        </Badge>
        <p className="mt-1 text-[11px] text-ink-faint">Catalog XP only. Changing a combatant mid-fight does not rewrite this template.</p>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <Button size="sm" variant="outline" disabled={importing} onClick={() => void importSrd()}>
          <Upload size={12} /> Import SRD JSON into Creatures
        </Button>
        <span className="text-ink-faint">Local file only — pick a monster array, then add them from the picker above.</span>
      </div>
    </div>
  );

  async function importSrd() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const json = JSON.parse(await file.text()) as unknown;
        const parsed = parseSrdCreatures(json);
        if (parsed.length === 0) {
          toast.error("No creatures found in that file.");
          return;
        }
        const campaignId = encounter.campaign_id;
        if (!campaignId) throw new Error("Encounter is not in a campaign.");
        for (const row of creatureInputs(campaignId, parsed)) await repos.entities.create(row);
        toast.success(`Imported ${parsed.length} creature(s) into the catalog.`);
        void qc.invalidateQueries({ queryKey: ["entities"] });
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }
}

function PrepPanel({ encounter }: { encounter: Entity }) {
  const fields = encounter.fields as Record<string, unknown>;
  return (
    <div className="space-y-4">
      <div className="rounded border border-border p-3 text-[12.5px]">
        <div className="label">Tactics & outcomes</div>
        <p className="text-ink-muted">{encounter.body_md || "Write tactics in the encounter record body."}</p>
        {fields.reinforcements ? <p className="mt-2"><span className="text-ink-faint">Reinforcements: </span>{String(fields.reinforcements)}</p> : null}
        {fields.treasure ? <p className="mt-1"><span className="text-ink-faint">Treasure notes: </span>{String(fields.treasure)}</p> : null}
        {fields.alternative_outcomes ? <p className="mt-1"><span className="text-ink-faint">If they flee / parley: </span>{String(fields.alternative_outcomes)}</p> : null}
      </div>
      <InventoryPanel owner={{ owner_type: "hoard", owner_id: encounter.id }} title="Treasure hoard (dropped to the room when the run awards treasure)" />
    </div>
  );
}

function RunsForEncounter({ encounter }: { encounter: Entity }) {
  const repos = useRepos();
  const navigate = useNavigate();
  const runs = useQuery({ queryKey: ["encounters", "runsFor", encounter.id], queryFn: () => repos.encounters.runsForEncounter(encounter.id) });
  const remove = useAction((id: string) => repos.encounters.deleteRun(id), { invalidate: [["encounters"]] });
  return (
    <ul className="divide-y divide-border rounded border border-border">
      {(runs.data ?? []).map((r) => (
        <li key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
          <Badge tone={r.status === "active" ? "ember" : r.status === "completed" ? "moss" : r.status === "aborted" ? "blood" : "default"}>{r.status}</Badge>
          <span>
            {r.name} · round {r.round}
          </span>
          <span className="ml-auto text-[11px] text-ink-faint">{formatDateTime(r.created_at)}</span>
          <Button size="sm" variant="outline" onClick={() => navigate(`/encounters/${encounter.id}?run=${r.id}`)}>
            Open
          </Button>
          <button className="text-ink-faint hover:text-blood" onClick={() => remove.mutate(r.id)}>
            <Trash2 size={12} />
          </button>
        </li>
      ))}
      {(runs.data ?? []).length === 0 && <li className="p-3 text-[12px] text-ink-faint">This encounter has never been run.</li>}
    </ul>
  );
}

function RunsOverview() {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const navigate = useNavigate();
  const runs = useQuery({ queryKey: qk.runs(campaignId), queryFn: () => repos.encounters.runs(campaignId) });
  return (
    <div className="overflow-y-auto p-4">
      <h2 className="mb-1 font-display text-lg text-ember-soft">Encounters</h2>
      <p className="mb-3 text-[12px] text-ink-muted">Pick a template on the left to edit it or run it. Recent runs:</p>
      <ul className="space-y-1">
        {(runs.data ?? []).slice(0, 20).map((r) => (
          <li key={r.id}>
            <button className="row-hover flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-[12.5px]" onClick={() => navigate(`/encounters/${r.encounter_id ?? ""}?run=${r.id}`)}>
              <Badge tone={r.status === "active" ? "ember" : r.status === "completed" ? "moss" : r.status === "aborted" ? "blood" : "default"}>{r.status}</Badge>
              <span>{r.name}</span>
              <span className="ml-auto text-[11px] text-ink-faint">{formatDateTime(r.updated_at)}</span>
            </button>
          </li>
        ))}
        {(runs.data ?? []).length === 0 && <li className="text-ink-faint">No runs yet.</li>}
      </ul>
    </div>
  );
}
