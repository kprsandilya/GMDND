import { describe, expect, it, beforeEach } from "vitest";
import { NodeSqlDriver } from "./nodeDriver";
import { migrate } from "./migrations";
import { EntityRepository } from "./repositories/entities";
import { TimelineRepository } from "./repositories/misc";
import { JourneyRepository, ValidationError } from "./repositories/journeys";

let driver: NodeSqlDriver;
let entities: EntityRepository;
let timeline: TimelineRepository;
let journeys: JourneyRepository;
let campaignId: string;

beforeEach(async () => {
  driver = new NodeSqlDriver();
  await migrate(driver);
  entities = new EntityRepository(driver);
  timeline = new TimelineRepository(driver);
  journeys = new JourneyRepository(driver);

  const campaign = await entities.create({ kind: "campaign", name: "Test Campaign" });
  campaignId = campaign.id;
});

describe("Timeline Event Participants (Task 1.9)", () => {
  async function createCharacter(name: string) {
    return entities.create({ kind: "pc", name, campaign_id: campaignId });
  }

  async function createTimelineEvent(title: string, entityId?: string) {
    return timeline.create({
      campaign_id: campaignId,
      entity_id: entityId ?? null,
      title,
      body_md: "",
      year: null,
      month: null,
      day: null,
      kind: "general",
      secret: false,
    });
  }

  // ── addEventParticipant ──

  it("adds an event participant with default empty role", async () => {
    const char = await createCharacter("Arin");
    const event = await createTimelineEvent("Arin's birth");

    const participant = await journeys.addEventParticipant(event.id, char.id);

    expect(participant.event_id).toBe(event.id);
    expect(participant.entity_id).toBe(char.id);
    expect(participant.role).toBe("");
    expect(participant.id).toBeTruthy();
    expect(participant.created_at).toBeTruthy();
  });

  it("adds an event participant with a custom role", async () => {
    const char = await createCharacter("Bree");
    const event = await createTimelineEvent("Battle of Thornwood");

    const participant = await journeys.addEventParticipant(event.id, char.id, "commander");

    expect(participant.role).toBe("commander");
  });

  it("rejects duplicate (event_id, entity_id, role) combinations", async () => {
    const char = await createCharacter("Cade");
    const event = await createTimelineEvent("Secret meeting");

    await journeys.addEventParticipant(event.id, char.id, "witness");

    await expect(
      journeys.addEventParticipant(event.id, char.id, "witness"),
    ).rejects.toThrow(ValidationError);
  });

  it("allows same character with different roles on the same event", async () => {
    const char = await createCharacter("Dana");
    const event = await createTimelineEvent("Court hearing");

    const p1 = await journeys.addEventParticipant(event.id, char.id, "witness");
    const p2 = await journeys.addEventParticipant(event.id, char.id, "accused");

    expect(p1.role).toBe("witness");
    expect(p2.role).toBe("accused");
  });

  it("allows multiple characters on the same event", async () => {
    const char1 = await createCharacter("Erik");
    const char2 = await createCharacter("Faye");
    const event = await createTimelineEvent("Alliance formed");

    await journeys.addEventParticipant(event.id, char1.id);
    await journeys.addEventParticipant(event.id, char2.id);

    const participants = await journeys.eventParticipants(event.id);
    expect(participants).toHaveLength(2);
    expect(participants.map((p) => p.entity_id).sort()).toEqual([char1.id, char2.id].sort());
  });

  // ── removeEventParticipant ──

  it("removes an event participant by id", async () => {
    const char = await createCharacter("Gwen");
    const event = await createTimelineEvent("Discovery");

    const participant = await journeys.addEventParticipant(event.id, char.id);
    await journeys.removeEventParticipant(participant.id);

    const remaining = await journeys.eventParticipants(event.id);
    expect(remaining).toHaveLength(0);
  });

  it("throws NotFoundError when removing a non-existent participant", async () => {
    await expect(
      journeys.removeEventParticipant("non-existent-id"),
    ).rejects.toThrow(/not found/i);
  });

  // ── eventParticipants ──

  it("returns an empty array when the event has no participants", async () => {
    const event = await createTimelineEvent("Solo event");

    const participants = await journeys.eventParticipants(event.id);
    expect(participants).toEqual([]);
  });

  it("returns participants ordered by created_at", async () => {
    const char1 = await createCharacter("Hans");
    const char2 = await createCharacter("Ivy");
    const event = await createTimelineEvent("Group event");

    await journeys.addEventParticipant(event.id, char1.id, "first");
    await journeys.addEventParticipant(event.id, char2.id, "second");

    const participants = await journeys.eventParticipants(event.id);
    expect(participants).toHaveLength(2);
    // created_at should be monotonically increasing
    expect(participants[0]!.created_at <= participants[1]!.created_at).toBe(true);
  });

  // ── eventsForCharacter ──

  it("returns events where the character is the primary entity", async () => {
    const char = await createCharacter("Jules");
    const event = await createTimelineEvent("Birth", char.id);

    const events = await journeys.eventsForCharacter(char.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Birth");
  });

  it("returns events where the character is a participant", async () => {
    const char = await createCharacter("Kira");
    const otherChar = await createCharacter("Lars");
    const event = await createTimelineEvent("Battle", otherChar.id);
    await journeys.addEventParticipant(event.id, char.id, "ally");

    const events = await journeys.eventsForCharacter(char.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Battle");
  });

  it("returns events from both primary entity and participant without duplicates", async () => {
    const char = await createCharacter("Mira");
    const ownEvent = await createTimelineEvent("Own event", char.id);
    const otherEvent = await createTimelineEvent("Other event");
    await journeys.addEventParticipant(otherEvent.id, char.id);

    // Also add char as participant on their own event (should not duplicate)
    await journeys.addEventParticipant(ownEvent.id, char.id);

    const events = await journeys.eventsForCharacter(char.id);
    expect(events).toHaveLength(2);
    const titles = events.map((e) => e.title).sort();
    expect(titles).toEqual(["Other event", "Own event"]);
  });

  it("returns empty array when character has no events", async () => {
    const char = await createCharacter("Nina");

    const events = await journeys.eventsForCharacter(char.id);
    expect(events).toEqual([]);
  });

  it("orders events by manual_order, then year, then month, then day, then created_at", async () => {
    const char = await createCharacter("Omar");

    // Create events in deliberate disorder
    const e1 = await timeline.create({
      campaign_id: campaignId,
      entity_id: char.id,
      title: "Event Year 1000",
      body_md: "",
      year: 1000,
      month: 6,
      day: 15,
      kind: "general",
      secret: false,
    });

    const e2 = await timeline.create({
      campaign_id: campaignId,
      entity_id: char.id,
      title: "Event Year 500",
      body_md: "",
      year: 500,
      month: 1,
      day: 1,
      kind: "general",
      secret: false,
    });

    const e3 = await timeline.create({
      campaign_id: campaignId,
      entity_id: char.id,
      title: "Undated event",
      body_md: "",
      year: null,
      month: null,
      day: null,
      kind: "general",
      secret: false,
    });

    const events = await journeys.eventsForCharacter(char.id);
    expect(events).toHaveLength(3);
    // Year 500 before Year 1000, undated last
    expect(events[0]!.title).toBe("Event Year 500");
    expect(events[1]!.title).toBe("Event Year 1000");
    expect(events[2]!.title).toBe("Undated event");
  });

  // ── validateSegmentJourneyRef ──

  it("throws when segment_id is set but journey_id is null", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef("seg-123", null);
    }).toThrow(ValidationError);
  });

  it("throws when segment_id is set but journey_id is undefined", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef("seg-123", undefined);
    }).toThrow(ValidationError);
  });

  it("throws when segment_id is set but journey_id is empty string", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef("seg-123", "");
    }).toThrow(ValidationError);
  });

  it("does not throw when both segment_id and journey_id are set", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef("seg-123", "journey-456");
    }).not.toThrow();
  });

  it("does not throw when segment_id is null", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef(null, null);
    }).not.toThrow();
  });

  it("does not throw when segment_id is undefined", () => {
    expect(() => {
      journeys.validateSegmentJourneyRef(undefined, "journey-456");
    }).not.toThrow();
  });

  // ── Cascade behavior (Requirement 6.8) ──

  it("cascade-deletes event participants when the event is deleted", async () => {
    const char = await createCharacter("Quinn");
    const event = await createTimelineEvent("Ephemeral event", char.id);
    const participant = await journeys.addEventParticipant(event.id, char.id, "observer");

    // Delete the event via timeline repository
    await timeline.delete(event.id);

    // Participant should be gone too (ON DELETE CASCADE)
    const rows = await driver.select("SELECT * FROM timeline_event_participants WHERE id = ?", [participant.id]);
    expect(rows).toHaveLength(0);
  });

  it("cascade-deletes event participants when the entity is deleted", async () => {
    const char = await createCharacter("Rosa");
    const event = await createTimelineEvent("Some event");
    await journeys.addEventParticipant(event.id, char.id);

    // Delete the character entity
    await entities.delete(char.id);

    // Participant should be gone (ON DELETE CASCADE on entity_id)
    const participants = await journeys.eventParticipants(event.id);
    expect(participants).toHaveLength(0);
  });
});
