import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, MapPin, Route, StickyNote, Users, X } from "lucide-react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { routeForEntity } from "@/app/routes";
import type { EnrichedSegment, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS, SEGMENT_CERTAINTY_LABELS } from "@/domain/journeyTypes";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { dateRange } from "@/features/journeyUtils";

// ── Badge tone per journey category (mirrors JourneyTimelineTab) ──

const CATEGORY_TONE: Record<JourneyCategory, "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"> = {
  campaign: "ember",
  party: "water",
  backstory: "violet",
  individual: "gold",
  npc: "default",
  flashback: "violet",
  uncertain: "default",
};

// ── Props ──

export interface SegmentDetailPanelProps {
  segment: EnrichedSegment | null;
  /** When set (and segment is null), show location visit history instead. Req 21.3 */
  locationId?: string | null;
  /** Display name for the location in visit-history mode. */
  locationName?: string | null;
  onClose: () => void;
}

/**
 * Contextual side panel displayed when a route segment polyline is clicked on the atlas.
 * Shows journey name, category, origin→destination, date range, certainty, travelers,
 * session, notes, and events. Omits any section with no data.
 *
 * When `locationId` is set and `segment` is null, switches to location visit history
 * mode and displays all travel segments referencing that location. (Req 21.3)
 *
 * Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 21.3
 */
export function SegmentDetailPanel({ segment, locationId, locationName, onClose }: SegmentDetailPanelProps) {
  // Location visit history mode (Req 21.3)
  if (!segment && locationId) {
    return <LocationVisitPanel locationId={locationId} locationName={locationName ?? "Location"} onClose={onClose} />;
  }

  if (!segment) return null;

  const originLabel = segment.origin_name ?? "Unknown origin";
  const destLabel = segment.destination_name ?? "Unknown destination";
  const range = dateRange(
    segment.start_year, segment.start_month, segment.start_day,
    segment.end_year, segment.end_month, segment.end_day,
  );
  const sessionId = segment.journey.session_id;

  return (
    <aside
      className="absolute right-0 top-0 z-30 flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg-panel shadow-lg"
      role="complementary"
      aria-label="Segment details"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink">{segment.journey.name}</span>
            <Badge tone={CATEGORY_TONE[segment.journey.category]}>
              {JOURNEY_CATEGORY_LABELS[segment.journey.category]}
            </Badge>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close segment panel">
          <X size={14} />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
        {/* Origin → Destination */}
        <section>
          <SectionHeading icon={<Route size={12} />} label="Route" />
          <div className="flex items-center gap-1.5 text-[13px]">
            <LocationLink entityId={segment.origin_entity_id} name={originLabel} />
            <ChevronRight size={11} className="shrink-0 text-ink-faint" />
            <LocationLink entityId={segment.destination_entity_id} name={destLabel} />
          </div>
        </section>

        {/* Date range */}
        {range && (
          <section>
            <SectionHeading icon={<Calendar size={12} />} label="Date Range" />
            <span className="text-[12px] text-ink-muted">{range}</span>
          </section>
        )}

        {/* Route certainty */}
        <section>
          <SectionHeading icon={<MapPin size={12} />} label="Route Certainty" />
          <Badge>{SEGMENT_CERTAINTY_LABELS[segment.route_certainty]}</Badge>
        </section>

        {/* Travelers */}
        {segment.participants.length > 0 && (
          <section>
            <SectionHeading icon={<Users size={12} />} label="Travelers" />
            <ul className="space-y-1">
              {segment.participants.map((p) => (
                <li key={p.id} className="flex items-center gap-1.5 text-[12px]">
                  <Link
                    to={routeForEntity({ id: p.entity_id, kind: "pc", parent_id: null })}
                    className="text-ember-soft hover:underline"
                  >
                    {p.entity_name}
                  </Link>
                  {p.role && p.role !== "traveler" && (
                    <span className="text-ink-faint">({p.role})</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Session */}
        {sessionId && (
          <section>
            <SectionHeading icon={<Calendar size={12} />} label="Session" />
            <Link
              to={routeForEntity({ id: sessionId, kind: "session", parent_id: null })}
              className="text-[12px] text-ember-soft hover:underline"
            >
              Session
            </Link>
          </section>
        )}

        {/* Notes */}
        {segment.notes && segment.notes.trim() !== "" && (
          <section>
            <SectionHeading icon={<StickyNote size={12} />} label="Notes" />
            <p className="whitespace-pre-wrap text-[12px] text-ink-muted">{segment.notes}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

// ── Helpers ──

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {icon}
      {label}
    </h4>
  );
}

/** Renders a location name as a navigation link when the entity exists, or plain text otherwise. Req 10.6 */
function LocationLink({ entityId, name }: { entityId: string | null; name: string }) {
  if (entityId) {
    return (
      <Link
        to={routeForEntity({ id: entityId, kind: "location", parent_id: null })}
        className="text-ember-soft hover:underline"
      >
        {name}
      </Link>
    );
  }
  return <span className="text-ink-muted">{name}</span>;
}

// ── Location Visit History Panel (Req 21.3) ──

/** Determine the role of a location within a segment: origin, destination, or waypoint. */
function deriveRole(segment: EnrichedSegment, locationId: string): string {
  if (segment.origin_entity_id === locationId) return "Origin";
  if (segment.destination_entity_id === locationId) return "Destination";
  return "Waypoint";
}

const ROLE_TONE: Record<string, "default" | "ember" | "moss" | "water"> = {
  Origin: "moss",
  Destination: "ember",
  Waypoint: "water",
};

/**
 * Panel showing location visit history — used when a DM clicks a location marker
 * on the atlas while the journey overlay is active. (Req 21.3)
 */
function LocationVisitPanel({ locationId, locationName, onClose }: { locationId: string; locationName: string; onClose: () => void }) {
  const repos = useRepos();

  const visitHistory = useQuery({
    queryKey: ["journeys", "locationVisitHistory", locationId],
    queryFn: () => repos.journeys.locationVisitHistory(locationId),
  });

  const segments = visitHistory.data ?? [];
  const isLoading = visitHistory.isLoading;

  return (
    <aside
      className="absolute right-0 top-0 z-30 flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg-panel shadow-lg"
      role="complementary"
      aria-label="Location visit history"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <MapPin size={13} className="shrink-0 text-ink-faint" />
            <span className="truncate text-sm font-semibold text-ink">{locationName}</span>
          </div>
          <span className="text-[11px] text-ink-faint">Visit History</span>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close visit history panel">
          <X size={14} />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <Spinner />
          </div>
        )}

        {!isLoading && segments.length === 0 && (
          <EmptyState
            title="No visits recorded"
            body="No travel segments reference this location as an origin, destination, or waypoint."
          />
        )}

        {!isLoading && segments.length > 0 && (
          <ul className="space-y-2">
            {segments.map((seg) => (
              <VisitCard key={seg.id} segment={seg} locationId={locationId} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Compact visit card for the atlas side panel. */
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
      {/* Route: origin → destination */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <Route size={13} className="shrink-0 text-ink-faint" />
        <LocationLink entityId={segment.origin_entity_id} name={originLabel} />
        <ChevronRight size={11} className="shrink-0 text-ink-faint" />
        <LocationLink entityId={segment.destination_entity_id} name={destLabel} />
      </div>

      {/* Metadata: role, category, certainty, date range, session */}
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
      <div className="mt-1 text-[11px] text-ink-faint">{segment.journey.name}</div>

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
