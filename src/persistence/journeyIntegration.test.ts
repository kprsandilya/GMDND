import { describe, expect, it, beforeEach } from "vitest";
import { NodeSqlDriver } from "./nodeDriver";
import { migrate } from "./migrations";
import { EntityRepository } from "./repositories/entities";
import { TimelineRepository } from "./repositories/misc";
import { JourneyRepository } from "./repositories/journeys";
import type { Entity } from "@/domain/types";
import type { JourneyInput, SegmentInput, Journey } from "@/domain/journeyTypes";

/**
 * Integration tests for the data contracts consumed by SessionTravelTab,
 * JourneyEditor, and VisitHistorySection UI components.
 *
 * Validates: Requirements 12.6, 14.1, 21.4
 */

let driver: NodeSqlDriver;
let entities: EntityRepository;
let timeline: TimelineRepository;
let journeys: JourneyRepository;
let campaign: Entity;

beforeEach(async () => {
  driver = new NodeSqlDriver();
  await migrate(driver);
  entities = new EntityRepository(driver);
  timeline = new TimelineRepository(driver);
  journeys = new JourneyRepository(driver);

  campaign = await entities.create({ kind: "campaign", name: "Test Campaign" });
});

// ── Helpers ──

function journeyInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    campaign_id: campaign.id,
    name: "March to Neverwinter",
    category: "campaign",
    route_certainty: "known",
    party_id: null,
    session_id: null,
    description: "",
    dm_notes: "",
    start_year: null,
    start_month: null,
    start_day: null,
    end_year: null,
    end_month: null,
    end_day: null,
    sort_order: 0,
    ...overrides,
  };
}

async function createLocation(name: string) {
  return entities.create({ kind: "location", name, campaign_id: campaign.id });
}

async function createPC(name: string) {
  return entities.create({ kind: "pc", name, campaign_id: campaign.id });
}

async function createSession(name: string, sortOrder = 0) {
  return entities.create({ kind: "session", name, campaign_id: campaign.id, sort_order: sortOrder });
}

async function createParty(name: string) {
  return entities.create({ kind: "party", name, campaign_id: campaign.id });
}

// ── 1. sessionTravelSummary tests (Req 12.6) ──

describe("sessionTravelSummary", () => {
  it("returns empty array for a session with no travel", async () => {
    const session = await createSession("Empty Session");

    const summary = await journeys.sessionTravelSummary(session.id);

    expect(summary).toEqual([]);
  });

  it("returns journeys grouped with their segments for a session", async () => {
    const session = await createSession("Session 1");
    const originLoc = await createLocation("Waterdeep");
    const destLoc = await createLocation("Neverwinter");

    const journey = await journeys.createJourney(
      journeyInput({ session_id: session.id, name: "Northern Road" }),
    );
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: originLoc.id,
      destination_entity_id: destLoc.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const summary = await journeys.sessionTravelSummary(session.id);

    expect(summary).toHaveLength(1);
    expect(summary[0]!.journey.id).toBe(journey.id);
    expect(summary[0]!.journey.name).toBe("Northern Road");
    expect(summary[0]!.segments).toHaveLength(1);
    expect(summary[0]!.segments[0]!.origin_name).toBe("Waterdeep");
    expect(summary[0]!.segments[0]!.destination_name).toBe("Neverwinter");
  });

  it("groups multiple journeys separately for the same session (party splits)", async () => {
    const session = await createSession("Split Session");

    const j1 = await journeys.createJourney(
      journeyInput({ session_id: session.id, name: "Main Party" }),
    );
    const j2 = await journeys.createJourney(
      journeyInput({ session_id: session.id, name: "Scout Group" }),
    );

    await journeys.createSegment({
      journey_id: j1.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    await journeys.createSegment({
      journey_id: j2.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const summary = await journeys.sessionTravelSummary(session.id);

    expect(summary).toHaveLength(2);
    const names = summary.map((g) => g.journey.name).sort();
    expect(names).toEqual(["Main Party", "Scout Group"]);
  });

  it("returns segments ordered by sort_order within each journey", async () => {
    const session = await createSession("Ordered Session");
    const loc1 = await createLocation("A-Town");
    const loc2 = await createLocation("B-City");
    const loc3 = await createLocation("C-Village");

    const journey = await journeys.createJourney(
      journeyInput({ session_id: session.id, name: "Three Stops" }),
    );

    // Create segments — auto-assigned sort_order should be 0, 1, 2
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: loc1.id,
      destination_entity_id: loc2.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "first leg",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: loc2.id,
      destination_entity_id: loc3.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "second leg",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const summary = await journeys.sessionTravelSummary(session.id);
    const segments = summary[0]!.segments;

    expect(segments).toHaveLength(2);
    expect(segments[0]!.origin_name).toBe("A-Town");
    expect(segments[0]!.destination_name).toBe("B-City");
    expect(segments[1]!.origin_name).toBe("B-City");
    expect(segments[1]!.destination_name).toBe("C-Village");
  });

  it("enriches segments with participant names", async () => {
    const session = await createSession("Session with travelers");
    const pc = await createPC("Arin");
    const loc = await createLocation("Thornwood");

    const journey = await journeys.createJourney(
      journeyInput({ session_id: session.id }),
    );
    const segment = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: loc.id,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    await journeys.addParticipant({ segment_id: segment.id, entity_id: pc.id });

    const summary = await journeys.sessionTravelSummary(session.id);
    const participants = summary[0]!.segments[0]!.participants;

    expect(participants).toHaveLength(1);
    expect(participants[0]!.entity_name).toBe("Arin");
    expect(participants[0]!.entity_id).toBe(pc.id);
  });

  it("handles null origin/destination gracefully", async () => {
    const session = await createSession("Partial travel");
    const journey = await journeys.createJourney(
      journeyInput({ session_id: session.id }),
    );
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const summary = await journeys.sessionTravelSummary(session.id);
    const seg = summary[0]!.segments[0]!;

    expect(seg.origin_name).toBeNull();
    expect(seg.destination_name).toBeNull();
    expect(seg.origin_entity_id).toBeNull();
    expect(seg.destination_entity_id).toBeNull();
  });
});

// ── 2. locationVisitHistory tests (Req 21.4) ──

describe("locationVisitHistory", () => {
  it("returns empty array for a location with no visits", async () => {
    const loc = await createLocation("Abandoned Ruins");

    const history = await journeys.locationVisitHistory(loc.id);

    expect(history).toEqual([]);
  });

  it("returns segments where the location is the origin", async () => {
    const loc = await createLocation("Silverymoon");
    const dest = await createLocation("Mithral Hall");

    const journey = await journeys.createJourney(journeyInput());
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: loc.id,
      destination_entity_id: dest.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const history = await journeys.locationVisitHistory(loc.id);

    expect(history).toHaveLength(1);
    expect(history[0]!.origin_entity_id).toBe(loc.id);
  });

  it("returns segments where the location is the destination", async () => {
    const origin = await createLocation("Baldur's Gate");
    const dest = await createLocation("Candlekeep");

    const journey = await journeys.createJourney(journeyInput());
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: origin.id,
      destination_entity_id: dest.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const history = await journeys.locationVisitHistory(dest.id);

    expect(history).toHaveLength(1);
    expect(history[0]!.destination_entity_id).toBe(dest.id);
  });

  it("returns segments where the location is a waypoint", async () => {
    const wayLoc = await createLocation("Crossroads Inn");
    const origin = await createLocation("Start");
    const dest = await createLocation("End");

    const journey = await journeys.createJourney(journeyInput());
    await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: origin.id,
      destination_entity_id: dest.id,
      waypoints: [{ entity_id: wayLoc.id }],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const history = await journeys.locationVisitHistory(wayLoc.id);

    expect(history).toHaveLength(1);
    // The segment should reference the waypoint location in its waypoints array
    expect(history[0]!.waypoints.some((w) => w.entity_id === wayLoc.id)).toBe(true);
  });

  it("returns all segments referencing a location in any role", async () => {
    const loc = await createLocation("Hub City");
    const otherLoc = await createLocation("Remote Village");

    const j1 = await journeys.createJourney(journeyInput({ name: "Outbound" }));
    const j2 = await journeys.createJourney(journeyInput({ name: "Return" }));

    // loc as origin
    await journeys.createSegment({
      journey_id: j1.id,
      origin_entity_id: loc.id,
      destination_entity_id: otherLoc.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: 1492,
      start_month: 3,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    // loc as destination
    await journeys.createSegment({
      journey_id: j2.id,
      origin_entity_id: otherLoc.id,
      destination_entity_id: loc.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: 1492,
      start_month: 6,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const history = await journeys.locationVisitHistory(loc.id);

    expect(history).toHaveLength(2);
  });

  it("orders visits by start date descending (most recent first)", async () => {
    const loc = await createLocation("Trading Post");
    const other = await createLocation("Distant Land");

    const j1 = await journeys.createJourney(journeyInput({ name: "Early Trip" }));
    const j2 = await journeys.createJourney(journeyInput({ name: "Late Trip" }));

    await journeys.createSegment({
      journey_id: j1.id,
      origin_entity_id: loc.id,
      destination_entity_id: other.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: 1490,
      start_month: 1,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    await journeys.createSegment({
      journey_id: j2.id,
      origin_entity_id: other.id,
      destination_entity_id: loc.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: 1495,
      start_month: 6,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const history = await journeys.locationVisitHistory(loc.id);

    expect(history).toHaveLength(2);
    // Most recent first (1495 before 1490)
    expect(history[0]!.start_year).toBe(1495);
    expect(history[1]!.start_year).toBe(1490);
  });

  it("enriches visit segments with journey and participant data", async () => {
    const loc = await createLocation("Market Square");
    const pc = await createPC("Bree");

    const journey = await journeys.createJourney(
      journeyInput({ name: "Market Run", category: "individual" }),
    );
    const seg = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: loc.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    await journeys.addParticipant({ segment_id: seg.id, entity_id: pc.id });

    const history = await journeys.locationVisitHistory(loc.id);

    expect(history).toHaveLength(1);
    expect(history[0]!.journey.name).toBe("Market Run");
    expect(history[0]!.journey.category).toBe("individual");
    expect(history[0]!.participants).toHaveLength(1);
    expect(history[0]!.participants[0]!.entity_name).toBe("Bree");
  });
});

// ── 3. Journey editor data flow tests (Req 14.1) ──

describe("Journey editor data flow", () => {
  it("creates a journey with all fields populated", async () => {
    const session = await createSession("Session 5");
    const party = await createParty("Silver Blades");

    const journey = await journeys.createJourney(
      journeyInput({
        session_id: session.id,
        party_id: party.id,
        name: "Expedition to Icewind Dale",
        category: "party",
        route_certainty: "approximate",
        description: "A perilous journey north",
        dm_notes: "Ambush planned at mile 50",
        start_year: 1492,
        start_month: 11,
        start_day: 1,
        end_year: 1492,
        end_month: 12,
        end_day: 15,
        sort_order: 3,
      }),
    );

    expect(journey.name).toBe("Expedition to Icewind Dale");
    expect(journey.category).toBe("party");
    expect(journey.route_certainty).toBe("approximate");
    expect(journey.session_id).toBe(session.id);
    expect(journey.party_id).toBe(party.id);
    expect(journey.description).toBe("A perilous journey north");
    expect(journey.dm_notes).toBe("Ambush planned at mile 50");
    expect(journey.start_year).toBe(1492);
    expect(journey.start_month).toBe(11);
    expect(journey.start_day).toBe(1);
    expect(journey.end_year).toBe(1492);
    expect(journey.end_month).toBe(12);
    expect(journey.end_day).toBe(15);
    expect(journey.sort_order).toBe(3);
  });

  it("updates a journey's fields", async () => {
    const journey = await journeys.createJourney(journeyInput());

    const updated = await journeys.updateJourney(journey.id, {
      name: "Renamed Journey",
      category: "backstory",
      description: "Updated description",
    });

    expect(updated.name).toBe("Renamed Journey");
    expect(updated.category).toBe("backstory");
    expect(updated.description).toBe("Updated description");
    // Unchanged fields preserved
    expect(updated.route_certainty).toBe("known");
  });

  it("creates a segment with participants", async () => {
    const pc1 = await createPC("Cade");
    const pc2 = await createPC("Dana");
    const origin = await createLocation("Port Nyanzaru");
    const dest = await createLocation("Camp Vengeance");

    const journey = await journeys.createJourney(journeyInput());
    const segment = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: origin.id,
      destination_entity_id: dest.id,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "Jungle trek",
      start_year: 1492,
      start_month: 8,
      start_day: 10,
      end_year: 1492,
      end_month: 8,
      end_day: 20,
    });

    await journeys.addParticipant({ segment_id: segment.id, entity_id: pc1.id, role: "guide" });
    await journeys.addParticipant({ segment_id: segment.id, entity_id: pc2.id });

    const participants = await journeys.participantsForSegment(segment.id);
    expect(participants).toHaveLength(2);

    const roles = participants.map((p) => p.role).sort();
    expect(roles).toEqual(["guide", "traveler"]);

    const entityIds = participants.map((p) => p.entity_id).sort();
    expect(entityIds).toEqual([pc1.id, pc2.id].sort());
  });

  it("creates a segment with waypoints and verifies they round-trip", async () => {
    const wp1 = await createLocation("Waypoint Alpha");
    const wp2 = await createLocation("Waypoint Beta");
    const origin = await createLocation("Origin Town");
    const dest = await createLocation("Destination City");

    const journey = await journeys.createJourney(journeyInput());
    const segment = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: origin.id,
      destination_entity_id: dest.id,
      waypoints: [
        { entity_id: wp1.id },
        { entity_id: wp2.id, x: 100, y: 200 },
      ],
      route_certainty: "estimated",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    const fetched = await journeys.getSegment(segment.id);
    expect(fetched.waypoints).toHaveLength(2);
    expect(fetched.waypoints[0]!.entity_id).toBe(wp1.id);
    expect(fetched.waypoints[1]!.entity_id).toBe(wp2.id);
    expect(fetched.waypoints[1]!.x).toBe(100);
    expect(fetched.waypoints[1]!.y).toBe(200);
  });

  it("inline entity creation flow: create location then use as origin", async () => {
    // Simulates the inline creation workflow — create location entity, then reference it
    const newLocation = await entities.create({
      kind: "location",
      name: "Freshly Created Town",
      campaign_id: campaign.id,
    });

    const journey = await journeys.createJourney(
      journeyInput({ name: "Backstory Path", category: "backstory" }),
    );
    const segment = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: newLocation.id,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "speculative",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    expect(segment.origin_entity_id).toBe(newLocation.id);

    // Verify through characterTravelHistory that the location name resolves
    const pc = await createPC("Backstory Hero");
    await journeys.addParticipant({ segment_id: segment.id, entity_id: pc.id });

    const travelHistory = await journeys.characterTravelHistory(pc.id);
    expect(travelHistory).toHaveLength(1);
    expect(travelHistory[0]!.origin_name).toBe("Freshly Created Town");
  });

  it("supports segment reordering", async () => {
    const journey = await journeys.createJourney(journeyInput());

    const s1 = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "first",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    const s2 = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "second",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    // Reverse order
    await journeys.reorderSegments(journey.id, [s2.id, s1.id]);

    const reordered = await journeys.listSegments(journey.id);
    expect(reordered[0]!.id).toBe(s2.id);
    expect(reordered[1]!.id).toBe(s1.id);
    expect(reordered[0]!.sort_order).toBe(0);
    expect(reordered[1]!.sort_order).toBe(1);
  });

  it("auto-assigns sort_order to new segments", async () => {
    const journey = await journeys.createJourney(journeyInput());

    const s1 = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    const s2 = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    const s3 = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: null,
      destination_entity_id: null,
      waypoints: [],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    expect(s1.sort_order).toBe(0);
    expect(s2.sort_order).toBe(1);
    expect(s3.sort_order).toBe(2);
  });
});

// ── 4. Entity deletion cleanup — removeWaypointEntity (Req 4.6) ──

describe("removeWaypointEntity", () => {
  it("removes waypoint entries referencing a deleted entity", async () => {
    const wpLoc = await createLocation("Doomed Waypoint");
    const origin = await createLocation("Start");
    const dest = await createLocation("End");

    const journey = await journeys.createJourney(journeyInput());
    const segment = await journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: origin.id,
      destination_entity_id: dest.id,
      waypoints: [
        { entity_id: wpLoc.id },
        { entity_id: origin.id },
      ],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    await journeys.removeWaypointEntity(wpLoc.id);

    const updated = await journeys.getSegment(segment.id);
    expect(updated.waypoints).toHaveLength(1);
    expect(updated.waypoints[0]!.entity_id).toBe(origin.id);
  });

  it("does nothing when no segments reference the entity", async () => {
    const unreferencedLoc = await createLocation("Nowhere");

    // Should not throw
    await journeys.removeWaypointEntity(unreferencedLoc.id);
  });

  it("cleans waypoints across multiple segments", async () => {
    const wpLoc = await createLocation("Shared Waypoint");
    const locA = await createLocation("A");
    const locB = await createLocation("B");

    const j1 = await journeys.createJourney(journeyInput({ name: "Journey 1" }));
    const j2 = await journeys.createJourney(journeyInput({ name: "Journey 2" }));

    const seg1 = await journeys.createSegment({
      journey_id: j1.id,
      origin_entity_id: locA.id,
      destination_entity_id: locB.id,
      waypoints: [{ entity_id: wpLoc.id }],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });
    const seg2 = await journeys.createSegment({
      journey_id: j2.id,
      origin_entity_id: locB.id,
      destination_entity_id: locA.id,
      waypoints: [{ entity_id: wpLoc.id }, { entity_id: locA.id }],
      route_certainty: "confirmed",
      notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
    });

    await journeys.removeWaypointEntity(wpLoc.id);

    const s1 = await journeys.getSegment(seg1.id);
    const s2 = await journeys.getSegment(seg2.id);

    expect(s1.waypoints).toHaveLength(0);
    expect(s2.waypoints).toHaveLength(1);
    expect(s2.waypoints[0]!.entity_id).toBe(locA.id);
  });
});
