import { useQuery } from "@tanstack/react-query";
import { EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { qk, useAction, useCampaign, useCampaignId, useEntity } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityPicker } from "@/components/EntityPicker";
import { MarkdownView } from "@/components/Markdown";
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { formatDate } from "@/domain/calendar";
import { ENTITY_KINDS, type TimelineEvent } from "@/domain/types";
import { campaignFields } from "@/domain/workflows/campaignWorkflow";
import { cn } from "@/lib/utils";

type Draft = Omit<TimelineEvent, "id" | "created_at" | "updated_at" | "campaign_id">;

const emptyDraft = (): Draft => ({ entity_id: null, title: "", body_md: "", year: null, month: null, day: null, kind: "campaign", secret: false });

export function TimelinePage() {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const campaign = useCampaign();
  const events = useQuery({ queryKey: qk.timeline(campaignId), queryFn: () => repos.timeline.list(campaignId!), enabled: !!campaignId });
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [filter, setFilter] = useState<"all" | TimelineEvent["kind"]>("all");
  const invalidate = [qk.timeline(campaignId)];
  const save = useAction(
    () => (editing!.id ? repos.timeline.update(editing!.id, editing!.draft) : repos.timeline.create({ ...editing!.draft, campaign_id: campaignId! })),
    { success: "Saved", invalidate, onSuccess: () => setEditing(null) },
  );
  const remove = useAction((id: string) => repos.timeline.delete(id), { invalidate });

  if (!campaign.data) return <EmptyState title="No campaign" />;
  const calendar = campaignFields(campaign.data).calendar!;
  const today = { year: calendar.year, month: calendar.month, day: calendar.day };
  const list = (events.data ?? []).filter((e) => filter === "all" || e.kind === filter);
  const isPast = (e: TimelineEvent) => e.year !== null && (e.year < today.year || (e.year === today.year && ((e.month ?? 0) < today.month || ((e.month ?? 0) === today.month && (e.day ?? 0) <= today.day))));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Timeline"
        subtitle={`Today is ${formatDate(calendar, today)}. History, campaign events, scheduled happenings and session dates.`}
        actions={
          <>
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-36">
              <option value="all">All kinds</option>
              <option value="history">History</option>
              <option value="campaign">Campaign</option>
              <option value="scheduled">Scheduled</option>
              <option value="session">Session</option>
            </Select>
            <Button variant="primary" onClick={() => setEditing({ id: null, draft: { ...emptyDraft(), ...today } })}>
              <Plus size={13} /> Add event
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ol className="relative ml-3 border-l border-border">
          {list.map((e) => (
            <li key={e.id} className="mb-4 ml-5">
              <span className={cn("absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border", isPast(e) ? "border-ember bg-ember" : "border-border-strong bg-bg")} />
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-muted">{e.year === null ? "undated" : formatDate(calendar, { year: e.year, month: e.month ?? 1, day: e.day ?? 1 })}</span>
                <Badge tone={e.kind === "history" ? "violet" : e.kind === "scheduled" ? "water" : e.kind === "session" ? "gold" : "ember"}>{e.kind}</Badge>
                {e.secret && (
                  <Badge tone="blood">
                    <EyeOff size={9} className="mr-1" /> secret
                  </Badge>
                )}
                <span className="ml-auto flex gap-1">
                  <button className="text-ink-faint hover:text-ink" onClick={() => setEditing({ id: e.id, draft: { entity_id: e.entity_id, title: e.title, body_md: e.body_md, year: e.year, month: e.month, day: e.day, kind: e.kind, secret: e.secret } })}>
                    <Pencil size={12} />
                  </button>
                  <button className="text-ink-faint hover:text-blood" onClick={() => remove.mutate(e.id)}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <div className="font-display text-[15px]">{e.title}</div>
              {e.entity_id && <LinkedEntity id={e.entity_id} />}
              {e.body_md && <MarkdownView source={e.body_md} className="mt-1 text-[12.5px]" />}
            </li>
          ))}
          {list.length === 0 && <li className="ml-5 text-ink-faint">No events.</li>}
        </ol>
      </div>
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={editing.id ? "Edit event" : "Add event"}
          footer={
            <Button variant="primary" disabled={!editing.draft.title.trim() || save.isPending} onClick={() => save.mutate(undefined as never)}>
              Save
            </Button>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <Field label="Title" className="col-span-3">
              <Input autoFocus value={editing.draft.title} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })} />
            </Field>
            <Field label="Year">
              <Input type="number" value={editing.draft.year ?? ""} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, year: e.target.value === "" ? null : Number(e.target.value) } })} />
            </Field>
            <Field label="Month">
              <Select value={editing.draft.month ?? ""} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, month: e.target.value === "" ? null : Number(e.target.value) } })}>
                <option value="">—</option>
                {calendar.months.map((m, i) => (
                  <option key={m.name} value={i + 1}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Day">
              <Input type="number" min={1} value={editing.draft.day ?? ""} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, day: e.target.value === "" ? null : Number(e.target.value) } })} />
            </Field>
            <Field label="Kind">
              <Select value={editing.draft.kind} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, kind: e.target.value as TimelineEvent["kind"] } })}>
                <option value="history">History</option>
                <option value="campaign">Campaign</option>
                <option value="scheduled">Scheduled</option>
                <option value="session">Session</option>
              </Select>
            </Field>
            <Field label="Related entity" className="col-span-2">
              <EntityPicker kinds={[...ENTITY_KINDS]} value={editing.draft.entity_id} onChange={(id) => setEditing({ ...editing, draft: { ...editing.draft, entity_id: id } })} allowNone />
            </Field>
            <Field label="Notes (Markdown)" className="col-span-3">
              <Textarea rows={4} value={editing.draft.body_md} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, body_md: e.target.value } })} />
            </Field>
            <Checkbox label="Secret (players do not know)" checked={editing.draft.secret} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, secret: v } })} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

function LinkedEntity({ id }: { id: string }) {
  const entity = useEntity(id);
  if (!entity.data) return null;
  return (
    <Link to={routeForEntity(entity.data)} className="text-[12px] text-ember-soft hover:underline">
      → {entity.data.name}
    </Link>
  );
}
