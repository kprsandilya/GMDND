/**
 * Unit tests for JourneyPlayback pure logic and RouteComparison utility functions.
 *
 * Tests cover:
 *  - sortForPlayback ordering (Req 19.6)
 *  - visibleSegments progressive reveal (Req 19.2, 19.3)
 *  - usePlaybackStore zustand state management (Req 19.1–19.7)
 *  - buildCharacterColorMap / comparisonColorForIndex (Req 20.1, 20.3)
 */
import { afterEach, describe, expect, it } from "vitest";
import type { EnrichedSegment, Journey } from "@/domain/journeyTypes";
import { sortForPlayback, visibleSegments, usePlaybackStore } from "./JourneyPlayback";
import { buildCharacterColorMap, comparisonColorForIndex, COMPARISON_COLORS } from "./RouteComparison";

// ── Factories ──

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

// ── sortForPlayback (Req 19.6) ──

describe("sortForPlayback", () => {
  it("returns empty array for empty input", () => {
    expect(sortForPlayback([])).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const segments = [
      makeSegment({ id: "b", journey: makeJourney({ start_year: 1400 }) }),
      makeSegment({ id: "a", journey: makeJourney({ start_year: 1300 }) }),
    ];
    const copy = [...segments];
    sortForPlayback(segments);
    expect(segments.map((s) => s.id)).toEqual(copy.map((s) => s.id));
  });

  it("sorts by journey start_year ascending", () => {
    const segments = [
      makeSegment({ id: "late", journey: makeJourney({ id: "j2", start_year: 1400 }) }),
      makeSegment({ id: "early", journey: makeJourney({ id: "j1", start_year: 1300 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["early", "late"]);
  });

  it("sorts by journey start_month when years are equal", () => {
    const segments = [
      makeSegment({ id: "oct", journey: makeJourney({ id: "j2", start_year: 1300, start_month: 10 }) }),
      makeSegment({ id: "mar", journey: makeJourney({ id: "j1", start_year: 1300, start_month: 3 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["mar", "oct"]);
  });

  it("sorts by journey start_day when year and month are equal", () => {
    const segments = [
      makeSegment({ id: "d20", journey: makeJourney({ id: "j2", start_year: 1300, start_month: 3, start_day: 20 }) }),
      makeSegment({ id: "d5", journey: makeJourney({ id: "j1", start_year: 1300, start_month: 3, start_day: 5 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["d5", "d20"]);
  });

  it("places undated journeys after dated ones", () => {
    const segments = [
      makeSegment({ id: "undated", journey: makeJourney({ id: "j1", start_year: null }) }),
      makeSegment({ id: "dated", journey: makeJourney({ id: "j2", start_year: 1300 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["dated", "undated"]);
  });

  it("uses journey sort_order as tiebreaker when dates are equal", () => {
    const segments = [
      makeSegment({ id: "high", journey: makeJourney({ id: "j2", start_year: 1300, sort_order: 5 }) }),
      makeSegment({ id: "low", journey: makeJourney({ id: "j1", start_year: 1300, sort_order: 1 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["low", "high"]);
  });

  it("uses segment sort_order within the same journey", () => {
    const journey = makeJourney({ id: "j1", start_year: 1300 });
    const segments = [
      makeSegment({ id: "seg-2", sort_order: 2, journey }),
      makeSegment({ id: "seg-0", sort_order: 0, journey }),
      makeSegment({ id: "seg-1", sort_order: 1, journey }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["seg-0", "seg-1", "seg-2"]);
  });

  it("falls back to created_at for fully equal ordering keys", () => {
    const journey = makeJourney({ id: "j1" });
    const segments = [
      makeSegment({ id: "newer", sort_order: 0, created_at: "2024-06-01T00:00:00Z", journey }),
      makeSegment({ id: "older", sort_order: 0, created_at: "2024-01-01T00:00:00Z", journey }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["older", "newer"]);
  });

  it("handles mixed dated and undated journeys with sort_order tiebreaker", () => {
    const segments = [
      makeSegment({ id: "undated-low", journey: makeJourney({ id: "j3", sort_order: 1 }) }),
      makeSegment({ id: "undated-high", journey: makeJourney({ id: "j4", sort_order: 5 }) }),
      makeSegment({ id: "dated", journey: makeJourney({ id: "j1", start_year: 1300, sort_order: 0 }) }),
    ];
    const sorted = sortForPlayback(segments);
    expect(sorted.map((s) => s.id)).toEqual(["dated", "undated-low", "undated-high"]);
  });
});

// ── visibleSegments (Req 19.2, 19.3) ──

describe("visibleSegments", () => {
  const segs = [
    makeSegment({ id: "a" }),
    makeSegment({ id: "b" }),
    makeSegment({ id: "c" }),
    makeSegment({ id: "d" }),
  ];

  it("returns empty array when position is -1", () => {
    expect(visibleSegments(segs, -1)).toEqual([]);
  });

  it("returns first segment only when position is 0", () => {
    const result = visibleSegments(segs, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });

  it("returns first two segments when position is 1", () => {
    const result = visibleSegments(segs, 1);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("returns all segments when position is n-1", () => {
    const result = visibleSegments(segs, segs.length - 1);
    expect(result).toHaveLength(4);
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns empty array for negative positions below -1", () => {
    expect(visibleSegments(segs, -5)).toEqual([]);
  });

  it("returns empty array for empty segments regardless of position", () => {
    expect(visibleSegments([], 0)).toEqual([]);
    expect(visibleSegments([], 5)).toEqual([]);
  });

  it("handles position beyond array length (returns all segments)", () => {
    const result = visibleSegments(segs, 100);
    expect(result).toHaveLength(4);
  });
});

// ── usePlaybackStore (Req 19.1–19.7) ──

describe("usePlaybackStore", () => {
  afterEach(() => {
    // Reset the store between tests
    usePlaybackStore.setState({ active: false, segments: [], position: -1 });
  });

  describe("initial state", () => {
    it("starts inactive with empty segments and position -1", () => {
      const state = usePlaybackStore.getState();
      expect(state.active).toBe(false);
      expect(state.segments).toEqual([]);
      expect(state.position).toBe(-1);
    });
  });

  describe("activate / deactivate", () => {
    it("activates with sorted segments and resets position to -1", () => {
      const segments = [
        makeSegment({ id: "b", journey: makeJourney({ id: "j2", start_year: 1400 }) }),
        makeSegment({ id: "a", journey: makeJourney({ id: "j1", start_year: 1300 }) }),
      ];

      usePlaybackStore.getState().activate(segments);
      const state = usePlaybackStore.getState();

      expect(state.active).toBe(true);
      expect(state.position).toBe(-1);
      // Segments should be sorted by playback order
      expect(state.segments.map((s) => s.id)).toEqual(["a", "b"]);
    });

    it("deactivate resets all state", () => {
      const segments = [makeSegment({ id: "a" })];
      usePlaybackStore.getState().activate(segments);
      usePlaybackStore.getState().setPosition(0);

      usePlaybackStore.getState().deactivate();
      const state = usePlaybackStore.getState();

      expect(state.active).toBe(false);
      expect(state.segments).toEqual([]);
      expect(state.position).toBe(-1);
    });
  });

  describe("stepForward / stepBackward", () => {
    it("stepForward increments position", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "a" }),
        makeSegment({ id: "b" }),
      ]);

      usePlaybackStore.getState().stepForward();
      expect(usePlaybackStore.getState().position).toBe(0);

      usePlaybackStore.getState().stepForward();
      expect(usePlaybackStore.getState().position).toBe(1);
    });

    it("stepForward does not exceed max position", () => {
      usePlaybackStore.getState().activate([makeSegment({ id: "a" })]);
      usePlaybackStore.getState().stepForward(); // position 0
      usePlaybackStore.getState().stepForward(); // should stay at 0

      expect(usePlaybackStore.getState().position).toBe(0);
    });

    it("stepBackward decrements position", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "a" }),
        makeSegment({ id: "b" }),
      ]);
      usePlaybackStore.getState().setPosition(1);

      usePlaybackStore.getState().stepBackward();
      expect(usePlaybackStore.getState().position).toBe(0);

      usePlaybackStore.getState().stepBackward();
      expect(usePlaybackStore.getState().position).toBe(-1);
    });

    it("stepBackward does not go below -1", () => {
      usePlaybackStore.getState().activate([makeSegment({ id: "a" })]);
      // position starts at -1
      usePlaybackStore.getState().stepBackward();

      expect(usePlaybackStore.getState().position).toBe(-1);
    });
  });

  describe("setPosition", () => {
    it("sets position to a valid index", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "a" }),
        makeSegment({ id: "b" }),
        makeSegment({ id: "c" }),
      ]);

      usePlaybackStore.getState().setPosition(1);
      expect(usePlaybackStore.getState().position).toBe(1);
    });

    it("clamps position to -1 as minimum", () => {
      usePlaybackStore.getState().activate([makeSegment({ id: "a" })]);
      usePlaybackStore.getState().setPosition(-10);

      expect(usePlaybackStore.getState().position).toBe(-1);
    });

    it("clamps position to max index", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "a" }),
        makeSegment({ id: "b" }),
      ]);
      usePlaybackStore.getState().setPosition(100);

      expect(usePlaybackStore.getState().position).toBe(1);
    });
  });

  describe("jumpToSession", () => {
    it("jumps to the first segment whose journey matches the session id", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "s1", journey: makeJourney({ id: "j1", session_id: "sess-A" }) }),
        makeSegment({ id: "s2", journey: makeJourney({ id: "j2", session_id: "sess-B" }) }),
        makeSegment({ id: "s3", journey: makeJourney({ id: "j3", session_id: "sess-A" }) }),
      ]);

      usePlaybackStore.getState().jumpToSession("sess-B");
      expect(usePlaybackStore.getState().position).toBe(1);
    });

    it("does not change position when session is not found", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "s1", journey: makeJourney({ session_id: "sess-A" }) }),
      ]);
      usePlaybackStore.getState().setPosition(0);

      usePlaybackStore.getState().jumpToSession("sess-Z");
      expect(usePlaybackStore.getState().position).toBe(0);
    });

    it("jumps to the first matching segment when multiple match", () => {
      usePlaybackStore.getState().activate([
        makeSegment({ id: "s1", journey: makeJourney({ id: "j1", session_id: "sess-A" }) }),
        makeSegment({ id: "s2", journey: makeJourney({ id: "j2", session_id: "sess-X" }) }),
        makeSegment({ id: "s3", journey: makeJourney({ id: "j3", session_id: "sess-X" }) }),
      ]);

      usePlaybackStore.getState().jumpToSession("sess-X");
      expect(usePlaybackStore.getState().position).toBe(1);
    });
  });
});

// ── comparisonColorForIndex (Req 20.1) ──

describe("comparisonColorForIndex", () => {
  it("returns distinct colors for indices 0–5", () => {
    const colors = Array.from({ length: 6 }, (_, i) => comparisonColorForIndex(i));
    expect(new Set(colors).size).toBe(6);
  });

  it("wraps around at 6 (index 6 === index 0)", () => {
    expect(comparisonColorForIndex(6)).toBe(comparisonColorForIndex(0));
    expect(comparisonColorForIndex(7)).toBe(comparisonColorForIndex(1));
  });

  it("returns a string color value for each index", () => {
    for (let i = 0; i < 6; i++) {
      const color = comparisonColorForIndex(i);
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });

  it("matches COMPARISON_COLORS array order", () => {
    for (let i = 0; i < COMPARISON_COLORS.length; i++) {
      expect(comparisonColorForIndex(i)).toBe(COMPARISON_COLORS[i]);
    }
  });
});

// ── buildCharacterColorMap (Req 20.1, 20.3) ──

describe("buildCharacterColorMap", () => {
  it("returns empty map for no character IDs", () => {
    const map = buildCharacterColorMap([]);
    expect(map.size).toBe(0);
  });

  it("assigns unique colors to each character", () => {
    const ids = ["char-a", "char-b", "char-c"];
    const map = buildCharacterColorMap(ids);

    expect(map.size).toBe(3);
    const colors = [...map.values()];
    expect(new Set(colors).size).toBe(3);
  });

  it("assigns colors matching comparisonColorForIndex order", () => {
    const ids = ["char-a", "char-b"];
    const map = buildCharacterColorMap(ids);

    expect(map.get("char-a")).toBe(comparisonColorForIndex(0));
    expect(map.get("char-b")).toBe(comparisonColorForIndex(1));
  });

  it("handles more than 6 characters by wrapping colors", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `char-${i}`);
    const map = buildCharacterColorMap(ids);

    expect(map.size).toBe(8);
    // Characters 0 and 6 get the same color (wrap around)
    expect(map.get("char-0")).toBe(map.get("char-6"));
    expect(map.get("char-1")).toBe(map.get("char-7"));
  });

  it("maps each character ID correctly", () => {
    const ids = ["alice", "bob"];
    const map = buildCharacterColorMap(ids);

    expect(map.has("alice")).toBe(true);
    expect(map.has("bob")).toBe(true);
    expect(map.has("charlie")).toBe(false);
  });
});

// ── COMPARISON_COLORS ──

describe("COMPARISON_COLORS", () => {
  it("contains exactly 6 colors", () => {
    expect(COMPARISON_COLORS).toHaveLength(6);
  });

  it("all colors are non-empty strings", () => {
    for (const color of COMPARISON_COLORS) {
      expect(typeof color).toBe("string");
      expect(color.length).toBeGreaterThan(0);
    }
  });

  it("all 6 colors are distinct", () => {
    expect(new Set(COMPARISON_COLORS).size).toBe(6);
  });
});
