import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus, Route, Calendar, Users, ChevronRight, Globe2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { useCampaignId, useEntitiesOfKinds } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import type { EnrichedSegment, ExtendedTimelineEvent, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS, SEGMENT_CERTAINTY_LABELS, TIMELINE_EVENT_CATEGORY_LABELS } from "@/domain/journeyTypes";
import type { Entity } from "@/domain/types";
import { Badge, Button, EmptyState, Tooltip } from "@/components/ui";
import { formatCalendarDate, dateRange, deriveCurrentLocation, groupEventsBySession } from "@/features/journeyUtils";
import { JourneyEditor } from "@/features/journeys/JourneyEditor";

// ── Badge tone per journey category ──

const CATEGORY_TONE: Record<JourneyCategory, "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"> = {
  campaign: "ember",
  party: "water",
  backstory: "violet",
  individual: "gold",
  npc: "default",
  flashback: "violet",
  uncertain: "default",
};

/** Build a lookup map of entity id → name from sessions list. */
function buildSessionMap(sessions: Entity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sessions) map.set(s.id, s.name);
  return map;
}

/** Hook returning a callback that navigates to the atlas for a given location, or shows a toast if unmapped. */
function useShowOnAtlas() {
  const repos = useRepos();
  const navigate = useNavigate();
  return useCallback(
    async (locationId: string) => {
      const links = await repos.worldMaps.featureLinksForEntity(locationId);
      const mapped = links.find((l) => l.x != null && l.y != null);
      if (mapped) {
        navigate(`/atlas/${mapped.map_id}?entity=${locationId}`);
      } else {
        toast.info("This location is not placed on any atlas map yet.");
      }
    },
    [repos, navigate],
  );
}

// ── Atlas Button ──

function AtlasButton({ locationId, hasCoords }: { locationId: string; hasCoords: boolean }) {
  const showOnAtlas = useShowOnAtlas();
  if (!hasCoords) {
    return (
      <Tooltip content="Location not placed on the atlas">
        <button type="button" className="inline-flex items-center text-ink-faint opacity-40 cursor-not-allowed" disabled>
          <Globe2 size={12} />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Show on atlas">
      <button
        type="button"
        className="inline-flex items-center text-ink-muted hover:text-ember-soft"
        onClick={(e) => { e.preventDefault(); showOnAtlas(locationId); }}
      >
        <Globe2 size={12} />
      </button>
    </Tooltip>
  );
}

/** Atlas button for the Current Location section — queries feature links to determine map status. */
function CurrentLocationAtlasButton({ locationId }: { locationId: string }) {
  const repos = useRepos();
  const links = useQuery({
    queryKey: ["maps", "featureLinksForEntity", locationId],
    queryFn: () => repos.worldMaps.featureLinksForEntity(locationId),
  });
  const hasCoords = (links.data ?? []).some((l) => l.x != null && l.y != null);
  return <AtlasButton locationId={locationId} hasCoords={hasCoords} />;
}

// ── Main Component ──

export function JourneyTimelineTab({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const [editorOpen, setEditorOpen] = useState(false);

  // Fetch travel history (enriched segments for this character)
  const travelHistory = useQuery({
    queryKey: ["journeys", "characterTravel", entity.id],
    queryFn: () => repos.journeys.characterTravelHistory(entity.id),
  });

  // Fetch timeline events for this character
  const timelineEvents = useQuery({
    queryKey: ["journeys", "eventsForCharacter", entity.id],
    queryFn: () => repos.journeys.eventsForCharacter(entity.id),
  });

  // Fetch all sessions for session name lookups
  const sessions = useEntitiesOfKinds(["session"]);
  const sessionMap = useMemo(() => buildSessionMap(sessions.data ?? []), [sessions.data]);

  const segments = travelHistory.data ?? [];
  const events = timelineEvents.data ?? [];
  const currentLocation = useMemo(() => deriveCurrentLocation(segments), [segments]);
  const eventGroups = useMemo(() => groupEventsBySession(events, sessionMap), [events, sessionMap]);

  const isEmpty = segments.length === 0 && events.length === 0;
  const isLoading = travelHistory.isLoading || timelineEvents.isLoading;

  if (isLoading) {
    return <div className="flex items-center justify-center p-8 text-[12px] text-ink-faint">Loading journey data…</div>;
  }

  if (isEmpty) {
    return (
      <>
        <EmptyState
          title="No journey history recorded"
          body="This character has no travel segments or timeline events yet."
          action={campaignId ? <Button variant="primary" onClick={() => setEditorOpen(true)}><Plus size={13} /> New Journey</Button> : undefined}
        />
        {campaignId && <JourneyEditor open={editorOpen} onOpenChange={setEditorOpen} campaignId={campaignId} />}
      </>
    );
  }

  return (
    <div className="space-y-6 p-1">
      {/* ── Current Location ── */}
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Current Location</h3>
        {currentLocation ? (
          <div className="flex items-center gap-2">
            <Link
              to={routeForEntity({ id: currentLocation.id, kind: "location", parent_id: null })}
              className="inline-flex items-center gap-1.5 text-[13px] text-ember-soft hover:underline"
            >
              <MapPin size={13} />
              {currentLocation.name}
            </Link>
            <CurrentLocationAtlasButton locationId={currentLocation.id} />
          </div>
        ) : (
          <span className="text-[12px] text-ink-faint">No known location</span>
        )}
      </section>

      {/* ── Travel History ── */}
      {segments.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Travel History</h3>
          <ul className="space-y-2">
            {segments.map((seg) => (
              <SegmentCard key={seg.id} segment={seg} sessionMap={sessionMap} currentEntityId={entity.id} />
            ))}
          </ul>
        </section>
      )}

      {/* ── Timeline Events ── */}
      {events.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Timeline</h3>
          <div className="space-y-3">
            {eventGroups.map((group) => (
              <div key={group.sessionId ?? "none"}>
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                  <Calendar size={11} />
                  {group.sessionId ? (
                    <Link
                      to={routeForEntity({ id: group.sessionId, kind: "session", parent_id: null })}
                      className="text-ember-soft hover:underline"
                    >
                      {group.sessionLabel}
                    </Link>
                  ) : (
                    <span>{group.sessionLabel}</span>
                  )}
                </div>
                <ul className="space-y-1 border-l-2 border-border pl-3">
                  {group.events.map((ev) => (
                    <TimelineEventCard key={ev.id} event={ev} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Segment Card ──

function SegmentCard({
  segment,
  sessionMap,
  currentEntityId,
}: {
  segment: EnrichedSegment;
  sessionMap: Map<string, string>;
  currentEntityId: string;
}) {
  const originLabel = segment.origin_name ?? "Unknown origin";
  const destLabel = segment.destination_name ?? "Unknown destination";
  const range = dateRange(
    segment.start_year, segment.start_month, segment.start_day,
    segment.end_year, segment.end_month, segment.end_day,
  );
  const sessionName = segment.journey.session_id ? sessionMap.get(segment.journey.session_id) : null;
  const coTravelers = segment.participants.filter((p) => p.entity_id !== currentEntityId);

  return (
    <li className="rounded border border-border bg-bg-elevated p-2.5">
      {/* Route line: origin → destination */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <Route size={13} className="shrink-0 text-ink-faint" />
        {segment.origin_entity_id ? (
          <>
            <Link to={routeForEntity({ id: segment.origin_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">
              {originLabel}
            </Link>
            <AtlasButton locationId={segment.origin_entity_id} hasCoords={segment.origin_coords != null} />
          </>
        ) : (
          <span className="text-ink-muted">{originLabel}</span>
        )}
        <ChevronRight size={11} className="shrink-0 text-ink-faint" />
        {segment.destination_entity_id ? (
          <>
            <Link to={routeForEntity({ id: segment.destination_entity_id, kind: "location", parent_id: null })} className="text-ember-soft hover:underline">
              {destLabel}
            </Link>
            <AtlasButton locationId={segment.destination_entity_id} hasCoords={segment.destination_coords != null} />
          </>
        ) : (
          <span className="text-ink-muted">{destLabel}</span>
        )}
      </div>

      {/* Metadata row */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
        <Badge tone={CATEGORY_TONE[segment.journey.category]}>{JOURNEY_CATEGORY_LABELS[segment.journey.category]}</Badge>
        <Badge>{SEGMENT_CERTAINTY_LABELS[segment.route_certainty]}</Badge>
        {range && <span>{range}</span>}
        {sessionName && segment.journey.session_id && (
          <Link
            to={routeForEntity({ id: segment.journey.session_id, kind: "session", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            {sessionName}
          </Link>
        )}
      </div>

      {/* Journey name */}
      <div className="mt-1 text-[11px] text-ink-faint">
        {segment.journey.name}
      </div>

      {/* Co-travelers */}
      {coTravelers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          <Users size={11} className="text-ink-faint" />
          {coTravelers.map((p, i) => (
            <span key={p.id}>
              <Link
                to={routeForEntity({ id: p.entity_id, kind: "pc", parent_id: null })}
                className="text-ember-soft hover:underline"
              >
                {p.entity_name}
              </Link>
              {p.role && p.role !== "traveler" && <span className="text-ink-faint"> ({p.role})</span>}
              {i < coTravelers.length - 1 && <span className="text-ink-faint">, </span>}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// ── Timeline Event Card ──

function TimelineEventCard({ event }: { event: ExtendedTimelineEvent }) {
  const eventDate = formatCalendarDate(event.year, event.month, event.day);
  const categoryLabel = TIMELINE_EVENT_CATEGORY_LABELS[event.category] ?? event.category;

  return (
    <li className="py-1">
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className="font-medium text-ink">{event.title}</span>
        {event.category !== "general" && <Badge>{categoryLabel}</Badge>}
        {event.confidence !== "certain" && <Badge tone="default">{event.confidence}</Badge>}
        {event.secret && <Badge tone="blood">secret</Badge>}
      </div>
      {eventDate && <div className="text-[10.5px] text-ink-faint">{eventDate}</div>}
    </li>
  );
}
