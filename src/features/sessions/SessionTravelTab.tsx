import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Route, Users, BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import type { EnrichedSegment, ExtendedTimelineEvent, Journey, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS } from "@/domain/journeyTypes";
import type { Entity } from "@/domain/types";
import { Badge, Button, EmptyState } from "@/components/ui";
import { formatJourneyDateRange } from "@/features/journeyUtils";
import { JourneyEditor } from "@/features/journeys/JourneyEditor";

// ── Badge tone per journey category (matches JourneyTimelineTab) ──

const CATEGORY_TONE: Record<JourneyCategory, "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"> = {
  campaign: "ember",
  party: "water",
  backstory: "violet",
  individual: "gold",
  npc: "default",
  flashback: "violet",
  uncertain: "default",
};

/**
 * "Travel" tab for Session EntityDetail.
 *
 * Displays all journeys and travel segments associated with the session,
 * grouped by journey name and ordered by segment sort_order.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */
export function SessionTravelTab({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const [editorOpen, setEditorOpen] = useState(false);

  // Fetch session travel summary: journeys + enriched segments grouped by journey
  const travelSummary = useQuery({
    queryKey: ["journeys", "sessionTravelSummary", entity.id],
    queryFn: () => repos.journeys.sessionTravelSummary(entity.id),
  });

  // Collect all segment IDs for timeline events lookup
  const segmentIds = useMemo(() => {
    if (!travelSummary.data) return [];
    return travelSummary.data.flatMap((g) => g.segments.map((s) => s.id));
  }, [travelSummary.data]);

  // Fetch timeline events for all segments in one query, keyed by segment_id
  const segmentEvents = useQuery({
    queryKey: ["journeys", "eventsForSegments", segmentIds],
    queryFn: () => repos.journeys.eventsForSegments(segmentIds),
    enabled: segmentIds.length > 0,
  });

  const groups = travelSummary.data ?? [];
  const eventMap = segmentEvents.data ?? {};

  if (travelSummary.isLoading) {
    return <div className="flex items-center justify-center p-8 text-[12px] text-ink-faint">Loading travel data…</div>;
  }

  if (groups.length === 0) {
    return (
      <>
        <EmptyState
          title="No travel recorded for this session"
          body="Create a journey and link it to this session to see travel here."
          action={campaignId ? <Button variant="primary" onClick={() => setEditorOpen(true)}><Plus size={13} /> New Journey</Button> : undefined}
        />
        {campaignId && <JourneyEditor open={editorOpen} onOpenChange={setEditorOpen} campaignId={campaignId} defaultSessionId={entity.id} />}
      </>
    );
  }

  return (
    <div className="space-y-4 p-1">
      {campaignId && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}><Plus size={12} /> New Journey</Button>
          <JourneyEditor open={editorOpen} onOpenChange={setEditorOpen} campaignId={campaignId} defaultSessionId={entity.id} />
        </div>
      )}
      {groups.map((group) => (
        <JourneyGroup
          key={group.journey.id}
          journey={group.journey}
          segments={group.segments}
          eventMap={eventMap}
        />
      ))}
    </div>
  );
}

// ── Journey Group ──

function JourneyGroup({
  journey,
  segments,
  eventMap,
}: {
  journey: Journey;
  segments: EnrichedSegment[];
  eventMap: Record<string, ExtendedTimelineEvent[]>;
}) {
  const dateRange = formatJourneyDateRange(journey);

  return (
    <div className="rounded border border-border">
      {/* Journey header */}
      <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-3 py-2">
        <span className="text-[13px] font-medium">{journey.name}</span>
        <Badge tone={CATEGORY_TONE[journey.category]}>
          {JOURNEY_CATEGORY_LABELS[journey.category]}
        </Badge>
        {dateRange && <span className="ml-auto text-[11px] text-ink-faint">{dateRange}</span>}
      </div>

      {/* Segments list */}
      {segments.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-ink-faint">No travel segments in this journey.</div>
      ) : (
        <ul className="divide-y divide-border">
          {segments.map((seg) => (
            <SegmentRow key={seg.id} segment={seg} events={eventMap[seg.id] ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Segment Row ──

function SegmentRow({
  segment,
  events,
}: {
  segment: EnrichedSegment;
  events: ExtendedTimelineEvent[];
}) {
  const originLabel = segment.origin_name ?? "Unknown location";
  const destLabel = segment.destination_name ?? "Unknown location";

  return (
    <li className="px-3 py-2 text-[12.5px]">
      {/* Route line: origin → destination */}
      <div className="flex items-center gap-1.5">
        <Route size={13} className="shrink-0 text-ink-faint" />
        {segment.origin_entity_id ? (
          <Link
            to={routeForEntity({ id: segment.origin_entity_id, kind: "location", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            {originLabel}
          </Link>
        ) : (
          <span className="text-ink-muted">{originLabel}</span>
        )}
        <ChevronRight size={11} className="shrink-0 text-ink-faint" />
        {segment.destination_entity_id ? (
          <Link
            to={routeForEntity({ id: segment.destination_entity_id, kind: "location", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            {destLabel}
          </Link>
        ) : (
          <span className="text-ink-muted">{destLabel}</span>
        )}
      </div>

      {/* Participants */}
      {segment.participants.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          <Users size={11} className="text-ink-faint" />
          {segment.participants.map((p, i) => (
            <span key={p.id}>
              <Link
                to={routeForEntity({ id: p.entity_id, kind: "pc", parent_id: null })}
                className="text-ember-soft hover:underline"
              >
                {p.entity_name}
              </Link>
              {p.role && p.role !== "traveler" && <span className="text-ink-faint"> ({p.role})</span>}
              {i < segment.participants.length - 1 && <span className="text-ink-faint">, </span>}
            </span>
          ))}
        </div>
      )}

      {/* Timeline event titles */}
      {events.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
          <BookOpen size={11} className="shrink-0 text-ink-faint" />
          {events.map((ev, i) => (
            <span key={ev.id}>
              {ev.title}
              {i < events.length - 1 && <span className="text-ink-faint"> · </span>}
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      {segment.notes && segment.notes.trim() !== "" && (
        <div className="mt-0.5 text-[11px] italic text-ink-faint">— {segment.notes}</div>
      )}
    </li>
  );
}
