import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, Users, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { routeForEntity } from "@/app/routes";
import type { EnrichedSegment, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS, SEGMENT_CERTAINTY_LABELS } from "@/domain/journeyTypes";
import type { Entity } from "@/domain/types";
import { Badge, EmptyState } from "@/components/ui";
import { dateRange } from "@/features/journeyUtils";

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

/** Determine the role of a location within a segment: origin, destination, or waypoint. */
function deriveRole(segment: EnrichedSegment, locationId: string): string {
  if (segment.origin_entity_id === locationId) return "Origin";
  if (segment.destination_entity_id === locationId) return "Destination";
  const isWaypoint = segment.journey
    ? segment.waypoints?.some((w) => w.entity_id === locationId)
    : false;
  if (isWaypoint) return "Waypoint";
  return "Waypoint"; // fallback — locationVisitHistory only returns segments that reference this location
}

const ROLE_TONE: Record<string, "default" | "ember" | "moss" | "water"> = {
  Origin: "moss",
  Destination: "ember",
  Waypoint: "water",
};

// ── Main Component ──

export function VisitHistorySection({ entity }: { entity: Entity }) {
  const repos = useRepos();

  const visitHistory = useQuery({
    queryKey: ["journeys", "locationVisitHistory", entity.id],
    queryFn: () => repos.journeys.locationVisitHistory(entity.id),
  });

  const segments = visitHistory.data ?? [];
  const isLoading = visitHistory.isLoading;

  if (isLoading) {
    return <div className="flex items-center justify-center p-8 text-[12px] text-ink-faint">Loading visit history…</div>;
  }

  if (segments.length === 0) {
    return (
      <EmptyState
        title="No visits recorded"
        body="No travel segments reference this location as an origin, destination, or waypoint."
      />
    );
  }

  return (
    <div className="space-y-2 p-1">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Visit History</h3>
      <ul className="space-y-2">
        {segments.map((seg) => (
          <VisitCard key={seg.id} segment={seg} locationId={entity.id} />
        ))}
      </ul>
    </div>
  );
}

// ── Visit Card ──

function VisitCard({ segment, locationId }: { segment: EnrichedSegment; locationId: string }) {
  const role = deriveRole(segment, locationId);
  const originLabel = segment.origin_name ?? "Unknown origin";
  const destLabel = segment.destination_name ?? "Unknown destination";
  const range = dateRange(
    segment.start_year, segment.start_month, segment.start_day,
    segment.end_year, segment.end_month, segment.end_day,
  );
  const sessionId = segment.journey.session_id;

  return (
    <li className="rounded border border-border bg-bg-elevated p-2.5">
      {/* Route line: origin → destination */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <Route size={13} className="shrink-0 text-ink-faint" />
        {segment.origin_entity_id ? (
          <Link to={routeForEntity({ id: segment.origin_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">
            {originLabel}
          </Link>
        ) : (
          <span className="text-ink-muted">{originLabel}</span>
        )}
        <ChevronRight size={11} className="shrink-0 text-ink-faint" />
        {segment.destination_entity_id ? (
          <Link to={routeForEntity({ id: segment.destination_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">
            {destLabel}
          </Link>
        ) : (
          <span className="text-ink-muted">{destLabel}</span>
        )}
      </div>

      {/* Metadata row: role badge, journey category, certainty, date range, session */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
        <Badge tone={ROLE_TONE[role] ?? "default"}>{role}</Badge>
        <Badge tone={CATEGORY_TONE[segment.journey.category]}>{JOURNEY_CATEGORY_LABELS[segment.journey.category]}</Badge>
        <Badge>{SEGMENT_CERTAINTY_LABELS[segment.route_certainty]}</Badge>
        {range && <span>{range}</span>}
        {sessionId && (
          <Link
            to={routeForEntity({ id: sessionId, kind: "session", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            Session
          </Link>
        )}
      </div>

      {/* Journey name */}
      <div className="mt-1 text-[11px] text-ink-faint">
        {segment.journey.name}
      </div>

      {/* Participants */}
      {segment.participants.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
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
    </li>
  );
}
