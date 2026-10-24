/**
 * Unit tests for RouteOverlay: ROUTE_STYLES, renderRouteOverlay, and clearRouteOverlay.
 *
 * These tests use a minimal JSDOM-like mock to simulate SVG elements in a pure node environment.
 * The RouteLegend React component is tested indirectly via its logic (category collection).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EnrichedSegment, Journey, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORIES } from "@/domain/journeyTypes";
import { ROUTE_STYLES, renderRouteOverlay, clearRouteOverlay } from "./RouteOverlay";

// ── Minimal SVG DOM mock ──

interface MockElement {
  tag: string;
  attrs: Record<string, string>;
  textContent: string;
  children: MockElement[];
  listeners: Record<string, Function[]>;
  ownerDocument: MockDocument;
  remove: () => void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(event: string, handler: Function): void;
  appendChild(child: MockElement): MockElement;
  querySelectorAll(selector: string): MockElement[];
}

interface MockDocument {
  createElementNS(ns: string, tag: string): MockElement;
}

function createMockElement(tag: string, doc: MockDocument): MockElement {
  const el: MockElement = {
    tag,
    attrs: {},
    textContent: "",
    children: [],
    listeners: {},
    ownerDocument: doc,
    remove() {
      // No-op for mock; parent tracking not needed for tests
    },
    setAttribute(name: string, value: string) {
      el.attrs[name] = value;
    },
    getAttribute(name: string) {
      return el.attrs[name] ?? null;
    },
    addEventListener(event: string, handler: Function) {
      if (!el.listeners[event]) el.listeners[event] = [];
      el.listeners[event]!.push(handler);
    },
    appendChild(child: MockElement) {
      el.children.push(child);
      return child;
    },
    querySelectorAll(selector: string) {
      // Simple attribute selector: [data-route]
      if (selector === "[data-route]") {
        return el.children.filter((c) => "data-route" in c.attrs);
      }
      return [];
    },
  };
  return el;
}

function createMockSvgGroup(): MockElement {
  const doc: MockDocument = {
    createElementNS(_ns: string, tag: string) {
      return createMockElement(tag, doc);
    },
  };
  return createMockElement("g", doc);
}

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

// ── ROUTE_STYLES ──

describe("ROUTE_STYLES", () => {
  it("defines a style for every journey category", () => {
    for (const cat of JOURNEY_CATEGORIES) {
      expect(ROUTE_STYLES[cat]).toBeDefined();
      expect(ROUTE_STYLES[cat].color).toBeTruthy();
      expect(typeof ROUTE_STYLES[cat].dashArray).toBe("string");
    }
  });

  it("gives each category a unique color", () => {
    const colors = Object.values(ROUTE_STYLES).map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("has no two categories sharing both the same color AND dash pattern", () => {
    const combos = Object.values(ROUTE_STYLES).map((s) => `${s.color}|${s.dashArray}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("uses solid line (empty dashArray) for campaign and party", () => {
    expect(ROUTE_STYLES.campaign.dashArray).toBe("");
    expect(ROUTE_STYLES.party.dashArray).toBe("");
  });

  it("uses dashed line for backstory", () => {
    expect(ROUTE_STYLES.backstory.dashArray).toBeTruthy();
    // The design specifies "12,6"
    expect(ROUTE_STYLES.backstory.dashArray).toBe("12,6");
  });

  it("uses dotted line for uncertain", () => {
    expect(ROUTE_STYLES.uncertain.dashArray).toBe("3,3");
  });

  it("uses dash-dot for flashback", () => {
    expect(ROUTE_STYLES.flashback.dashArray).toBe("8,4,2,4");
  });
});

// ── renderRouteOverlay ──

describe("renderRouteOverlay", () => {
  let svgGroup: MockElement;
  let onClick: (segmentId: string) => void;

  beforeEach(() => {
    svgGroup = createMockSvgGroup();
    onClick = vi.fn() as unknown as (segmentId: string) => void;
  });

  it("renders nothing and returns empty arrays for an empty segments list", () => {
    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [], onClick);
    expect(svgGroup.children).toHaveLength(0);
    expect(result.unmappedSegments).toHaveLength(0);
    expect(result.partialSegments).toHaveLength(0);
  });

  it("renders two polylines + endpoint dots for a segment with origin and destination coords", () => {
    const seg = makeSegment({
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: { x: 100, y: 200 },
      destination_coords: { x: 300, y: 400 },
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    // Should have: 1 hit polyline + 1 visible polyline + 2 endpoint dots = 4 elements
    const polylines = svgGroup.children.filter((c) => c.tag === "polyline");
    const circles = svgGroup.children.filter((c) => c.tag === "circle");

    expect(polylines).toHaveLength(2);
    expect(circles).toHaveLength(2);
    expect(result.unmappedSegments).toHaveLength(0);
    expect(result.partialSegments).toHaveLength(0);
  });

  it("sets correct attributes on the hit-area polyline", () => {
    const seg = makeSegment({
      id: "seg-42",
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const hit = svgGroup.children.find((c) => c.tag === "polyline" && c.attrs["stroke"] === "transparent");
    expect(hit).toBeDefined();
    expect(hit!.attrs["stroke-width"]).toBe("8");
    expect(hit!.attrs["pointer-events"]).toBe("stroke");
    expect(hit!.attrs["data-route-id"]).toBe("seg-42");
    expect(hit!.attrs["data-route"]).toBe("");
    expect(hit!.attrs["points"]).toBe("10,20 30,40");
  });

  it("sets correct attributes on the visible polyline", () => {
    const seg = makeSegment({
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
      journey: makeJourney({ category: "backstory" }),
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const visible = svgGroup.children.find(
      (c) => c.tag === "polyline" && c.attrs["stroke"] !== "transparent",
    );
    expect(visible).toBeDefined();
    expect(visible!.attrs["stroke"]).toBe(ROUTE_STYLES.backstory.color);
    expect(visible!.attrs["stroke-width"]).toBe("2.5");
    expect(visible!.attrs["pointer-events"]).toBe("none");
    expect(visible!.attrs["stroke-dasharray"]).toBe("12,6");
    expect(visible!.attrs["data-route"]).toBe("");
  });

  it("does not set stroke-dasharray on solid-line categories", () => {
    const seg = makeSegment({
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
      journey: makeJourney({ category: "campaign" }),
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const visible = svgGroup.children.find(
      (c) => c.tag === "polyline" && c.attrs["stroke"] !== "transparent",
    );
    expect(visible).toBeDefined();
    expect(visible!.attrs["stroke-dasharray"]).toBeUndefined();
  });

  it("includes waypoint coordinates in the polyline points", () => {
    const seg = makeSegment({
      origin_coords: { x: 0, y: 0 },
      destination_coords: { x: 100, y: 100 },
      waypoint_coords: [{ x: 30, y: 40 }, { x: 60, y: 70 }],
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const hit = svgGroup.children.find((c) => c.tag === "polyline" && c.attrs["stroke"] === "transparent");
    expect(hit!.attrs["points"]).toBe("0,0 30,40 60,70 100,100");
  });

  it("skips null waypoint coordinates in the polyline points", () => {
    const seg = makeSegment({
      origin_coords: { x: 0, y: 0 },
      destination_coords: { x: 100, y: 100 },
      waypoint_coords: [{ x: 30, y: 40 }, null, { x: 60, y: 70 }],
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const hit = svgGroup.children.find((c) => c.tag === "polyline" && c.attrs["stroke"] === "transparent");
    expect(hit!.attrs["points"]).toBe("0,0 30,40 60,70 100,100");
  });

  it("reports fully unmapped segments (both endpoints null, no waypoints)", () => {
    const seg = makeSegment({
      id: "unmapped-seg",
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: null,
      destination_coords: null,
      waypoint_coords: [],
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    expect(result.unmappedSegments).toHaveLength(1);
    expect(result.unmappedSegments[0]!.id).toBe("unmapped-seg");
    // No polylines should be rendered
    const polylines = svgGroup.children.filter((c) => c.tag === "polyline");
    expect(polylines).toHaveLength(0);
  });

  it("renders a marker and label for a segment with exactly one mapped point", () => {
    const seg = makeSegment({
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: { x: 50, y: 60 },
      destination_coords: null,
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    // Should render a circle marker + text label, no polylines
    const polylines = svgGroup.children.filter((c) => c.tag === "polyline");
    const circles = svgGroup.children.filter((c) => c.tag === "circle");
    const texts = svgGroup.children.filter((c) => c.tag === "text");

    expect(polylines).toHaveLength(0);
    expect(circles).toHaveLength(1);
    expect(circles[0]!.attrs["cx"]).toBe("50");
    expect(circles[0]!.attrs["cy"]).toBe("60");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.textContent).toBe("(unmapped)");
    expect(result.partialSegments).toHaveLength(1);
  });

  it("reports partially unmapped segments and adds warning labels", () => {
    const seg = makeSegment({
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: null,              // origin unmapped
      destination_coords: { x: 50, y: 60 },
      waypoint_coords: [{ x: 30, y: 40 }],
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    expect(result.partialSegments).toHaveLength(1);
    // Should have polylines (2 points: waypoint + destination) + warning label
    const polylines = svgGroup.children.filter((c) => c.tag === "polyline");
    expect(polylines).toHaveLength(2); // hit + visible

    const texts = svgGroup.children.filter((c) => c.tag === "text");
    expect(texts.some((t) => t.textContent.includes("unmapped origin"))).toBe(true);
  });

  it("adds destination warning label for unmapped destination", () => {
    const seg = makeSegment({
      origin_entity_id: "loc-1",
      destination_entity_id: "loc-2",
      origin_coords: { x: 10, y: 20 },
      destination_coords: null,          // destination unmapped
      waypoint_coords: [{ x: 30, y: 40 }],
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    expect(result.partialSegments).toHaveLength(1);
    const texts = svgGroup.children.filter((c) => c.tag === "text");
    expect(texts.some((t) => t.textContent.includes("unmapped destination"))).toBe(true);
  });

  it("calls onSegmentClick when the hit-area polyline is clicked", () => {
    const seg = makeSegment({
      id: "click-seg",
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    const hit = svgGroup.children.find((c) => c.tag === "polyline" && c.attrs["stroke"] === "transparent");
    expect(hit).toBeDefined();
    expect(hit!.listeners["click"]).toHaveLength(1);

    // Simulate click
    const mockEvent = { stopPropagation: vi.fn() };
    hit!.listeners["click"]![0]!(mockEvent);
    expect(onClick).toHaveBeenCalledWith("click-seg");
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });

  it("clears previous route elements before rendering new ones", () => {
    const seg1 = makeSegment({
      id: "seg-1",
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg1], onClick);
    const firstChildCount = svgGroup.children.length;
    expect(firstChildCount).toBeGreaterThan(0);

    // Track remove calls on existing children
    const removeCalls: string[] = [];
    for (const child of svgGroup.children) {
      const original = child.remove;
      child.remove = () => {
        removeCalls.push(child.tag);
        original.call(child);
      };
    }

    // Render again — should call remove on all route elements first
    const seg2 = makeSegment({
      id: "seg-2",
      origin_coords: { x: 50, y: 60 },
      destination_coords: { x: 70, y: 80 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg2], onClick);

    // All previous elements should have been removed
    expect(removeCalls.length).toBe(firstChildCount);
  });

  it("renders multiple segments with different categories", () => {
    const segments = [
      makeSegment({
        id: "seg-a",
        origin_coords: { x: 0, y: 0 },
        destination_coords: { x: 100, y: 100 },
        journey: makeJourney({ category: "campaign" }),
      }),
      makeSegment({
        id: "seg-b",
        origin_coords: { x: 200, y: 200 },
        destination_coords: { x: 300, y: 300 },
        journey: makeJourney({ category: "backstory" }),
      }),
    ];

    renderRouteOverlay(svgGroup as unknown as SVGGElement, segments, onClick);

    const visiblePolylines = svgGroup.children.filter(
      (c) => c.tag === "polyline" && c.attrs["stroke"] !== "transparent",
    );
    expect(visiblePolylines).toHaveLength(2);

    const colors = visiblePolylines.map((p) => p.attrs["stroke"]);
    expect(colors).toContain(ROUTE_STYLES.campaign.color);
    expect(colors).toContain(ROUTE_STYLES.backstory.color);
  });

  it("does not render polylines for segments without entity ids (no unmapped tracking)", () => {
    // Both origin and destination are null (no entity referenced), no waypoints
    const seg = makeSegment({
      origin_entity_id: null,
      destination_entity_id: null,
      origin_coords: null,
      destination_coords: null,
      waypoint_coords: [],
    });

    const result = renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    // No polylines, no circles, no labels — but also not in unmappedSegments
    // (since no entity was even referenced, originMissing/destinationMissing are false)
    const polylines = svgGroup.children.filter((c) => c.tag === "polyline");
    expect(polylines).toHaveLength(0);
    // Still ends up as unmapped because points.length < 1
    expect(result.unmappedSegments).toHaveLength(1);
  });

  it("tags all rendered elements with data-route attribute", () => {
    const seg = makeSegment({
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], onClick);

    for (const child of svgGroup.children) {
      expect(child.attrs["data-route"]).toBe("");
    }
  });
});

// ── clearRouteOverlay ──

describe("clearRouteOverlay", () => {
  it("removes all route-tagged elements from the group", () => {
    const svgGroup = createMockSvgGroup();
    const seg = makeSegment({
      origin_coords: { x: 10, y: 20 },
      destination_coords: { x: 30, y: 40 },
    });

    renderRouteOverlay(svgGroup as unknown as SVGGElement, [seg], vi.fn());
    expect(svgGroup.children.length).toBeGreaterThan(0);

    // Track remove calls
    let removed = 0;
    for (const child of svgGroup.children) {
      const orig = child.remove;
      child.remove = () => { removed++; orig.call(child); };
    }

    clearRouteOverlay(svgGroup as unknown as SVGGElement);
    expect(removed).toBe(svgGroup.children.length);
  });
});

// ── Category style coverage (Req 9.4) ──

describe("category style distinctiveness (Req 9.4)", () => {
  const solidCategories = (Object.entries(ROUTE_STYLES) as [JourneyCategory, { color: string; dashArray: string }][])
    .filter(([, s]) => s.dashArray === "");
  const dashedCategories = (Object.entries(ROUTE_STYLES) as [JourneyCategory, { color: string; dashArray: string }][])
    .filter(([, s]) => s.dashArray !== "");

  it("solid-line categories all have distinct colors", () => {
    const colors = solidCategories.map(([, s]) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("dashed-line categories all have distinct dash patterns", () => {
    const patterns = dashedCategories.map(([, s]) => s.dashArray);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("campaign and party use solid lines", () => {
    expect(ROUTE_STYLES.campaign.dashArray).toBe("");
    expect(ROUTE_STYLES.party.dashArray).toBe("");
  });

  it("backstory uses dashed lines", () => {
    expect(ROUTE_STYLES.backstory.dashArray).not.toBe("");
  });

  it("uncertain uses dotted lines", () => {
    expect(ROUTE_STYLES.uncertain.dashArray).not.toBe("");
  });

  it("flashback uses dash-dot lines", () => {
    expect(ROUTE_STYLES.flashback.dashArray).not.toBe("");
  });

  it("individual and npc use solid lines with separate colors", () => {
    expect(ROUTE_STYLES.individual.dashArray).toBe("");
    expect(ROUTE_STYLES.npc.dashArray).toBe("");
    expect(ROUTE_STYLES.individual.color).not.toBe(ROUTE_STYLES.npc.color);
  });
});
