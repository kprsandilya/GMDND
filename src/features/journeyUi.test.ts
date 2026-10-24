import { describe, expect, it } from "vitest";
import type { EnrichedSegment, ExtendedTimelineEvent, Journey } from "@/domain/journeyTypes";
import {
  formatCalendarDate,
  dateRange,
  formatPartialDate,
  formatJourneyDateRange,
  deriveCurrentLocation,
  groupEventsBySession,
  filterSegmentsByMember,
} from "./journeyUtils";

// ── Factories ──

/** Minimal EnrichedSegment stub. Only the fields the helpers inspect are required; the rest are defaults. */
function makeSegment(overrides: Partial<EnrichedSegment> = {}): EnrichedSegment {
  return {
    id: "seg-1",
    journey_id: "j-1",
    origin_entity_id: null,
    destination_entity_id: null,
    waypoints: [],
    start_year: null,
    start_month: null,
    start_day: null,
    end_year: null,
    end_month: null,
    end_day: null,
    sort_order: 0,
    route_certainty: "confirmed",
    notes: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    journey: makeJourney(),
    participants: [],
    origin_name: null,
    destination_name: null,
    origin_coords: null,
    destination_coords: null,
    waypoint_coords: [],
    ...overrides,
  };
}

function makeJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    id: "j-1",
    campaign_id: "c-1",
    party_id: null,
    session_id: null,
    name: "Test Journey",
    category: "campaign",
    description: "",
    dm_notes: "",
    route_certainty: "known",
    start_year: null,
    start_month: null,
    start_day: null,
    end_year: null,
    end_month: null,
    end_day: null,
    sort_order: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ExtendedTimelineEvent> = {}): ExtendedTimelineEvent {
  return {
    id: "ev-1",
    campaign_id: "c-1",
    entity_id: null,
    title: "Test Event",
    body_md: "",
    year: null,
    month: null,
    day: null,
    kind: "general",
    secret: false,
    category: "general",
    session_id: null,
    journey_id: null,
    segment_id: null,
    location_id: null,
    confidence: "certain",
    manual_order: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── formatCalendarDate ──

describe("formatCalendarDate", () => {
  it("returns empty string when year is null", () => {
    expect(formatCalendarDate(null, null, null)).toBe("");
  });

  it("returns year only when month and day are null", () => {
    expect(formatCalendarDate(1347, null, null)).toBe("1347");
  });

  it("returns year-month when only day is null", () => {
    expect(formatCalendarDate(1347, 3, null)).toBe("1347-03");
  });

  it("returns full date when all components are present", () => {
    expect(formatCalendarDate(1347, 3, 15)).toBe("1347-03-15");
  });

  it("zero-pads single-digit months and days", () => {
    expect(formatCalendarDate(1347, 1, 5)).toBe("1347-01-05");
  });

  it("handles month 12 and day 31", () => {
    expect(formatCalendarDate(900, 12, 31)).toBe("900-12-31");
  });
});

// ── dateRange ──

describe("dateRange", () => {
  it("returns null when both start and end are absent", () => {
    expect(dateRange(null, null, null, null, null, null)).toBeNull();
  });

  it("returns 'from <start>' when only start date exists", () => {
    expect(dateRange(1347, 3, 15, null, null, null)).toBe("from 1347-03-15");
  });

  it("returns 'until <end>' when only end date exists", () => {
    expect(dateRange(null, null, null, 1348, 6, null)).toBe("until 1348-06");
  });

  it("returns 'start → end' when both dates exist", () => {
    expect(dateRange(1347, 3, 15, 1348, 6, 1)).toBe("1347-03-15 → 1348-06-01");
  });

  it("handles year-only ranges", () => {
    expect(dateRange(1300, null, null, 1350, null, null)).toBe("1300 → 1350");
  });
});

// ── formatPartialDate ──

describe("formatPartialDate", () => {
  it("returns 'unknown date' when year is null", () => {
    expect(formatPartialDate(null, null, null)).toBe("unknown date");
  });

  it("returns year only when month and day are null", () => {
    expect(formatPartialDate(1347, null, null)).toBe("1347");
  });

  it("returns year/month when only day is null", () => {
    expect(formatPartialDate(1347, 3, null)).toBe("1347/03");
  });

  it("returns full date with slashes when all present", () => {
    expect(formatPartialDate(1347, 3, 15)).toBe("1347/03/15");
  });

  it("zero-pads single-digit months and days", () => {
    expect(formatPartialDate(1347, 1, 5)).toBe("1347/01/05");
  });
});

// ── formatJourneyDateRange ──

describe("formatJourneyDateRange", () => {
  it("returns null when both start and end are absent", () => {
    const j = makeJourney();
    expect(formatJourneyDateRange(j)).toBeNull();
  });

  it("returns 'from <start>' when only start date exists", () => {
    const j = makeJourney({ start_year: 1347, start_month: 3, start_day: 15 });
    expect(formatJourneyDateRange(j)).toBe("from 1347/03/15");
  });

  it("returns 'until <end>' when only end date exists", () => {
    const j = makeJourney({ end_year: 1348, end_month: 6 });
    expect(formatJourneyDateRange(j)).toBe("until 1348/06");
  });

  it("returns 'start — end' when both dates exist", () => {
    const j = makeJourney({
      start_year: 1347, start_month: 3, start_day: 15,
      end_year: 1348, end_month: 6, end_day: 1,
    });
    expect(formatJourneyDateRange(j)).toBe("1347/03/15 — 1348/06/01");
  });
});

// ── deriveCurrentLocation ──

describe("deriveCurrentLocation", () => {
  it("returns null for empty segments array", () => {
    expect(deriveCurrentLocation([])).toBeNull();
  });

  it("returns null when no segment has a destination", () => {
    const segments = [
      makeSegment({ id: "s1", destination_entity_id: null, destination_name: null }),
      makeSegment({ id: "s2", destination_entity_id: null, destination_name: null }),
    ];
    expect(deriveCurrentLocation(segments)).toBeNull();
  });

  it("returns the last segment's destination (segments are date-sorted ascending)", () => {
    const segments = [
      makeSegment({ id: "s1", destination_entity_id: "loc-1", destination_name: "Neverwinter" }),
      makeSegment({ id: "s2", destination_entity_id: "loc-2", destination_name: "Waterdeep" }),
    ];
    expect(deriveCurrentLocation(segments)).toEqual({ id: "loc-2", name: "Waterdeep" });
  });

  it("skips the last segment if it has no destination and falls back", () => {
    const segments = [
      makeSegment({ id: "s1", destination_entity_id: "loc-1", destination_name: "Neverwinter" }),
      makeSegment({ id: "s2", destination_entity_id: null, destination_name: null }),
    ];
    expect(deriveCurrentLocation(segments)).toEqual({ id: "loc-1", name: "Neverwinter" });
  });

  it("returns null when destination_entity_id is set but destination_name is null", () => {
    const segments = [
      makeSegment({ id: "s1", destination_entity_id: "loc-1", destination_name: null }),
    ];
    expect(deriveCurrentLocation(segments)).toBeNull();
  });
});

// ── groupEventsBySession ──

describe("groupEventsBySession", () => {
  it("returns empty array for no events", () => {
    expect(groupEventsBySession([], new Map())).toEqual([]);
  });

  it("groups all events into 'No session' when none have session_id", () => {
    const events = [
      makeEvent({ id: "ev-1", session_id: null }),
      makeEvent({ id: "ev-2", session_id: null }),
    ];
    const result = groupEventsBySession(events, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].sessionLabel).toBe("No session");
    expect(result[0].sessionId).toBeNull();
    expect(result[0].events).toHaveLength(2);
  });

  it("groups events by session and puts 'No session' last", () => {
    const events = [
      makeEvent({ id: "ev-1", session_id: null }),
      makeEvent({ id: "ev-2", session_id: "sess-1" }),
      makeEvent({ id: "ev-3", session_id: "sess-1" }),
      makeEvent({ id: "ev-4", session_id: "sess-2" }),
    ];
    const sessionNames = new Map([
      ["sess-1", "Session 1"],
      ["sess-2", "Session 2"],
    ]);
    const result = groupEventsBySession(events, sessionNames);

    expect(result).toHaveLength(3);
    // Session groups first
    expect(result[0].sessionLabel).toBe("Session 1");
    expect(result[0].events).toHaveLength(2);
    expect(result[1].sessionLabel).toBe("Session 2");
    expect(result[1].events).toHaveLength(1);
    // No session group last
    expect(result[2].sessionLabel).toBe("No session");
    expect(result[2].events).toHaveLength(1);
  });

  it("uses 'Unknown session' when session_id is not in the names map", () => {
    const events = [makeEvent({ id: "ev-1", session_id: "unknown-id" })];
    const result = groupEventsBySession(events, new Map());
    expect(result[0].sessionLabel).toBe("Unknown session");
  });

  it("keeps 'No session' at index 0 if it's the only group", () => {
    const events = [makeEvent({ id: "ev-1", session_id: null })];
    const result = groupEventsBySession(events, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBeNull();
  });
});

// ── filterSegmentsByMember ──

describe("filterSegmentsByMember", () => {
  const segments = [
    makeSegment({
      id: "s1",
      participants: [
        { id: "p1", segment_id: "s1", entity_id: "char-a", role: "traveler", notes: "", created_at: "", entity_name: "Arin" },
      ],
    }),
    makeSegment({
      id: "s2",
      participants: [
        { id: "p2", segment_id: "s2", entity_id: "char-b", role: "traveler", notes: "", created_at: "", entity_name: "Bella" },
      ],
    }),
    makeSegment({
      id: "s3",
      participants: [
        { id: "p3", segment_id: "s3", entity_id: "char-a", role: "guide", notes: "", created_at: "", entity_name: "Arin" },
        { id: "p4", segment_id: "s3", entity_id: "char-b", role: "traveler", notes: "", created_at: "", entity_name: "Bella" },
      ],
    }),
  ];

  it("returns all segments when memberFilter is empty", () => {
    expect(filterSegmentsByMember(segments, "")).toEqual(segments);
  });

  it("filters to segments containing the specified member", () => {
    const result = filterSegmentsByMember(segments, "char-a");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("returns empty array when member is not a participant on any segment", () => {
    expect(filterSegmentsByMember(segments, "char-z")).toEqual([]);
  });

  it("returns all segments when both members share a segment", () => {
    const result = filterSegmentsByMember(segments, "char-b");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["s2", "s3"]);
  });
});
