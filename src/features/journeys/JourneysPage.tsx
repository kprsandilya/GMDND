import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, Pencil, Plus, Route, Search, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAction, useCampaignId, useEntitiesOfKinds } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import {
  JOURNEY_CATEGORIES,
  JOURNEY_CATEGORY_LABELS,
  ROUTE_CERTAINTY_LABELS,
  SEGMENT_CERTAINTY_LABELS,
  type EnrichedSegment,
  type JourneyCategory,
} from "@/domain/journeyTypes";
import type { Entity } from "@/domain/types";
import { Badge, Button, ConfirmDialog, EmptyState, Input, PageHeader, Select, SplitPane } from "@/components/ui";
import { dateRange, formatJourneyDateRange } from "@/features/journeyUtils";
import { JourneyEditor } from "./JourneyEditor";

// ── Badge tones per category ──

const CATEGORY_TONE: Record<JourneyCategory, "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"> = {
  campaign: "ember",
  party: "water",
  backstory: "violet",
  individual: "gold",
  npc: "default",
  flashback: "violet",
  uncertain: "default",
};

// ── Helper: build a lookup map ──

function buildLookup(entities: Entity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entities) map.set(e.id, e.name);
  return map;
}

// ── Main Page ──

export function JourneysPage() {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id: string }>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [term, setTerm] = useState("");
  const [catFilter, setCatFilter] = useState<JourneyCategory | "">("");

  // All journeys for the campaign
  const journeysQuery = useQuery({
    queryKey: ["journeys", "list", campaignId],
    queryFn: () => repos.journeys.listJourneys(campaignId!),
    enabled: !!campaignId,
  });
  const journeys = journeysQuery.data ?? [];

  // Session + party name lookups
  const sessions = useEntitiesOfKinds(["session"]);
  const parties = useEntitiesOfKinds(["party"]);
  const sessionMap = useMemo(() => buildLookup(sessions.data ?? []), [sessions.data]);
  const partyMap = useMemo(() => buildLookup(parties.data ?? []), [parties.data]);

  // Filter
  const filtered = useMemo(() => {
    let items = journeys;
    if (catFilter) items = items.filter((j) => j.category === catFilter);
    const t = term.trim().toLowerCase();
    if (t) items = items.filter((j) => j.name.toLowerCase().includes(t) || j.description.toLowerCase().includes(t));
    return items;
  }, [journeys, catFilter, term]);

  if (!campaignId) return <EmptyState title="No campaign selected" />;

  return (
    <>
      <SplitPane
        width={280}
        onWidthChange={() => { }}
        left={
          <>
            {/* Header */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
              <h2 className="font-display text-[15px] text-ember-soft">Journeys</h2>
              <Button variant="primary" size="sm" onClick={() => { setEditingId(undefined); setCreating(true); }}>
                <Plus size={12} /> New
              </Button>
            </div>

            {/* Filters */}
            <div className="flex shrink-0 gap-1.5 border-b border-border p-2">
              <div className="relative flex-1">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter…" className="pl-6" />
              </div>
              <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value as JourneyCategory | "")} className="w-28">
                <option value="">All types</option>
                {JOURNEY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{JOURNEY_CATEGORY_LABELS[c]}</option>
                ))}
              </Select>
            </div>

            {/* Journey list */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && !journeysQuery.isLoading && (
                <div className="p-4 text-center text-[12px] text-ink-faint">
                  {journeys.length === 0 ? "No journeys recorded yet." : "No matches."}
                </div>
              )}
              {filtered.map((j) => {
                const dr = formatJourneyDateRange(j);
                const sessionName = j.session_id ? sessionMap.get(j.session_id) : null;
                const partyName = j.party_id ? partyMap.get(j.party_id) : null;
                return (
                  <button
                    key={j.id}
                    onClick={() => navigate(`/journeys/${j.id}`)}
                    className={`row-hover block w-full px-3 py-1.5 text-left ${j.id === selectedId ? "row-active" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px]">{j.name}</span>
                      <Badge tone={CATEGORY_TONE[j.category]} className="ml-auto">{JOURNEY_CATEGORY_LABELS[j.category]}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-faint">
                      {dr && <span>{dr}</span>}
                      {sessionName && <><span>·</span><span>{sessionName}</span></>}
                      {partyName && <><span>·</span><Users size={10} /><span>{partyName}</span></>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-ink-faint">
              {filtered.length} journey{filtered.length !== 1 ? "s" : ""}
            </div>
          </>
        }
        right={
          selectedId ? (
            <JourneyDetail journeyId={selectedId} campaignId={campaignId} sessionMap={sessionMap} partyMap={partyMap} onEdit={(id) => { setEditingId(id); setCreating(true); }} onDeleted={() => navigate("/journeys")} />
          ) : (
            <EmptyState
              title="Journeys"
              body="Track character and party travel across the world. Select a journey on the left or create a new one."
              action={
                <Button variant="primary" onClick={() => { setEditingId(undefined); setCreating(true); }}>
                  <Plus size={13} /> New Journey
                </Button>
              }
            />
          )
        }
      />
      {campaignId && (
        <JourneyEditor
          open={creating}
          onOpenChange={setCreating}
          journeyId={editingId}
          campaignId={campaignId}
        />
      )}
    </>
  );
}

// ── Journey Detail Panel ──

function JourneyDetail({
  journeyId,
  campaignId: _campaignId,
  sessionMap,
  partyMap,
  onEdit,
  onDeleted,
}: {
  journeyId: string;
  campaignId: string;
  sessionMap: Map<string, string>;
  partyMap: Map<string, string>;
  onEdit: (id: string) => void;
  onDeleted: () => void;
}) {
  const repos = useRepos();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const journey = useQuery({
    queryKey: ["journeys", "one", journeyId],
    queryFn: () => repos.journeys.getJourney(journeyId),
  });

  const segments = useQuery({
    queryKey: ["journeys", "segments", journeyId],
    queryFn: () => repos.journeys.enrichedSegmentsForJourney(journeyId),
    enabled: !!journeyId,
  });

  const remove = useAction(() => repos.journeys.deleteJourney(journeyId), {
    success: "Journey deleted",
    invalidate: [["journeys"], ["entities"]],
    onSuccess: onDeleted,
  });

  if (journey.isLoading) return <div className="flex items-center justify-center p-8 text-ink-faint">Loading…</div>;
  if (!journey.data) return <EmptyState title="Journey not found" />;

  const j = journey.data;
  const dr = formatJourneyDateRange(j);
  const sessionName = j.session_id ? sessionMap.get(j.session_id) : null;
  const partyName = j.party_id ? partyMap.get(j.party_id) : null;
  const segs = segments.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {j.name}
            <Badge tone={CATEGORY_TONE[j.category]}>{JOURNEY_CATEGORY_LABELS[j.category]}</Badge>
            <Badge>{ROUTE_CERTAINTY_LABELS[j.route_certainty]}</Badge>
          </span>
        }
        subtitle={dr ?? undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => onEdit(j.id)}>
              <Pencil size={13} /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          {sessionName && (
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              <Link to={routeForEntity({ id: j.session_id!, kind: "session", parent_id: null })} className="text-ember-soft hover:underline">{sessionName}</Link>
            </span>
          )}
          {partyName && (
            <span className="flex items-center gap-1">
              <Users size={12} />
              <Link to={routeForEntity({ id: j.party_id!, kind: "party", parent_id: null })} className="text-ember-soft hover:underline">{partyName}</Link>
            </span>
          )}
        </div>

        {/* Description */}
        {j.description && (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Description</h3>
            <p className="text-[13px] text-ink whitespace-pre-line">{j.description}</p>
          </section>
        )}

        {/* DM Notes */}
        {j.dm_notes && (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">DM Notes</h3>
            <p className="text-[13px] text-ink-muted italic whitespace-pre-line">{j.dm_notes}</p>
          </section>
        )}

        {/* Travel Segments */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Travel Segments ({segs.length})
          </h3>
          {segs.length === 0 && <p className="text-[12px] text-ink-faint">No segments recorded. Open the editor to add travel stops.</p>}
          <ul className="space-y-2">
            {segs.map((seg, idx) => (
              <SegmentRow key={seg.id} segment={seg} index={idx} />
            ))}
          </ul>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete journey?"
        body={`This will permanently delete "${j.name}" and all its travel segments and participant records. Characters and locations are not affected.`}
        onConfirm={() => remove.mutate(undefined as never)}
      />
    </div>
  );
}

// ── Segment Row ──

function SegmentRow({ segment, index }: { segment: EnrichedSegment; index: number }) {
  const originLabel = segment.origin_name ?? "Unknown";
  const destLabel = segment.destination_name ?? "Unknown";
  const dr = dateRange(
    segment.start_year, segment.start_month, segment.start_day,
    segment.end_year, segment.end_month, segment.end_day,
  );

  return (
    <li className="rounded border border-border bg-bg-elevated p-2.5">
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="shrink-0 text-[10px] font-semibold text-ink-faint">#{index + 1}</span>
        <Route size={13} className="shrink-0 text-ink-faint" />
        {segment.origin_entity_id ? (
          <Link to={routeForEntity({ id: segment.origin_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">{originLabel}</Link>
        ) : (
          <span className="text-ink-muted">{originLabel}</span>
        )}
        <ChevronRight size={11} className="shrink-0 text-ink-faint" />
        {segment.destination_entity_id ? (
          <Link to={routeForEntity({ id: segment.destination_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">{destLabel}</Link>
        ) : (
          <span className="text-ink-muted">{destLabel}</span>
        )}
        <Badge className="ml-auto" tone="default">{SEGMENT_CERTAINTY_LABELS[segment.route_certainty]}</Badge>
      </div>

      {/* Metadata */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
        {dr && <span><Calendar size={10} className="mr-0.5 inline" />{dr}</span>}
        {segment.participants.length > 0 && (
          <span className="flex items-center gap-0.5">
            <Users size={10} />
            {segment.participants.map((p) => p.entity_name || "Unknown").join(", ")}
          </span>
        )}
      </div>

      {/* Notes */}
      {segment.notes && <p className="mt-1 text-[12px] text-ink-muted">{segment.notes}</p>}
    </li>
  );
}
