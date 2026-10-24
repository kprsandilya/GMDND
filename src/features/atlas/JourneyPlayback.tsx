/**
 * Journey playback: timeline slider with step/jump controls for progressive route reveal.
 *
 * Exports:
 *  - `usePlaybackStore`  — zustand store managing playback state
 *  - `JourneyPlayback`   — React component: slider + controls + current-segment panel
 *  - `visibleSegments`   — pure helper returning segments up to the current position
 *  - `sortForPlayback`   — pure helper that orders segments into playback sequence
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7
 */

import { Calendar, ChevronLeft, ChevronRight, MapPin, Pause, Play, Route, SkipForward, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { create } from "zustand";
import { useRepos } from "@/app/appContext";
import { routeForEntity } from "@/app/routes";
import { Badge, Button, Select, Tooltip } from "@/components/ui";
import type { EnrichedSegment, ExtendedTimelineEvent } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS, type JourneyCategory } from "@/domain/journeyTypes";
import { cn } from "@/lib/utils";
import { dateRange } from "@/features/journeyUtils";

// ── Playback ordering (Req 19.6) ──

/**
 * Compare helper for nullable numbers — nulls sort last.
 * Returns negative if a < b, positive if a > b, 0 if equal (both null counts as equal).
 */
function cmpNullable(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  return a - b;
}

/**
 * Sort enriched segments into playback order:
 *  1. Journey start date (year → month → day), undated journeys last
 *  2. Journey sort_order
 *  3. Segment sort_order within the journey
 *  4. Fallback: created_at
 *
 * Returns a NEW sorted array — does not mutate the input.
 */
export function sortForPlayback(segments: EnrichedSegment[]): EnrichedSegment[] {
  return [...segments].sort((a, b) => {
    const ja = a.journey;
    const jb = b.journey;

    // 1. Journey start date (nulls last)
    let d = cmpNullable(ja.start_year, jb.start_year);
    if (d !== 0) return d;
    d = cmpNullable(ja.start_month, jb.start_month);
    if (d !== 0) return d;
    d = cmpNullable(ja.start_day, jb.start_day);
    if (d !== 0) return d;

    // 2. Journey sort_order
    d = ja.sort_order - jb.sort_order;
    if (d !== 0) return d;

    // 3. Segment sort_order within journey
    d = a.sort_order - b.sort_order;
    if (d !== 0) return d;

    // 4. Fallback: created_at
    return a.created_at.localeCompare(b.created_at);
  });
}

// ── Visible segments helper (Req 19.2, 19.3) ──

/**
 * Returns the subset of the (already ordered) playback segments that should be
 * visible at the given position.
 *
 * - position = -1  → no segments visible (before first)
 * - position = 0   → first segment visible
 * - position = n-1 → all segments visible
 */
export function visibleSegments(segments: EnrichedSegment[], position: number): EnrichedSegment[] {
  if (position < 0) return [];
  return segments.slice(0, position + 1);
}

// ── Zustand store ──

export interface PlaybackState {
  /** Whether playback mode is active. */
  active: boolean;
  /** Ordered playback sequence of segments. */
  segments: EnrichedSegment[];
  /** Current position: -1 = before first segment, 0..n-1 = segment index. */
  position: number;
  /** Move forward by one segment. */
  stepForward(): void;
  /** Move backward by one segment. */
  stepBackward(): void;
  /** Jump to the first segment whose parent journey is linked to the given session. */
  jumpToSession(sessionId: string): void;
  /** Set the slider to an arbitrary position. */
  setPosition(index: number): void;
  /** Activate playback with a given set of segments (sorted into playback order). */
  activate(segments: EnrichedSegment[]): void;
  /** Deactivate playback and reset state. */
  deactivate(): void;
}

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  active: false,
  segments: [],
  position: -1,

  stepForward() {
    const { segments, position } = get();
    if (position < segments.length - 1) {
      set({ position: position + 1 });
    }
  },

  stepBackward() {
    const { position } = get();
    if (position > -1) {
      set({ position: position - 1 });
    }
  },

  jumpToSession(sessionId: string) {
    const { segments } = get();
    const idx = segments.findIndex((s) => s.journey.session_id === sessionId);
    if (idx >= 0) {
      set({ position: idx });
    }
  },

  setPosition(index: number) {
    const { segments } = get();
    const clamped = Math.max(-1, Math.min(index, segments.length - 1));
    set({ position: clamped });
  },

  activate(segments: EnrichedSegment[]) {
    const sorted = sortForPlayback(segments);
    set({ active: true, segments: sorted, position: -1 });
  },

  deactivate() {
    set({ active: false, segments: [], position: -1 });
  },
}));

// ── Badge tone per journey category (same as SegmentDetailPanel) ──

const CATEGORY_TONE: Record<JourneyCategory, "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"> = {
  campaign: "ember",
  party: "water",
  backstory: "violet",
  individual: "gold",
  npc: "default",
  flashback: "violet",
  uncertain: "default",
};

// ── React component ──

export interface JourneyPlaybackProps {
  /** The full set of enriched segments to play back (from the current filter). */
  filteredSegments: EnrichedSegment[];
  /** Callback to tell the atlas to reveal/hide segments during playback. */
  onVisibleChange?: (visible: EnrichedSegment[], currentSegment: EnrichedSegment | null) => void;
  className?: string;
}

/**
 * Timeline slider with playback controls, embedded in the atlas page.
 *
 * Requirements: 19.1–19.7
 */
export function JourneyPlayback({ filteredSegments, onVisibleChange, className }: JourneyPlaybackProps) {
  const repos = useRepos();
  const { active, segments, position, stepForward, stepBackward, jumpToSession, setPosition, activate, deactivate } =
    usePlaybackStore();

  // Sync segments into the store when the filtered set changes
  useEffect(() => {
    if (active) {
      const sorted = sortForPlayback(filteredSegments);
      // Only update if the ids actually changed to avoid thrashing
      const oldIds = segments.map((s) => s.id).join(",");
      const newIds = sorted.map((s) => s.id).join(",");
      if (oldIds !== newIds) {
        // Re-activate with the new set; reset position
        usePlaybackStore.setState({ segments: sorted, position: -1 });
      }
    }
  }, [active, filteredSegments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent of visible segments whenever position changes
  useEffect(() => {
    if (!active) return;
    const vis = visibleSegments(segments, position);
    const current = position >= 0 && position < segments.length ? segments[position] : null;
    onVisibleChange?.(vis, current);
  }, [active, segments, position, onVisibleChange]);

  // Fetch timeline events for the current segment (Req 19.4)
  const [segmentEvents, setSegmentEvents] = useState<ExtendedTimelineEvent[]>([]);
  const currentSegment = position >= 0 && position < segments.length ? segments[position] : null;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!currentSegment) {
      setSegmentEvents([]);
      return;
    }
    let cancelled = false;
    repos.journeys
      .eventsForSegments([currentSegment.id])
      .then((map) => {
        if (!cancelled && mountedRef.current) {
          setSegmentEvents(map[currentSegment.id] ?? []);
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setSegmentEvents([]);
      });
    return () => { cancelled = true; };
  }, [currentSegment?.id, repos.journeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect unique sessions from the playback segments (for jump-to-session dropdown)
  const uniqueSessions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const seg of segments) {
      const sid = seg.journey.session_id;
      if (sid && !seen.has(sid)) {
        seen.set(sid, seg.journey.name);
      }
    }
    return [...seen.entries()].map(([id, journeyName]) => ({ id, label: journeyName }));
  }, [segments]);

  const noSegments = filteredSegments.length === 0;
  const total = segments.length;

  // Toggle handler
  const handleToggle = useCallback(() => {
    if (active) {
      deactivate();
    } else {
      activate(filteredSegments);
    }
  }, [active, deactivate, activate, filteredSegments]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Toggle + title row */}
      <div className="flex items-center gap-2">
        <Tooltip content={active ? "Exit playback" : "Start playback"}>
          <Button
            size="sm"
            variant={active ? "primary" : "outline"}
            onClick={handleToggle}
            disabled={noSegments && !active}
          >
            {active ? <Pause size={13} /> : <Play size={13} />}
            Playback
          </Button>
        </Tooltip>
        {active && (
          <span className="text-[11px] text-ink-faint">
            {position < 0 ? "Before first segment" : `Segment ${position + 1} of ${total}`}
          </span>
        )}
      </div>

      {/* Disabled state: no segments (Req 19.7) */}
      {active && noSegments && (
        <div className="rounded border border-border bg-bg-panel/60 px-3 py-2 text-[11px] text-ink-faint">
          No segments available for playback. Adjust the filters to include travel segments.
        </div>
      )}

      {/* Slider + controls */}
      {active && total > 0 && (
        <div className="flex flex-col gap-2 rounded border border-border bg-bg-panel/80 px-3 py-2 backdrop-blur">
          {/* Controls row */}
          <div className="flex items-center gap-1.5">
            <Tooltip content="Step backward">
              <Button size="icon" variant="ghost" onClick={stepBackward} disabled={position <= -1} className="h-6 w-6">
                <ChevronLeft size={14} />
              </Button>
            </Tooltip>

            {/* Range slider (Req 19.1) */}
            <input
              type="range"
              min={-1}
              max={total - 1}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-ember"
              aria-label="Playback position"
            />

            <Tooltip content="Step forward">
              <Button
                size="icon"
                variant="ghost"
                onClick={stepForward}
                disabled={position >= total - 1}
                className="h-6 w-6"
              >
                <ChevronRight size={14} />
              </Button>
            </Tooltip>

            {/* Jump to session (Req 19.5) */}
            {uniqueSessions.length > 0 && (
              <Tooltip content="Jump to session">
                <div className="flex items-center gap-1">
                  <SkipForward size={12} className="shrink-0 text-ink-faint" />
                  <Select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) jumpToSession(e.target.value);
                    }}
                    className="h-6 w-32 text-[11px]"
                  >
                    <option value="">Jump to…</option>
                    {uniqueSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </Tooltip>
            )}
          </div>

          {/* Current segment summary */}
          {currentSegment && (
            <div className="border-t border-border pt-2">
              <div className="flex items-center gap-1.5 text-[12px]">
                <Route size={11} className="shrink-0 text-ink-faint" />
                <span className="font-medium text-ink">
                  {currentSegment.origin_name ?? "Unknown origin"}
                </span>
                <ChevronRight size={10} className="shrink-0 text-ink-faint" />
                <span className="font-medium text-ink">
                  {currentSegment.destination_name ?? "Unknown destination"}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <span>{currentSegment.journey.name}</span>
                <Badge tone={CATEGORY_TONE[currentSegment.journey.category]} className="text-[10px]">
                  {JOURNEY_CATEGORY_LABELS[currentSegment.journey.category]}
                </Badge>
                {(() => {
                  const r = dateRange(
                    currentSegment.start_year, currentSegment.start_month, currentSegment.start_day,
                    currentSegment.end_year, currentSegment.end_month, currentSegment.end_day,
                  );
                  return r ? (
                    <span className="flex items-center gap-0.5">
                      <Calendar size={10} /> {r}
                    </span>
                  ) : null;
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Side panel: segment details, travelers, events (Req 19.4) */}
      {active && currentSegment && (
        <PlaybackDetailPanel segment={currentSegment} events={segmentEvents} />
      )}
    </div>
  );
}

// ── Detail panel sub-component ──

function PlaybackDetailPanel({
  segment,
  events,
}: {
  segment: EnrichedSegment;
  events: ExtendedTimelineEvent[];
}) {
  const originLabel = segment.origin_name ?? "Unknown origin";
  const destLabel = segment.destination_name ?? "Unknown destination";
  const range = dateRange(
    segment.start_year, segment.start_month, segment.start_day,
    segment.end_year, segment.end_month, segment.end_day,
  );

  return (
    <div className="rounded border border-border bg-bg-panel p-3 space-y-3 text-[12px]">
      {/* Route */}
      <section>
        <SectionLabel icon={<Route size={11} />} label="Route" />
        <div className="flex items-center gap-1.5">
          <LocationLink entityId={segment.origin_entity_id} name={originLabel} />
          <ChevronRight size={10} className="shrink-0 text-ink-faint" />
          <LocationLink entityId={segment.destination_entity_id} name={destLabel} />
        </div>
      </section>

      {/* Journey info */}
      <section>
        <SectionLabel icon={<MapPin size={11} />} label="Journey" />
        <span className="text-ink">{segment.journey.name}</span>
        {range && <span className="ml-2 text-ink-faint">{range}</span>}
      </section>

      {/* Travelers (Req 19.4) */}
      {segment.participants.length > 0 && (
        <section>
          <SectionLabel icon={<Users size={11} />} label="Travelers" />
          <ul className="space-y-0.5">
            {segment.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
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

      {/* Timeline events (Req 19.4) — omitted if empty per requirement */}
      {events.length > 0 && (
        <section>
          <SectionLabel icon={<Calendar size={11} />} label="Events" />
          <ul className="space-y-0.5">
            {events.map((ev) => (
              <li key={ev.id} className="text-ink-muted">
                <span className="font-medium text-ink">{ev.title}</span>
                {ev.year != null && (
                  <span className="ml-1 text-ink-faint">
                    ({ev.year}{ev.month != null ? `-${String(ev.month).padStart(2, "0")}` : ""}
                    {ev.day != null ? `-${String(ev.day).padStart(2, "0")}` : ""})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notes */}
      {segment.notes && segment.notes.trim() !== "" && (
        <section>
          <SectionLabel icon={<MapPin size={11} />} label="Notes" />
          <p className="whitespace-pre-wrap text-ink-muted">{segment.notes}</p>
        </section>
      )}
    </div>
  );
}

// ── Tiny helpers ──

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h4 className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
      {icon}
      {label}
    </h4>
  );
}

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
