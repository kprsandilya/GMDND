/**
 * Character route comparison panel for the world atlas overlay.
 *
 * When 2–6 characters are selected in the filter, displays a panel listing:
 * - shared locations (visited by 2+ selected characters)
 * - subset-only locations (visited by exactly 1 selected character)
 * - overlapping sessions (sessions whose journeys involve 2+ selected characters)
 * - "no route data" indicator for characters with no segments
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 */
import { GitCompareArrows, MapPin, Route, Users } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { routeForEntity } from "@/app/routes";
import type { EnrichedSegment } from "@/domain/journeyTypes";
import { cn } from "@/lib/utils";

// ── Fixed comparison palette — 6 distinct colors (Req 20.1) ──

export const COMPARISON_COLORS = [
  "#f97316", // orange
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ef4444", // red
  "#22c55e", // green
  "#eab308", // yellow
] as const;

/** Returns the comparison stroke color for a character by index (0-based). */
export function comparisonColorForIndex(index: number): string {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length]!;
}

/** Returns a map of characterId → comparison color for the currently selected characters. */
export function buildCharacterColorMap(selectedCharacterIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < selectedCharacterIds.length; i++) {
    map.set(selectedCharacterIds[i]!, comparisonColorForIndex(i));
  }
  return map;
}

// ── Location tracking ──

interface LocationInfo {
  id: string;
  name: string;
  /** Set of character IDs that visited this location. */
  visitors: Set<string>;
}

/** Extract all locations (origin, destination, waypoints) from a segment. */
function extractSegmentLocations(seg: EnrichedSegment): { id: string; name: string }[] {
  const locs: { id: string; name: string }[] = [];
  if (seg.origin_entity_id && seg.origin_name) {
    locs.push({ id: seg.origin_entity_id, name: seg.origin_name });
  }
  if (seg.destination_entity_id && seg.destination_name) {
    locs.push({ id: seg.destination_entity_id, name: seg.destination_name });
  }
  // Waypoints with entity_id (name not available on waypoint, skip unnamed)
  for (const wp of seg.waypoints) {
    if (wp.entity_id) {
      locs.push({ id: wp.entity_id, name: wp.entity_id }); // will be replaced if found in names
    }
  }
  return locs;
}

// ── Analysis computation ──

interface ComparisonData {
  /** Locations visited by 2+ selected characters, sorted by visitor count desc then name. */
  sharedLocations: (LocationInfo & { visitorCount: number })[];
  /** Locations visited by exactly 1 selected character, grouped by character. */
  uniqueLocations: Map<string, LocationInfo[]>;
  /** Sessions that appear in journeys involving 2+ selected characters. */
  overlappingSessions: { id: string; name: string; characterIds: string[] }[];
  /** Character IDs from the selection that have zero segments. */
  charactersWithNoData: string[];
  /** Mapping of characterId → color. */
  colorMap: Map<string, string>;
}

function computeComparison(
  segments: EnrichedSegment[],
  selectedCharacterIds: string[],
  characterNames: Record<string, string>,
): ComparisonData {
  const selectedSet = new Set(selectedCharacterIds);
  const colorMap = buildCharacterColorMap(selectedCharacterIds);

  // Track which characters have segments
  const characterHasSegments = new Set<string>();

  // Location → visitors mapping
  const locationMap = new Map<string, LocationInfo>();

  // Session → set of character IDs
  const sessionCharacters = new Map<string, { name: string; characterIds: Set<string> }>();

  // Build per-character segment lists
  for (const seg of segments) {
    // Find which selected characters are participants on this segment
    const participatingCharacters = seg.participants
      .filter((p) => selectedSet.has(p.entity_id))
      .map((p) => p.entity_id);

    if (participatingCharacters.length === 0) continue;

    // Mark characters as having data
    for (const charId of participatingCharacters) {
      characterHasSegments.add(charId);
    }

    // Track locations visited by each participant
    const locs = extractSegmentLocations(seg);
    for (const loc of locs) {
      if (!locationMap.has(loc.id)) {
        locationMap.set(loc.id, { id: loc.id, name: loc.name, visitors: new Set() });
      }
      const info = locationMap.get(loc.id)!;
      // Use a real name if we had a placeholder
      if (info.name === info.id && loc.name !== loc.id) {
        info.name = loc.name;
      }
      for (const charId of participatingCharacters) {
        info.visitors.add(charId);
      }
    }

    // Track sessions
    const sessionId = seg.journey.session_id;
    if (sessionId) {
      if (!sessionCharacters.has(sessionId)) {
        sessionCharacters.set(sessionId, { name: `Session`, characterIds: new Set() });
      }
      const entry = sessionCharacters.get(sessionId)!;
      for (const charId of participatingCharacters) {
        entry.characterIds.add(charId);
      }
    }
  }

  // Partition locations into shared (2+) and unique (1)
  const sharedLocations: (LocationInfo & { visitorCount: number })[] = [];
  const uniqueLocations = new Map<string, LocationInfo[]>();

  for (const loc of locationMap.values()) {
    const selectedVisitors = new Set([...loc.visitors].filter((v) => selectedSet.has(v)));
    if (selectedVisitors.size >= 2) {
      sharedLocations.push({ ...loc, visitors: selectedVisitors, visitorCount: selectedVisitors.size });
    } else if (selectedVisitors.size === 1) {
      const charId = [...selectedVisitors][0]!;
      if (!uniqueLocations.has(charId)) uniqueLocations.set(charId, []);
      uniqueLocations.get(charId)!.push({ ...loc, visitors: selectedVisitors });
    }
  }

  // Sort shared locations by visitor count descending, then name ascending
  sharedLocations.sort((a, b) => b.visitorCount - a.visitorCount || a.name.localeCompare(b.name));

  // Sort unique locations by name
  for (const locs of uniqueLocations.values()) {
    locs.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Filter overlapping sessions (2+ selected characters appear)
  const overlappingSessions: { id: string; name: string; characterIds: string[] }[] = [];
  for (const [id, entry] of sessionCharacters) {
    const selectedInSession = [...entry.characterIds].filter((c) => selectedSet.has(c));
    if (selectedInSession.length >= 2) {
      overlappingSessions.push({ id, name: entry.name, characterIds: selectedInSession });
    }
  }

  // Characters with no segments (Req 20.5)
  const charactersWithNoData = selectedCharacterIds.filter((id) => !characterHasSegments.has(id));

  return { sharedLocations, uniqueLocations, overlappingSessions, charactersWithNoData, colorMap };
}

// ── Props ──

export interface RouteComparisonProps {
  /** Currently filtered/visible enriched segments. */
  segments: EnrichedSegment[];
  /** Character IDs currently selected in the filter (from RouteFilters.characterIds). */
  selectedCharacterIds: string[];
  /** Character name lookup. */
  characterNames: Record<string, string>;
  className?: string;
}

/**
 * Comparison panel rendered on the atlas when 2–6 characters are selected.
 * Shows shared locations, unique locations per character, overlapping sessions,
 * and a "no route data" note for characters without segments.
 *
 * Returns null when fewer than 2 characters are selected (Req 20.4).
 */
export function RouteComparison({ segments, selectedCharacterIds, characterNames, className }: RouteComparisonProps) {
  // Req 20.4: hide panel when fewer than 2 characters are selected
  if (selectedCharacterIds.length < 2) return null;

  const data = useMemo(
    () => computeComparison(segments, selectedCharacterIds, characterNames),
    [segments, selectedCharacterIds, characterNames],
  );

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-bg-elevated/95 shadow-lg",
        "max-h-[50vh] w-72 overflow-y-auto",
        className,
      )}
      role="region"
      aria-label="Route comparison"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-bg-elevated/95 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <GitCompareArrows size={13} className="shrink-0 text-ink-faint" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Route Comparison
          </span>
          <span className="ml-auto rounded-full bg-ember/20 px-1.5 text-[10px] font-semibold text-ember-soft">
            {selectedCharacterIds.length}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* Characters legend with assigned colors */}
        <section>
          <SectionHeading icon={<Users size={11} />} label="Characters" />
          <ul className="space-y-0.5">
            {selectedCharacterIds.map((charId, i) => (
              <li key={charId} className="flex items-center gap-2 text-[12px]">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: comparisonColorForIndex(i) }}
                  aria-hidden
                />
                <Link
                  to={routeForEntity({ id: charId, kind: "pc", parent_id: null })}
                  className="truncate text-ember-soft hover:underline"
                >
                  {characterNames[charId] ?? charId}
                </Link>
                {data.charactersWithNoData.includes(charId) && (
                  <span className="ml-auto shrink-0 text-[10px] italic text-ink-faint">no route data</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Shared locations (Req 20.2, 20.3) */}
        <section>
          <SectionHeading icon={<MapPin size={11} />} label="Shared Locations" />
          {data.sharedLocations.length === 0 ? (
            <p className="text-[11px] italic text-ink-faint">No shared locations found</p>
          ) : (
            <ul className="space-y-1">
              {data.sharedLocations.map((loc) => (
                <li key={loc.id} className="text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <Link
                      to={routeForEntity({ id: loc.id, kind: "location", parent_id: null })}
                      className="truncate text-ember-soft hover:underline"
                    >
                      {loc.name}
                    </Link>
                    <span className="shrink-0 text-[10px] text-ink-faint">
                      ({loc.visitorCount} characters)
                    </span>
                  </div>
                  {/* Visitor color dots */}
                  <div className="mt-0.5 flex gap-1">
                    {selectedCharacterIds
                      .filter((id) => loc.visitors.has(id))
                      .map((id, i) => (
                        <span
                          key={id}
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: data.colorMap.get(id) }}
                          title={characterNames[id] ?? id}
                          aria-label={characterNames[id] ?? id}
                        />
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Unique locations per character */}
        <section>
          <SectionHeading icon={<Route size={11} />} label="Unique Locations" />
          {data.uniqueLocations.size === 0 ? (
            <p className="text-[11px] italic text-ink-faint">No unique locations</p>
          ) : (
            <div className="space-y-2">
              {selectedCharacterIds
                .filter((id) => data.uniqueLocations.has(id))
                .map((charId) => {
                  const locs = data.uniqueLocations.get(charId)!;
                  return (
                    <div key={charId}>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: data.colorMap.get(charId) }}
                          aria-hidden
                        />
                        {characterNames[charId] ?? charId}
                      </div>
                      <ul className="ml-4 mt-0.5 space-y-0.5">
                        {locs.map((loc) => (
                          <li key={loc.id}>
                            <Link
                              to={routeForEntity({ id: loc.id, kind: "location", parent_id: null })}
                              className="text-[11px] text-ember-soft hover:underline"
                            >
                              {loc.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* Overlapping sessions (Req 20.3) */}
        <section>
          <SectionHeading icon={<Users size={11} />} label="Overlapping Sessions" />
          {data.overlappingSessions.length === 0 ? (
            <p className="text-[11px] italic text-ink-faint">No overlapping sessions</p>
          ) : (
            <ul className="space-y-1">
              {data.overlappingSessions.map((sess) => (
                <li key={sess.id} className="text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <Link
                      to={routeForEntity({ id: sess.id, kind: "session", parent_id: null })}
                      className="truncate text-ember-soft hover:underline"
                    >
                      {sess.name}
                    </Link>
                  </div>
                  <div className="mt-0.5 flex gap-1">
                    {sess.characterIds.map((id) => (
                      <span
                        key={id}
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: data.colorMap.get(id) }}
                        title={characterNames[id] ?? id}
                        aria-label={characterNames[id] ?? id}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
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
