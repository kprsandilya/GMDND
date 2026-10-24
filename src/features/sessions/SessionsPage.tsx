import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { qk, useAction, useCampaign, useEntities, useRequiredCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityPicker } from "@/components/EntityPicker";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { MarkdownEditor } from "@/components/Markdown";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { formatDate } from "@/domain/calendar";
import { ENTITY_KINDS, KIND_LABELS, type Entity, type EntityKind, type SessionNote } from "@/domain/types";
import { advanceCampaignDate, campaignFields, promoteNote, setActiveSession } from "@/domain/workflows/campaignWorkflow";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { SessionTravelTab } from "./SessionTravelTab";

export function SessionsPage() {
  return (
    <EntityWorkspace
      title="Session Manager"
      kinds={["session"]}
      basePath="/sessions"
      description="Plan a session, run it live with quick notes, then turn notes into permanent lore, quests or secrets."
      rowMeta={(e) => `#${e.fields.number ?? "?"} · ${e.fields.status ?? "planned"}${e.fields.real_date ? ` · ${e.fields.real_date}` : ""}`}
      groupBy={(e) => (e.fields.status === "live" ? "Live" : e.fields.status === "completed" ? "Completed" : "Planned")}
      extras={{
        banner: (e) => <LiveBar session={e} />,
        tabs: [
          { value: "plan", label: "Plan", render: (e) => <PlanTab session={e} /> },
          { value: "travel", label: "Travel", render: (e) => <SessionTravelTab entity={e} /> },
          { value: "notes", label: "Quick notes", render: (e) => <NotesTab session={e} /> },
          { value: "log", label: "Session log", render: (e) => <LogTab session={e} /> },
          { value: "recap", label: "Recap", render: (e) => <RecapTab session={e} /> },
        ],
      }}
    />
  );
}

function LiveBar({ session }: { session: Entity }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const campaign = useCampaign();
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const status = String(session.fields.status ?? "planned");
  const fields = campaign.data ? campaignFields(campaign.data) : null;
  const isActive = fields?.active_session_id === session.id;
  useEffect(() => {
    if (isActive) setActiveSessionId(session.id);
  }, [isActive, session.id, setActiveSessionId]);
  const invalidate = [["entities"], ["campaignState"], ["campaignLog"]];
  const start = useAction(
    async () => {
      await repos.entities.update(session.id, { fields: { ...session.fields, status: "live", started_at: new Date().toISOString() } });
      await setActiveSession(repos, campaignId, session.id);
      await repos.campaignLog.add(campaignId, "session", `Session ${String(session.fields.number ?? "")} "${session.name}" starts.`, {}, session.id);
    },
    { success: "Session is live", invalidate, onSuccess: () => setActiveSessionId(session.id) },
  );
  const end = useAction(
    async () => {
      await repos.entities.update(session.id, { fields: { ...session.fields, status: "completed", ended_at: new Date().toISOString() } });
      await setActiveSession(repos, campaignId, null);
      await repos.campaignLog.add(campaignId, "session", `Session "${session.name}" ends.`, {}, session.id);
    },
    { success: "Session completed", invalidate, onSuccess: () => setActiveSessionId(null) },
  );
  const advance = useAction((days: number) => advanceCampaignDate(repos, campaignId, days, session.id), { success: "Time passes", invalidate });
  const cal = fields?.calendar;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-4 py-2 text-[12.5px]">
      <Badge tone={status === "live" ? "ember" : status === "completed" ? "moss" : "default"}>{status}</Badge>
      <span className="text-ink-muted">Session #{String(session.fields.number ?? "?")}</span>
      {cal && (
        <span className="ml-2 text-ink-muted">
          In-world: {formatDate(cal, { year: cal.year, month: cal.month, day: cal.day })}
          {status === "live" && (
            <span className="ml-1 inline-flex gap-0.5">
              {[1, 7].map((d) => (
                <button key={d} className="rounded border border-border px-1 text-[10px] hover:bg-bg-hover" onClick={() => advance.mutate(d)}>
                  +{d}d
                </button>
              ))}
            </span>
          )}
        </span>
      )}
      <span className="ml-auto flex gap-1">
        {status !== "live" && status !== "completed" && (
          <Button size="sm" variant="primary" onClick={() => start.mutate(undefined as never)}>
            <Play size={12} /> Start session
          </Button>
        )}
        {status === "live" && (
          <Button size="sm" variant="secondary" onClick={() => end.mutate(undefined as never)}>
            <Square size={12} /> End session
          </Button>
        )}
        {status === "completed" && (
          <Button size="sm" variant="ghost" onClick={() => start.mutate(undefined as never)}>
            Reopen
          </Button>
        )}
      </span>
    </div>
  );
}

function PlanTab({ session }: { session: Entity }) {
  const repos = useRepos();
  const [outline, setOutline] = useState(String(session.fields.outline_md ?? ""));
  const encounters = useEntities({ kinds: ["encounter"] });
  const locations = useEntities({ kinds: ["settlement", "dungeon", "location", "building", "region"] });
  const planned = (session.fields.planned_encounter_ids as string[] | undefined) ?? [];
  const locIds = (session.fields.location_ids as string[] | undefined) ?? [];
  const save = useAction((fields: Record<string, unknown>) => repos.entities.update(session.id, { fields: { ...session.fields, ...fields } }), { invalidate: [["entities"]] });
  const [pickEnc, setPickEnc] = useState<string | null>(null);
  const [pickLoc, setPickLoc] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-[1fr_320px] gap-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Outline</span>
          <Button size="sm" variant="primary" disabled={outline === String(session.fields.outline_md ?? "")} onClick={() => save.mutate({ outline_md: outline })}>
            Save outline
          </Button>
        </div>
        <MarkdownEditor value={outline} onChange={setOutline} rows={16} placeholder="Scenes, beats, hooks, contingencies…" />
      </div>
      <div className="space-y-4">
        <div>
          <div className="label">Planned encounters</div>
          <ul className="space-y-1">
            {planned.map((id) => {
              const enc = encounters.data?.find((e) => e.id === id);
              return (
                <li key={id} className="flex items-center gap-2 text-[12.5px]">
                  <Link to={`/encounters/${id}`} className="truncate text-ember-soft hover:underline">
                    {enc?.name ?? "Missing encounter"}
                  </Link>
                  <button className="ml-auto text-ink-faint hover:text-blood" onClick={() => save.mutate({ planned_encounter_ids: planned.filter((p) => p !== id) })}>
                    <Trash2 size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex gap-1">
            <EntityPicker kinds={["encounter"]} value={pickEnc} onChange={(id) => setPickEnc(id)} exclude={planned} className="flex-1" />
            <Button size="sm" variant="outline" disabled={!pickEnc} onClick={() => { save.mutate({ planned_encounter_ids: [...planned, pickEnc] }); setPickEnc(null); }}>
              Add
            </Button>
          </div>
        </div>
        <div>
          <div className="label">Locations in play</div>
          <ul className="space-y-1">
            {locIds.map((id) => {
              const loc = locations.data?.find((e) => e.id === id);
              return (
                <li key={id} className="flex items-center gap-2 text-[12.5px]">
                  {loc ? (
                    <Link to={routeForEntity(loc)} className="truncate text-ember-soft hover:underline">
                      {loc.name}
                    </Link>
                  ) : (
                    <span className="text-ink-faint">Missing location</span>
                  )}
                  <button className="ml-auto text-ink-faint hover:text-blood" onClick={() => save.mutate({ location_ids: locIds.filter((p) => p !== id) })}>
                    <Trash2 size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex gap-1">
            <EntityPicker kinds={["settlement", "dungeon", "location", "building", "region", "district"]} value={pickLoc} onChange={(id) => setPickLoc(id)} exclude={locIds} className="flex-1" />
            <Button size="sm" variant="outline" disabled={!pickLoc} onClick={() => { save.mutate({ location_ids: [...locIds, pickLoc] }); setPickLoc(null); }}>
              Add
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Session number">
            <Input type="number" defaultValue={Number(session.fields.number ?? 1)} onBlur={(e) => Number(e.target.value) !== session.fields.number && save.mutate({ number: Number(e.target.value) })} />
          </Field>
          <Field label="Real-world date">
            <Input type="date" defaultValue={String(session.fields.real_date ?? "")} onBlur={(e) => e.target.value !== session.fields.real_date && save.mutate({ real_date: e.target.value })} />
          </Field>
        </div>
      </div>
    </div>
  );
}

const PROMOTE_KINDS: EntityKind[] = ["article", "event", "secret", "quest", "npc", "location", "item", "faction", "document"];

function NotesTab({ session }: { session: Entity }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const notes = useQuery({ queryKey: qk.sessionNotes(session.id), queryFn: () => repos.sessionNotes.list(session.id) });
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<SessionNote["kind"]>("note");
  const [showResolved, setShowResolved] = useState(false);
  const [promoting, setPromoting] = useState<SessionNote | null>(null);
  const invalidate = [qk.sessionNotes(session.id), ["campaignState"]];
  const add = useAction(() => repos.sessionNotes.add(session.id, campaignId, body.trim(), kind), { invalidate, onSuccess: () => setBody("") });
  const resolve = useAction(({ id, resolved }: { id: string; resolved: boolean }) => repos.sessionNotes.update(id, { resolved }), { invalidate });
  const remove = useAction((id: string) => repos.sessionNotes.delete(id), { invalidate });
  const list = (notes.data ?? []).filter((n) => showResolved || !n.resolved);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as SessionNote["kind"])} className="w-32">
          <option value="note">Note</option>
          <option value="todo">To-do</option>
          <option value="consequence">Consequence</option>
        </Select>
        <Textarea
          rows={2}
          className="min-h-[38px] flex-1"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Jot down what happened… (Ctrl+Enter to save)"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && body.trim()) add.mutate(undefined as never);
          }}
        />
        <Button variant="primary" disabled={!body.trim()} onClick={() => add.mutate(undefined as never)}>
          Add
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox label="Show resolved" checked={showResolved} onChange={setShowResolved} />
        <span className="text-[11px] text-ink-faint">{(notes.data ?? []).filter((n) => !n.resolved).length} open</span>
      </div>
      <ul className="space-y-1">
        {list.map((n) => (
          <li key={n.id} className={cn("flex items-start gap-2 rounded border border-border p-2 text-[12.5px]", n.resolved && "opacity-60")}>
            <button className={cn("mt-0.5 rounded border border-border p-0.5", n.resolved ? "text-moss" : "text-ink-faint hover:text-ink")} onClick={() => resolve.mutate({ id: n.id, resolved: !n.resolved })} title="Toggle resolved">
              <Check size={11} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge tone={n.kind === "consequence" ? "blood" : n.kind === "todo" ? "gold" : "default"}>{n.kind}</Badge>
                <span className="text-[11px] text-ink-faint">{relativeTime(n.created_at)}</span>
                {n.promoted_to && <PromotedLink id={n.promoted_to} />}
              </div>
              <div className="whitespace-pre-wrap">{n.body}</div>
            </div>
            {!n.promoted_to && (
              <Button size="sm" variant="outline" onClick={() => setPromoting(n)} title="Turn into a permanent record">
                <ArrowUpRight size={11} /> Promote
              </Button>
            )}
            <button className="text-ink-faint hover:text-blood" onClick={() => remove.mutate(n.id)}>
              <Trash2 size={11} />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="text-[12px] text-ink-faint">No notes.</li>}
      </ul>
      {promoting && <PromoteDialog note={promoting} onClose={() => setPromoting(null)} />}
    </div>
  );
}

function PromotedLink({ id }: { id: string }) {
  const repos = useRepos();
  const entity = useQuery({ queryKey: qk.entity(id), queryFn: () => repos.entities.find(id) });
  if (!entity.data) return null;
  return (
    <Link to={routeForEntity(entity.data)} className="text-[11px] text-ember-soft hover:underline">
      → {KIND_LABELS[entity.data.kind]}: {entity.data.name}
    </Link>
  );
}

function PromoteDialog({ note, onClose }: { note: SessionNote; onClose: () => void }) {
  const repos = useRepos();
  const [kind, setKind] = useState<EntityKind>("article");
  const [name, setName] = useState(note.body.split("\n")[0]!.slice(0, 60));
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const promote = useAction(() => promoteNote(repos, note, { kind, name: name.trim(), link_to: linkTo }), {
    success: (e) => `Created ${KIND_LABELS[e.kind]} "${e.name}"`,
    invalidate: [["entities"], ["sessionNotes"], ["campaignState"], ["campaignLog"]],
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Promote note to a permanent record"
      description="The note's text becomes the record's description; the note is marked resolved and linked to it."
      footer={
        <Button variant="primary" disabled={!name.trim() || promote.isPending} onClick={() => promote.mutate(undefined as never)}>
          Create {KIND_LABELS[kind]}
        </Button>
      }
    >
      <div className="space-y-2">
        <div className="rounded border border-border bg-bg p-2 text-[12px] text-ink-muted">{note.body}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Record kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>
              {PROMOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Link to existing entity (optional)">
          <EntityPicker kinds={[...ENTITY_KINDS]} value={linkTo} onChange={(id) => setLinkTo(id)} allowNone />
        </Field>
      </div>
    </Dialog>
  );
}

function LogTab({ session }: { session: Entity }) {
  const repos = useRepos();
  const log = useQuery({ queryKey: ["campaignLog", "session", session.id], queryFn: () => repos.campaignLog.forSession(session.id) });
  return (
    <ul className="space-y-1">
      {(log.data ?? []).map((l) => (
        <li key={l.id} className="flex gap-2 text-[12.5px]">
          <span className="w-28 shrink-0 text-[11px] text-ink-faint">{formatDateTime(l.at)}</span>
          <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">{l.kind}</span>
          <span>{l.message}</span>
        </li>
      ))}
      {(log.data ?? []).length === 0 && <li className="text-[12px] text-ink-faint">Nothing logged during this session yet. Movement, interactions, doors, encounters and inventory changes made while the session is active appear here.</li>}
    </ul>
  );
}

function RecapTab({ session }: { session: Entity }) {
  const repos = useRepos();
  const [recap, setRecap] = useState(String(session.fields.recap_md ?? ""));
  const [rewards, setRewards] = useState(String(session.fields.rewards_md ?? ""));
  const save = useAction(() => repos.entities.update(session.id, { fields: { ...session.fields, recap_md: recap, rewards_md: rewards } }), { success: "Recap saved" });
  return (
    <div className="space-y-3">
      <Field label="Recap (what happened)">
        <MarkdownEditor value={recap} onChange={setRecap} rows={10} />
      </Field>
      <Field label="Rewards & XP">
        <MarkdownEditor value={rewards} onChange={setRewards} rows={4} />
      </Field>
      <div className="text-right">
        <Button variant="primary" onClick={() => save.mutate(undefined as never)}>
          Save recap
        </Button>
      </div>
    </div>
  );
}
