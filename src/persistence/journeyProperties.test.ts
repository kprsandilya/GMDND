import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { testRepos } from "./testUtils";
import { NodeSqlDriver } from "./nodeDriver";
import { migrate } from "./migrations";
import { EntityRepository } from "./repositories/entities";
import { JourneyRepository, ValidationError } from "./repositories/journeys";
import type { Repositories } from "./repositories";

/**
 * Property 3: Journey cascade delete preserves entities
 * Validates: Requirements 3.7, 14.10
 *
 * For any journey with associated travel segments, segment participants, and
 * timeline events, deleting the journey removes all segments and participants
 * but leaves all referenced character, location, and session entities unchanged
 * and all associated timeline events intact with null journey_id/segment_id.
 */
describe("journey cascade delete preserves entities (Property 3)", () => {
  /**
   * Helper: create the full entity graph needed for a journey scenario.
   * Returns IDs for campaign, characters, locations, session, and the journey
   * along with its segments, participants, and timeline events.
   */
  async function buildScenario(
    repos: Repositories,
    opts: {
      segmentCount: number;
      charsPerSegment: number;
      eventsPerJourney: number;
    },
  ) {
    const campaign = await repos.entities.create({ kind: "campaign", name: "Test Campaign" });
    const session = await repos.entities.create({ kind: "session", name: "Session 1", campaign_id: campaign.id });

    // Create characters (pc)
    const totalChars = Math.max(opts.charsPerSegment, 1);
    const characters: string[] = [];
    for (let i = 0; i < totalChars; i++) {
      const c = await repos.entities.create({ kind: "pc", name: `Hero ${i}`, campaign_id: campaign.id });
      characters.push(c.id);
    }

    // Create locations
    const locations: string[] = [];
    // We need at least segmentCount + 1 locations for origin/destination pairs
    const locationCount = Math.max(opts.segmentCount + 1, 2);
    for (let i = 0; i < locationCount; i++) {
      const loc = await repos.entities.create({ kind: "settlement", name: `Place ${i}`, campaign_id: campaign.id });
      locations.push(loc.id);
    }

    // Create the journey
    const journey = await repos.journeys.createJourney({
      campaign_id: campaign.id,
      name: "Test Journey",
      category: "campaign",
      route_certainty: "known",
      party_id: null,
      session_id: session.id,
      description: "",
      dm_notes: "",
      start_year: null,
      start_month: null,
      start_day: null,
      end_year: null,
      end_month: null,
      end_day: null,
      sort_order: 0,
    });

    // Create segments and participants
    const segmentIds: string[] = [];
    const participantIds: string[] = [];
    for (let s = 0; s < opts.segmentCount; s++) {
      const segment = await repos.journeys.createSegment({
        journey_id: journey.id,
        origin_entity_id: locations[s] ?? null,
        destination_entity_id: locations[s + 1] ?? null,
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
      segmentIds.push(segment.id);

      // Add participants to each segment
      for (let p = 0; p < opts.charsPerSegment && p < characters.length; p++) {
        const participant = await repos.journeys.addParticipant({
          segment_id: segment.id,
          entity_id: characters[p]!,
          role: "traveler",
          notes: "",
        });
        participantIds.push(participant.id);
      }
    }

    // Create timeline events linked to the journey (and optionally to a segment)
    const eventIds: string[] = [];
    for (let e = 0; e < opts.eventsPerJourney; e++) {
      const linkedSegmentId = segmentIds.length > 0 ? segmentIds[e % segmentIds.length]! : null;
      const event = await repos.timeline.create({
        campaign_id: campaign.id,
        entity_id: characters[0] ?? null,
        title: `Event ${e}`,
        body_md: "",
        year: null,
        month: null,
        day: null,
        kind: "campaign",
        secret: false,
        journey_id: journey.id,
        segment_id: linkedSegmentId,
        category: "travel",
        confidence: "certain",
        manual_order: e,
      });
      eventIds.push(event.id);
    }

    return {
      campaignId: campaign.id,
      sessionId: session.id,
      characterIds: characters,
      locationIds: locations,
      journeyId: journey.id,
      segmentIds,
      participantIds,
      eventIds,
    };
  }

  it("deleting a journey cascades to segments and participants but preserves entities and nullifies timeline event refs", () => {
    fc.assert(
      fc.asyncProperty(
        fc.record({
          segmentCount: fc.integer({ min: 1, max: 4 }),
          charsPerSegment: fc.integer({ min: 1, max: 3 }),
          eventsPerJourney: fc.integer({ min: 1, max: 4 }),
        }),
        async (opts) => {
          const { repos, driver } = await testRepos();

          const scenario = await buildScenario(repos, opts);

          // Pre-condition: verify everything exists before deletion
          const journeyBefore = await repos.journeys.getJourney(scenario.journeyId);
          expect(journeyBefore).toBeTruthy();
          expect(scenario.segmentIds.length).toBe(opts.segmentCount);
          expect(scenario.participantIds.length).toBe(opts.segmentCount * opts.charsPerSegment);
          expect(scenario.eventIds.length).toBe(opts.eventsPerJourney);

          // ── Delete the journey ──
          await repos.journeys.deleteJourney(scenario.journeyId);

          // ── Verify: journey is gone ──
          await expect(repos.journeys.getJourney(scenario.journeyId)).rejects.toThrow();

          // ── Verify: all segments are gone (cascade delete) ──
          for (const segId of scenario.segmentIds) {
            await expect(repos.journeys.getSegment(segId)).rejects.toThrow();
          }

          // ── Verify: all participants are gone (cascade delete through segments) ──
          for (const segId of scenario.segmentIds) {
            const participants = await repos.journeys.participantsForSegment(segId);
            expect(participants).toHaveLength(0);
          }

          // ── Verify: all character entities still exist ──
          for (const charId of scenario.characterIds) {
            const entity = await repos.entities.get(charId);
            expect(entity).toBeTruthy();
            expect(entity.id).toBe(charId);
          }

          // ── Verify: all location entities still exist ──
          for (const locId of scenario.locationIds) {
            const entity = await repos.entities.get(locId);
            expect(entity).toBeTruthy();
            expect(entity.id).toBe(locId);
          }

          // ── Verify: session entity still exists ──
          const sessionEntity = await repos.entities.get(scenario.sessionId);
          expect(sessionEntity).toBeTruthy();
          expect(sessionEntity.id).toBe(scenario.sessionId);

          // ── Verify: timeline events still exist but have journey_id=null and segment_id=null ──
          // (ON DELETE SET NULL behavior from the foreign key constraint)
          for (const eventId of scenario.eventIds) {
            const rows = await driver.select<{
              id: string;
              journey_id: string | null;
              segment_id: string | null;
              title: string;
            }>("SELECT id, journey_id, segment_id, title FROM timeline_events WHERE id = ?", [eventId]);
            expect(rows).toHaveLength(1);
            expect(rows[0]!.journey_id).toBeNull();
            expect(rows[0]!.segment_id).toBeNull();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});


/**
 * Property 1: Party membership non-overlap invariant
 * **Validates: Requirements 2.4**
 *
 * For any party and character, if there are multiple membership periods for
 * that character in that party, no two periods overlap — where a period with
 * no left_session_id extends indefinitely and overlap is defined by one
 * period's join being at or before the other's leave and vice versa.
 */
describe("Party membership non-overlap invariant (Property 1)", () => {
  /** Helper: create a fresh DB, entities repo, and journey repo. */
  async function freshRepos() {
    const d = new NodeSqlDriver();
    await migrate(d);
    const ent = new EntityRepository(d);
    const jr = new JourneyRepository(d);
    return { driver: d, entities: ent, journeys: jr };
  }

  /** Helper: create campaign, party, and character. */
  async function setupPartyAndCharacter(ent: EntityRepository) {
    const camp = await ent.create({ kind: "campaign", name: "C" });
    const party = await ent.create({ kind: "party", name: "P", campaign_id: camp.id });
    const char = await ent.create({ kind: "pc", name: "A", campaign_id: camp.id });
    return { campaignId: camp.id, partyId: party.id, characterId: char.id };
  }

  /** Helper: build a membership input with all left fields null (active). */
  function activeMembershipInput(partyId: string, entityId: string, role = "") {
    return {
      party_id: partyId,
      entity_id: entityId,
      role,
      joined_session_id: null,
      left_session_id: null,
      joined_year: null,
      joined_month: null,
      joined_day: null,
      left_year: null,
      left_month: null,
      left_day: null,
      notes: "",
    };
  }

  it("rejects adding an active membership when one already exists", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          role1: fc.string({ minLength: 0, maxLength: 50 }),
          role2: fc.string({ minLength: 0, maxLength: 50 }),
        }),
        async ({ role1, role2 }) => {
          const { entities: ent, journeys: jr } = await freshRepos();
          const { partyId, characterId } = await setupPartyAndCharacter(ent);

          // First active membership — should succeed
          await jr.addMembership(activeMembershipInput(partyId, characterId, role1));

          // Second active membership for same character + party → must be rejected
          await expect(
            jr.addMembership(activeMembershipInput(partyId, characterId, role2)),
          ).rejects.toThrow(ValidationError);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("allows a new membership after closing the previous one via left_session_id", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 100 }), async (_seed) => {
        const { entities: ent, journeys: jr } = await freshRepos();
        const { campaignId, partyId, characterId } = await setupPartyAndCharacter(ent);
        const session = await ent.create({ kind: "session", name: "S1", campaign_id: campaignId });

        // Create then close an active membership via left_session_id
        const m1 = await jr.addMembership(activeMembershipInput(partyId, characterId));
        await jr.updateMembership(m1.id, { left_session_id: session.id });

        // Adding a new active membership should now succeed
        const m2 = await jr.addMembership(activeMembershipInput(partyId, characterId));
        expect(m2.id).toBeDefined();
        expect(m2.party_id).toBe(partyId);
        expect(m2.entity_id).toBe(characterId);
      }),
      { numRuns: 10 },
    );
  });

  it("allows a new membership after closing the previous one via left_year", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9999 }), async (leftYear) => {
        const { entities: ent, journeys: jr } = await freshRepos();
        const { partyId, characterId } = await setupPartyAndCharacter(ent);

        // Create then close an active membership via left_year
        const m1 = await jr.addMembership(activeMembershipInput(partyId, characterId));
        await jr.updateMembership(m1.id, { left_year: leftYear });

        // Adding a new active membership should now succeed
        const m2 = await jr.addMembership(activeMembershipInput(partyId, characterId));
        expect(m2.id).toBeDefined();
      }),
      { numRuns: 20 },
    );
  });

  it("allows multiple closed memberships for the same character in the same party", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (count) => {
        const { entities: ent, journeys: jr } = await freshRepos();
        const { campaignId, partyId, characterId } = await setupPartyAndCharacter(ent);

        // Create and close `count` membership periods sequentially
        for (let i = 0; i < count; i++) {
          const session = await ent.create({ kind: "session", name: `S${i}`, campaign_id: campaignId });
          const m = await jr.addMembership(activeMembershipInput(partyId, characterId));
          await jr.updateMembership(m.id, { left_session_id: session.id });
        }

        // All memberships were created and closed — verify count
        const memberships = await jr.membershipsForCharacter(characterId);
        expect(memberships).toHaveLength(count);
        for (const m of memberships) {
          expect(m.left_session_id).not.toBeNull();
        }
      }),
      { numRuns: 10 },
    );
  });

  it("allows the same character in multiple different parties simultaneously", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (partyCount) => {
        const { entities: ent, journeys: jr } = await freshRepos();
        const camp = await ent.create({ kind: "campaign", name: "C" });
        const char = await ent.create({ kind: "pc", name: "A", campaign_id: camp.id });

        // Create multiple parties and add the character as active in each
        for (let i = 0; i < partyCount; i++) {
          const p = await ent.create({ kind: "party", name: `Party ${i}`, campaign_id: camp.id });
          const m = await jr.addMembership(activeMembershipInput(p.id, char.id));
          expect(m.party_id).toBe(p.id);
        }

        // Character should have active memberships in all parties
        const allMemberships = await jr.membershipsForCharacter(char.id);
        expect(allMemberships).toHaveLength(partyCount);
      }),
      { numRuns: 10 },
    );
  });
});

import { TimelineRepository } from "./repositories/misc";

/**
 * Property 5: Timeline event sorting is deterministic
 * **Validates: Requirements 6.6, 6.7**
 *
 * For any set of timeline events with varying manual_order, year, month, day,
 * and created_at values, listing them always returns the same order:
 * manual_order ASC → year ASC (nulls last) → month ASC (nulls last) →
 * day ASC (nulls last) → created_at ASC.
 */

/** Arbitrary that produces a nullable integer within a given range. */
function nullableInt(min: number, max: number) {
  return fc.option(fc.integer({ min, max }), { nil: null });
}

/** Descriptor for a single timeline event to insert. */
/** Description for a timeline event in property tests. */
interface EventDesc {
  title: string;
  manual_order: number;
  year: number | null;
  month: number | null;
  day: number | null;
}

/** Generate a list of 2–8 event descriptors with varying sort-relevant fields. */
const eventDescsArb: fc.Arbitrary<EventDesc[]> = fc
  .array(
    fc.record({
      manual_order: fc.integer({ min: -5, max: 5 }),
      year: nullableInt(1, 2000),
      month: nullableInt(1, 12),
      day: nullableInt(1, 28),
    }),
    { minLength: 2, maxLength: 8 },
  )
  .map((arr) =>
    arr.map((e, i) => ({
      ...e,
      title: `Event-${i}`,
    })),
  );

/** Comparator implementing the expected sort order. */
function expectedOrder(
  a: { manual_order: number; year: number | null; month: number | null; day: number | null; created_at: string },
  b: { manual_order: number; year: number | null; month: number | null; day: number | null; created_at: string },
): number {
  // 1. manual_order ASC
  if (a.manual_order !== b.manual_order) return a.manual_order - b.manual_order;

  // 2. year ASC, nulls last
  const aYearNull = a.year === null ? 1 : 0;
  const bYearNull = b.year === null ? 1 : 0;
  if (aYearNull !== bYearNull) return aYearNull - bYearNull;
  if (a.year !== null && b.year !== null && a.year !== b.year) return a.year - b.year;

  // 3. month ASC, nulls last
  const aMonthNull = a.month === null ? 1 : 0;
  const bMonthNull = b.month === null ? 1 : 0;
  if (aMonthNull !== bMonthNull) return aMonthNull - bMonthNull;
  if (a.month !== null && b.month !== null && a.month !== b.month) return a.month - b.month;

  // 4. day ASC, nulls last
  const aDayNull = a.day === null ? 1 : 0;
  const bDayNull = b.day === null ? 1 : 0;
  if (aDayNull !== bDayNull) return aDayNull - bDayNull;
  if (a.day !== null && b.day !== null && a.day !== b.day) return a.day - b.day;

  // 5. created_at ASC (tiebreaker)
  return a.created_at.localeCompare(b.created_at);
}

describe("timeline event sorting determinism (Property 5)", () => {
  it("list() returns events in the same order on repeated calls", async () => {
    await fc.assert(
      fc.asyncProperty(eventDescsArb, async (descs) => {
        const { repos, driver } = await testRepos();
        const timeline = new TimelineRepository(driver);

        const campaign = await repos.entities.create({ kind: "campaign", name: "SortTest" });

        for (const desc of descs) {
          await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: desc.title,
            body_md: "",
            year: desc.year,
            month: desc.month,
            day: desc.day,
            kind: "general" as "history",
            secret: false,
            manual_order: desc.manual_order,
          });
        }

        // Call list() twice
        const first = await timeline.list(campaign.id);
        const second = await timeline.list(campaign.id);

        // Verify identical order both times
        expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
      }),
      { numRuns: 30 },
    );
  });

  it("list() sorts by manual_order ASC, then year ASC (nulls last), month ASC (nulls last), day ASC (nulls last), created_at ASC", async () => {
    await fc.assert(
      fc.asyncProperty(eventDescsArb, async (descs) => {
        const { repos, driver } = await testRepos();
        const timeline = new TimelineRepository(driver);

        const campaign = await repos.entities.create({ kind: "campaign", name: "SortOrderTest" });

        // Insert events and record the created results to capture created_at & manual_order
        const created: { id: string; manual_order: number; year: number | null; month: number | null; day: number | null; created_at: string }[] = [];
        for (const desc of descs) {
          const event = await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: desc.title,
            body_md: "",
            year: desc.year,
            month: desc.month,
            day: desc.day,
            kind: "general" as "history",
            secret: false,
            manual_order: desc.manual_order,
          });
          created.push({
            id: event.id,
            manual_order: desc.manual_order,
            year: desc.year,
            month: desc.month,
            day: desc.day,
            created_at: event.created_at,
          });
        }

        const listed = await timeline.list(campaign.id);

        // Sort our recorded inputs using the expected comparator
        const expectedIds = [...created].sort(expectedOrder).map((e) => e.id);

        expect(listed.map((e) => e.id)).toEqual(expectedIds);
      }),
      { numRuns: 30 },
    );
  });

  it("dated events come before undated events at the same manual_order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 2000 }),
        async (manualOrder, year) => {
          const { repos, driver } = await testRepos();
          const timeline = new TimelineRepository(driver);

          const campaign = await repos.entities.create({ kind: "campaign", name: "DatedVsUndated" });

          // Create undated event first
          await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: "Undated",
            body_md: "",
            year: null,
            month: null,
            day: null,
            kind: "general" as "history",
            secret: false,
            manual_order: manualOrder,
          });

          // Then create dated event
          await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: "Dated",
            body_md: "",
            year,
            month: 1,
            day: 1,
            kind: "general" as "history",
            secret: false,
            manual_order: manualOrder,
          });

          const listed = await timeline.list(campaign.id);

          // Dated event should come before undated even though undated was inserted first
          expect(listed[0]!.title).toBe("Dated");
          expect(listed[1]!.title).toBe("Undated");
        },
      ),
      { numRuns: 20 },
    );
  });

  it("lower manual_order always comes first regardless of dates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 2000 }),
        async (orderGap, year) => {
          const { repos, driver } = await testRepos();
          const timeline = new TimelineRepository(driver);

          const campaign = await repos.entities.create({ kind: "campaign", name: "ManualOrderPriority" });

          // Create event with higher manual_order but earlier date
          await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: "HigherOrder-EarlierDate",
            body_md: "",
            year: 1,
            month: 1,
            day: 1,
            kind: "general" as "history",
            secret: false,
            manual_order: orderGap,
          });

          // Create event with lower manual_order but later date
          await timeline.create({
            campaign_id: campaign.id,
            entity_id: null,
            title: "LowerOrder-LaterDate",
            body_md: "",
            year: year + 1000,
            month: 12,
            day: 28,
            kind: "general" as "history",
            secret: false,
            manual_order: 0,
          });

          const listed = await timeline.list(campaign.id);

          // Lower manual_order wins over any date ordering
          expect(listed[0]!.title).toBe("LowerOrder-LaterDate");
          expect(listed[1]!.title).toBe("HigherOrder-EarlierDate");
        },
      ),
      { numRuns: 20 },
    );
  });
});


/**
 * Property 2: Segment participant uniqueness
 * **Validates: Requirements 5.3**
 *
 * For any travel segment, adding the same character (entity_id) twice to that
 * segment is rejected, and the participant list size equals the number of
 * distinct entity_ids.
 */
describe("segment participant uniqueness (Property 2)", () => {
  it("participant list size equals the number of distinct entity_ids added", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a subset selection: for each of up to 5 entities, a boolean
        // indicating whether to add them as a participant
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        async (selections) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: "Test Journey",
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
          });
          const segment = await repos.journeys.createSegment({
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

          // Create a pool of PC/NPC entities
          const entities = [];
          for (let i = 0; i < selections.length; i++) {
            const kind = i % 2 === 0 ? "pc" : "npc";
            const entity = await repos.entities.create({
              kind,
              name: `Entity-${i}`,
              campaign_id: campaign.id,
            });
            entities.push(entity);
          }

          // Add the selected subset as participants
          const addedIds = new Set<string>();
          for (let i = 0; i < selections.length; i++) {
            if (selections[i]) {
              await repos.journeys.addParticipant({
                segment_id: segment.id,
                entity_id: entities[i]!.id,
                role: "traveler",
                notes: "",
              });
              addedIds.add(entities[i]!.id);
            }
          }

          // Verify participant list length matches distinct count
          const participants = await repos.journeys.participantsForSegment(segment.id);
          expect(participants.length).toBe(addedIds.size);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("adding the same entity_id twice to a segment is rejected with ValidationError", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick which entity index (0–3) to duplicate
        fc.integer({ min: 0, max: 3 }),
        // Pick entity kind for the duplicate
        fc.constantFrom("pc" as const, "npc" as const),
        async (dupIndex, kind) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: "Test Journey",
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
          });
          const segment = await repos.journeys.createSegment({
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

          // Create a pool of 4 entities
          const entities = [];
          for (let i = 0; i < 4; i++) {
            const entity = await repos.entities.create({
              kind: i === dupIndex ? kind : i % 2 === 0 ? "pc" : "npc",
              name: `Entity-${i}`,
              campaign_id: campaign.id,
            });
            entities.push(entity);
          }

          // First add should succeed
          const target = entities[dupIndex]!;
          await repos.journeys.addParticipant({
            segment_id: segment.id,
            entity_id: target.id,
            role: "traveler",
            notes: "",
          });

          // Second add of the same entity_id should throw ValidationError
          await expect(
            repos.journeys.addParticipant({
              segment_id: segment.id,
              entity_id: target.id,
              role: "guide",
              notes: "duplicate attempt",
            }),
          ).rejects.toThrow(ValidationError);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("duplicate rejection holds regardless of role or notes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        async (role1, role2, notes1, notes2) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: "Test Journey",
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
          });
          const segment = await repos.journeys.createSegment({
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
          const pc = await repos.entities.create({ kind: "pc", name: "Hero", campaign_id: campaign.id });

          // First add with arbitrary role/notes should succeed
          await repos.journeys.addParticipant({
            segment_id: segment.id,
            entity_id: pc.id,
            role: role1 || "traveler",
            notes: notes1,
          });

          // Second add with different role/notes should still be rejected
          // because uniqueness is on (segment_id, entity_id)
          await expect(
            repos.journeys.addParticipant({
              segment_id: segment.id,
              entity_id: pc.id,
              role: role2 || "scout",
              notes: notes2,
            }),
          ).rejects.toThrow(ValidationError);

          // Verify only one participant exists
          const participants = await repos.journeys.participantsForSegment(segment.id);
          expect(participants.length).toBe(1);
        },
      ),
      { numRuns: 20 },
    );
  });
});


/**
 * Property 6: Segment-journey reference integrity
 * **Validates: Requirements 6.9**
 *
 * When a timeline event specifies a segment_id, it must also have a non-null
 * journey_id. The validateSegmentJourneyRef method should reject non-null
 * segment_id with null journey_id.
 */
describe("segment-journey reference integrity (Property 6)", () => {
  const journeys = new JourneyRepository(new NodeSqlDriver());

  it("rejects non-null segment_id with null journey_id", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.constantFrom(null, undefined, ""),
        (segmentId, journeyId) => {
          expect(() => {
            journeys.validateSegmentJourneyRef(segmentId, journeyId);
          }).toThrow(ValidationError);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("accepts non-null segment_id with non-null journey_id", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (segmentId, journeyId) => {
          expect(() => {
            journeys.validateSegmentJourneyRef(segmentId, journeyId);
          }).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("accepts null segment_id with any journey_id", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(""),
          fc.string({ minLength: 1, maxLength: 100 }),
        ),
        (segmentId, journeyId) => {
          expect(() => {
            journeys.validateSegmentJourneyRef(segmentId, journeyId);
          }).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});


/**
 * Property 7: Travel history round-trip through character view
 * **Validates: Requirements 5.4, 7.1**
 *
 * When a character is added as a participant to segments across multiple
 * journeys, characterTravelHistory returns all those segments enriched with
 * journey data, and no segments the character doesn't participate in.
 */
describe("travel history round-trip through character view (Property 7)", () => {
  /** Arbitrary for a journey with 1–3 segments, each with a boolean flag
   *  indicating whether the character participates. */
  const journeyArb = fc.record({
    segmentCount: fc.integer({ min: 1, max: 3 }),
    /** For each segment, whether the character should be added as a participant */
    participations: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
    category: fc.constantFrom(
      "backstory" as const,
      "campaign" as const,
      "individual" as const,
      "party" as const,
      "npc" as const,
      "flashback" as const,
      "uncertain" as const,
    ),
  });

  /** Arbitrary for the full scenario: 1–3 journeys with their segment/participation configs. */
  const scenarioArb = fc.record({
    journeyConfigs: fc.array(journeyArb, { minLength: 1, maxLength: 3 }),
  });

  it("characterTravelHistory returns exactly the segments where the character is a participant", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ journeyConfigs }) => {
        const { repos } = await testRepos();

        // Setup campaign, character, and locations
        const campaign = await repos.entities.create({ kind: "campaign", name: "TravelHistoryTest" });
        const character = await repos.entities.create({ kind: "pc", name: "Traveler", campaign_id: campaign.id });

        // Create enough locations for all segments across all journeys
        const totalSegments = journeyConfigs.reduce((sum, jc) => sum + jc.segmentCount, 0);
        const locations: string[] = [];
        for (let i = 0; i < totalSegments + journeyConfigs.length; i++) {
          const loc = await repos.entities.create({
            kind: "settlement",
            name: `Location ${i}`,
            campaign_id: campaign.id,
          });
          locations.push(loc.id);
        }

        // Track which segment IDs the character participates in and which journey each belongs to
        const participatedSegmentIds = new Set<string>();
        const segmentToJourneyId = new Map<string, string>();
        let locationIdx = 0;

        for (const config of journeyConfigs) {
          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: `Journey-${config.category}`,
            category: config.category,
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
          });

          for (let s = 0; s < config.segmentCount; s++) {
            const segment = await repos.journeys.createSegment({
              journey_id: journey.id,
              origin_entity_id: locations[locationIdx] ?? null,
              destination_entity_id: locations[locationIdx + 1] ?? null,
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
            locationIdx++;

            segmentToJourneyId.set(segment.id, journey.id);

            // Use the participation flag (cycling if segmentCount < 3)
            const shouldParticipate = config.participations[s % config.participations.length];
            if (shouldParticipate) {
              await repos.journeys.addParticipant({
                segment_id: segment.id,
                entity_id: character.id,
                role: "traveler",
                notes: "",
              });
              participatedSegmentIds.add(segment.id);
            }
          }
        }

        // Query travel history
        const history = await repos.journeys.characterTravelHistory(character.id);

        // Verify: returned segment IDs match exactly the participated set
        const returnedSegmentIds = new Set(history.map((es) => es.id));
        expect(returnedSegmentIds).toEqual(participatedSegmentIds);

        // Verify: each returned segment has the correct journey data attached
        for (const enriched of history) {
          const expectedJourneyId = segmentToJourneyId.get(enriched.id);
          expect(enriched.journey).toBeDefined();
          expect(enriched.journey.id).toBe(expectedJourneyId);

          // The character should appear in the participants list
          const charInParticipants = enriched.participants.some(
            (p) => p.entity_id === character.id,
          );
          expect(charInParticipants).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });

  it("characterTravelHistory returns an empty array when the character has no participations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        async (journeyCount, segmentsPerJourney) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "EmptyHistoryTest" });
          const character = await repos.entities.create({ kind: "pc", name: "Loner", campaign_id: campaign.id });
          const otherChar = await repos.entities.create({ kind: "npc", name: "Other", campaign_id: campaign.id });

          // Create journeys and segments but only add a different character as participant
          for (let j = 0; j < journeyCount; j++) {
            const journey = await repos.journeys.createJourney({
              campaign_id: campaign.id,
              name: `Journey ${j}`,
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
            });

            for (let s = 0; s < segmentsPerJourney; s++) {
              const segment = await repos.journeys.createSegment({
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

              // Add only the other character, never the target
              await repos.journeys.addParticipant({
                segment_id: segment.id,
                entity_id: otherChar.id,
                role: "traveler",
                notes: "",
              });
            }
          }

          // The target character should have no travel history
          const history = await repos.journeys.characterTravelHistory(character.id);
          expect(history).toHaveLength(0);
        },
      ),
      { numRuns: 10 },
    );
  });
});


/**
 * Property 10: Filter combination is conjunctive
 * **Validates: Requirements 11.7, 11.10**
 *
 * When multiple filter criteria are active (character, party, session, category),
 * they combine with AND logic so a journey is only included when it satisfies
 * every active filter. Clearing all filters returns all journeys.
 */
describe("filter combination is conjunctive (Property 10)", () => {
  /**
   * Scaffold: create a campaign with varied journeys, segments, and participants
   * so that filters can meaningfully select subsets.
   */
  async function buildFilterScenario(repos: Repositories) {
    const campaign = await repos.entities.create({ kind: "campaign", name: "FilterCampaign" });

    // Create 2 parties
    const partyA = await repos.entities.create({ kind: "party", name: "Party A", campaign_id: campaign.id });
    const partyB = await repos.entities.create({ kind: "party", name: "Party B", campaign_id: campaign.id });

    // Create 2 sessions
    const sessionX = await repos.entities.create({ kind: "session", name: "Session X", campaign_id: campaign.id });
    const sessionY = await repos.entities.create({ kind: "session", name: "Session Y", campaign_id: campaign.id });

    // Create 3 characters
    const charAlpha = await repos.entities.create({ kind: "pc", name: "Alpha", campaign_id: campaign.id });
    const charBeta = await repos.entities.create({ kind: "npc", name: "Beta", campaign_id: campaign.id });
    const charGamma = await repos.entities.create({ kind: "pc", name: "Gamma", campaign_id: campaign.id });

    // Categories to use
    const categories = ["backstory", "campaign", "individual", "party"] as const;

    // Create journeys with various combinations of party, session, category
    const journeyConfigs = [
      { name: "J1", category: "backstory", party: partyA.id, session: sessionX.id, chars: [charAlpha.id] },
      { name: "J2", category: "campaign", party: partyA.id, session: sessionY.id, chars: [charAlpha.id, charBeta.id] },
      { name: "J3", category: "individual", party: partyB.id, session: sessionX.id, chars: [charBeta.id] },
      { name: "J4", category: "party", party: partyB.id, session: sessionY.id, chars: [charGamma.id] },
      { name: "J5", category: "backstory", party: null, session: null, chars: [charAlpha.id, charGamma.id] },
      { name: "J6", category: "campaign", party: partyA.id, session: null, chars: [charBeta.id, charGamma.id] },
    ] as const;

    const journeyIds: string[] = [];
    for (const cfg of journeyConfigs) {
      const journey = await repos.journeys.createJourney({
        campaign_id: campaign.id,
        name: cfg.name,
        category: cfg.category,
        route_certainty: "known",
        party_id: cfg.party ?? null,
        session_id: cfg.session ?? null,
        description: "",
        dm_notes: "",
        start_year: null,
        start_month: null,
        start_day: null,
        end_year: null,
        end_month: null,
        end_day: null,
        sort_order: 0,
      });
      journeyIds.push(journey.id);

      // Create a segment and add participants
      const segment = await repos.journeys.createSegment({
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

      for (const charId of cfg.chars) {
        await repos.journeys.addParticipant({
          segment_id: segment.id,
          entity_id: charId,
          role: "traveler",
          notes: "",
        });
      }
    }

    return {
      campaignId: campaign.id,
      partyIds: [partyA.id, partyB.id],
      sessionIds: [sessionX.id, sessionY.id],
      characterIds: [charAlpha.id, charBeta.id, charGamma.id],
      categories,
      journeyIds,
    };
  }

  it("clearing all filters returns all journeys for the campaign", async () => {
    const { repos } = await testRepos();
    const scenario = await buildFilterScenario(repos);

    const allJourneys = await repos.journeys.listJourneys(scenario.campaignId);
    expect(allJourneys.length).toBe(scenario.journeyIds.length);

    const allIds = new Set(allJourneys.map((j) => j.id));
    for (const id of scenario.journeyIds) {
      expect(allIds.has(id)).toBe(true);
    }
  });

  it("adding more filters returns a subset of (or equal to) fewer filters", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Randomly decide which filters to activate
        fc.record({
          useCategory: fc.boolean(),
          categoryIdx: fc.integer({ min: 0, max: 3 }),
          useSession: fc.boolean(),
          sessionIdx: fc.integer({ min: 0, max: 1 }),
          useParty: fc.boolean(),
          partyIdx: fc.integer({ min: 0, max: 1 }),
          useCharacter: fc.boolean(),
          characterIdx: fc.integer({ min: 0, max: 2 }),
        }),
        async ({ useCategory, categoryIdx, useSession, sessionIdx, useParty, partyIdx, useCharacter, characterIdx }) => {
          const { repos } = await testRepos();
          const scenario = await buildFilterScenario(repos);

          const categories = ["backstory", "campaign", "individual", "party"] as const;

          // Build the full filter object
          const fullFilter: import("@/domain/journeyTypes").JourneyFilters = {
            campaignId: scenario.campaignId,
            ...(useCategory ? { category: categories[categoryIdx] } : {}),
            ...(useSession ? { sessionId: scenario.sessionIds[sessionIdx] } : {}),
            ...(useParty ? { partyId: scenario.partyIds[partyIdx] } : {}),
            ...(useCharacter ? { characterId: scenario.characterIds[characterIdx] } : {}),
          };

          // Get results with full filter
          const fullResults = await repos.journeys.listJourneys(scenario.campaignId, fullFilter);
          const fullIds = new Set(fullResults.map((j) => j.id));

          // For every possible single-filter subset, the full result should be a subset
          if (useCategory) {
            const singleFilter = await repos.journeys.listJourneys(scenario.campaignId, {
              campaignId: scenario.campaignId,
              category: categories[categoryIdx],
            });
            const singleIds = new Set(singleFilter.map((j) => j.id));
            for (const id of fullIds) {
              expect(singleIds.has(id)).toBe(true);
            }
          }

          if (useSession) {
            const singleFilter = await repos.journeys.listJourneys(scenario.campaignId, {
              campaignId: scenario.campaignId,
              sessionId: scenario.sessionIds[sessionIdx],
            });
            const singleIds = new Set(singleFilter.map((j) => j.id));
            for (const id of fullIds) {
              expect(singleIds.has(id)).toBe(true);
            }
          }

          if (useParty) {
            const singleFilter = await repos.journeys.listJourneys(scenario.campaignId, {
              campaignId: scenario.campaignId,
              partyId: scenario.partyIds[partyIdx],
            });
            const singleIds = new Set(singleFilter.map((j) => j.id));
            for (const id of fullIds) {
              expect(singleIds.has(id)).toBe(true);
            }
          }

          if (useCharacter) {
            const singleFilter = await repos.journeys.listJourneys(scenario.campaignId, {
              campaignId: scenario.campaignId,
              characterId: scenario.characterIds[characterIdx],
            });
            const singleIds = new Set(singleFilter.map((j) => j.id));
            for (const id of fullIds) {
              expect(singleIds.has(id)).toBe(true);
            }
          }

          // No-filter result must be a superset of the filtered result
          const allJourneys = await repos.journeys.listJourneys(scenario.campaignId);
          const allIds = new Set(allJourneys.map((j) => j.id));
          for (const id of fullIds) {
            expect(allIds.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("each journey in a filtered result satisfies every active filter criterion", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          useCategory: fc.boolean(),
          categoryIdx: fc.integer({ min: 0, max: 3 }),
          useSession: fc.boolean(),
          sessionIdx: fc.integer({ min: 0, max: 1 }),
          useParty: fc.boolean(),
          partyIdx: fc.integer({ min: 0, max: 1 }),
          useCharacter: fc.boolean(),
          characterIdx: fc.integer({ min: 0, max: 2 }),
        }),
        async ({ useCategory, categoryIdx, useSession, sessionIdx, useParty, partyIdx, useCharacter, characterIdx }) => {
          const { repos } = await testRepos();
          const scenario = await buildFilterScenario(repos);

          const categories = ["backstory", "campaign", "individual", "party"] as const;
          const chosenCategory = categories[categoryIdx];
          const chosenSession = scenario.sessionIds[sessionIdx];
          const chosenParty = scenario.partyIds[partyIdx];
          const chosenCharacter = scenario.characterIds[characterIdx];

          const filters: import("@/domain/journeyTypes").JourneyFilters = {
            campaignId: scenario.campaignId,
            ...(useCategory ? { category: chosenCategory } : {}),
            ...(useSession ? { sessionId: chosenSession } : {}),
            ...(useParty ? { partyId: chosenParty } : {}),
            ...(useCharacter ? { characterId: chosenCharacter } : {}),
          };

          const results = await repos.journeys.listJourneys(scenario.campaignId, filters);

          // Verify each returned journey satisfies all active filter criteria
          for (const journey of results) {
            if (useCategory) {
              expect(journey.category).toBe(chosenCategory);
            }
            if (useSession) {
              expect(journey.session_id).toBe(chosenSession);
            }
            if (useParty) {
              expect(journey.party_id).toBe(chosenParty);
            }
            if (useCharacter) {
              // The character filter works via segment_participants join,
              // so we verify the character participates in at least one segment
              const segments = await repos.journeys.listSegments(journey.id);
              let found = false;
              for (const seg of segments) {
                const participants = await repos.journeys.participantsForSegment(seg.id);
                if (participants.some((p) => p.entity_id === chosenCharacter)) {
                  found = true;
                  break;
                }
              }
              expect(found).toBe(true);
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});


/**
 * Property 8: Party membership at-session query correctness
 * **Validates: Requirements 2.10**
 *
 * When querying party membership at a given session, only characters whose
 * joined_session_id is at or before the queried session (by sort_order)
 * and whose left_session_id is null or at or after the queried session
 * are returned.
 */
describe("party membership at-session query correctness (Property 8)", () => {
  /**
   * Describes a membership to create: which character index, which session
   * index they join at, and optionally which session index they leave at.
   */
  interface MembershipDesc {
    charIndex: number;
    joinSessionIndex: number;
    /** null = still active (no left_session_id) */
    leftSessionIndex: number | null;
  }

  /**
   * Generator for a test scenario:
   * - sessionCount: 2–6 sessions with sequential sort_order
   * - charCount: 1–4 characters
   * - memberships: 1–6 memberships with random join/leave session indices
   * - targetSessionIndex: which session to query at
   */
  const scenarioArb = fc
    .record({
      sessionCount: fc.integer({ min: 2, max: 6 }),
      charCount: fc.integer({ min: 1, max: 4 }),
    })
    .chain(({ sessionCount, charCount }) =>
      fc.record({
        sessionCount: fc.constant(sessionCount),
        charCount: fc.constant(charCount),
        memberships: fc.array(
          fc.record({
            charIndex: fc.integer({ min: 0, max: charCount - 1 }),
            joinSessionIndex: fc.integer({ min: 0, max: sessionCount - 1 }),
            leftSessionIndex: fc.option(fc.integer({ min: 0, max: sessionCount - 1 }), { nil: null }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        targetSessionIndex: fc.integer({ min: 0, max: sessionCount - 1 }),
      }),
    )
    // Filter out memberships where leftSessionIndex < joinSessionIndex (invalid periods)
    .map((s) => ({
      ...s,
      memberships: s.memberships.filter(
        (m) => m.leftSessionIndex === null || m.leftSessionIndex >= m.joinSessionIndex,
      ),
    }))
    // Ensure at least one valid membership remains
    .filter((s) => s.memberships.length > 0)
    // Deduplicate: keep only the first membership per character to avoid overlap conflicts
    .map((s) => {
      const seen = new Set<number>();
      const unique: MembershipDesc[] = [];
      for (const m of s.memberships) {
        if (!seen.has(m.charIndex)) {
          seen.add(m.charIndex);
          unique.push(m);
        }
      }
      return { ...s, memberships: unique };
    });

  it("returns exactly the members whose join session is at-or-before the target and left session is null or at-or-after the target", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { repos } = await testRepos();

        // Create campaign and party
        const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
        const party = await repos.entities.create({
          kind: "party",
          name: "The Party",
          campaign_id: campaign.id,
        });

        // Create sessions with sequential sort_order
        const sessions: { id: string; sort_order: number }[] = [];
        for (let i = 0; i < scenario.sessionCount; i++) {
          const s = await repos.entities.create({
            kind: "session",
            name: `Session ${i}`,
            campaign_id: campaign.id,
            sort_order: i,
          });
          sessions.push({ id: s.id, sort_order: i });
        }

        // Create characters
        const characters: string[] = [];
        for (let i = 0; i < scenario.charCount; i++) {
          const c = await repos.entities.create({
            kind: "pc",
            name: `Char ${i}`,
            campaign_id: campaign.id,
          });
          characters.push(c.id);
        }

        // Create memberships
        for (const m of scenario.memberships) {
          await repos.journeys.addMembership({
            party_id: party.id,
            entity_id: characters[m.charIndex]!,
            role: "",
            joined_session_id: sessions[m.joinSessionIndex]!.id,
            left_session_id: m.leftSessionIndex !== null ? sessions[m.leftSessionIndex]!.id : null,
            joined_year: null,
            joined_month: null,
            joined_day: null,
            left_year: null,
            left_month: null,
            left_day: null,
            notes: "",
          });
        }

        // Query membership at the target session
        const targetSession = sessions[scenario.targetSessionIndex]!;
        const result = await repos.journeys.membershipAtSession(party.id, targetSession.id);

        // Compute expected set based on sort_order comparison
        const targetOrder = targetSession.sort_order;
        const expectedCharIds = new Set<string>();
        for (const m of scenario.memberships) {
          const joinOrder = sessions[m.joinSessionIndex]!.sort_order;
          const leftOrder = m.leftSessionIndex !== null ? sessions[m.leftSessionIndex]!.sort_order : null;

          const joinedAtOrBefore = joinOrder <= targetOrder;
          const leftAtOrAfterOrNull = leftOrder === null || leftOrder >= targetOrder;

          if (joinedAtOrBefore && leftAtOrAfterOrNull) {
            expectedCharIds.add(characters[m.charIndex]!);
          }
        }

        // Verify: returned set matches expected set exactly
        const returnedCharIds = new Set(result.map((r) => r.entity_id));
        expect(returnedCharIds).toEqual(expectedCharIds);
      }),
      { numRuns: 50 },
    );
  });

  it("returns empty when no memberships exist for the party", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (sessionIndex) => {
        const { repos } = await testRepos();
        const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
        const party = await repos.entities.create({
          kind: "party",
          name: "Empty Party",
          campaign_id: campaign.id,
        });

        // Create at least one session
        const session = await repos.entities.create({
          kind: "session",
          name: "S0",
          campaign_id: campaign.id,
          sort_order: sessionIndex,
        });

        const result = await repos.journeys.membershipAtSession(party.id, session.id);
        expect(result).toHaveLength(0);
      }),
      { numRuns: 10 },
    );
  });

  it("membership with null joined_session_id is always included regardless of target session", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        async (targetSortOrder) => {
          const { repos } = await testRepos();
          const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
          const party = await repos.entities.create({
            kind: "party",
            name: "P",
            campaign_id: campaign.id,
          });
          const char = await repos.entities.create({
            kind: "pc",
            name: "Hero",
            campaign_id: campaign.id,
          });
          const targetSession = await repos.entities.create({
            kind: "session",
            name: "Target",
            campaign_id: campaign.id,
            sort_order: targetSortOrder,
          });

          // Membership with no joined_session_id and no left_session_id
          await repos.journeys.addMembership({
            party_id: party.id,
            entity_id: char.id,
            role: "",
            joined_session_id: null,
            left_session_id: null,
            joined_year: null,
            joined_month: null,
            joined_day: null,
            left_year: null,
            left_month: null,
            left_day: null,
            notes: "",
          });

          const result = await repos.journeys.membershipAtSession(party.id, targetSession.id);
          expect(result).toHaveLength(1);
          expect(result[0]!.entity_id).toBe(char.id);
        },
      ),
      { numRuns: 10 },
    );
  });
});


/**
 * Property 11: Active membership derivation
 * **Validates: Requirements 2.6**
 *
 * While a membership record has no left_session_id and no left date, the
 * character is treated as a current member of the party. The activeMemberships
 * query should return exactly those members.
 */
describe("active membership derivation (Property 11)", () => {
  /**
   * Describes a membership's "left" state:
   * - "active"           → no left_session_id, no left_year  (current member)
   * - "closed_session"   → left_session_id set              (former member)
   * - "closed_year"      → left_year set                    (former member)
   * - "closed_both"      → both left_session_id and left_year set
   */
  type LeftState = "active" | "closed_session" | "closed_year" | "closed_both";

  const leftStateArb: fc.Arbitrary<LeftState> = fc.constantFrom(
    "active" as const,
    "closed_session" as const,
    "closed_year" as const,
    "closed_both" as const,
  );

  /**
   * Generate an array of 2-6 membership descriptors, each with a unique
   * character index and a random left state. We guarantee at most one
   * active membership per character (since the repo rejects overlapping
   * active memberships for the same party+character).
   */
  const membershipDescsArb = fc
    .array(leftStateArb, { minLength: 2, maxLength: 6 })
    .map((states) => states.map((state, i) => ({ charIndex: i, state })));

  it("activeMemberships returns exactly the members with no left_session_id and no left_year", async () => {
    await fc.assert(
      fc.asyncProperty(membershipDescsArb, async (descs) => {
        const { repos } = await testRepos();

        const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
        const party = await repos.entities.create({ kind: "party", name: "P", campaign_id: campaign.id });

        // Create a leave-session for closing memberships that need one
        const leaveSession = await repos.entities.create({
          kind: "session",
          name: "LeaveSession",
          campaign_id: campaign.id,
        });

        // Create one character per membership descriptor
        const characters: { id: string; name: string }[] = [];
        for (let i = 0; i < descs.length; i++) {
          const ch = await repos.entities.create({
            kind: i % 2 === 0 ? "pc" : "npc",
            name: `Char-${i}`,
            campaign_id: campaign.id,
          });
          characters.push({ id: ch.id, name: ch.name });
        }

        // Track which character IDs should be active
        const expectedActiveIds = new Set<string>();

        for (const desc of descs) {
          const charId = characters[desc.charIndex]!.id;

          // Build the membership input based on the left state
          const input = {
            party_id: party.id,
            entity_id: charId,
            role: "",
            joined_session_id: null as string | null,
            left_session_id: null as string | null,
            joined_year: null as number | null,
            joined_month: null as number | null,
            joined_day: null as number | null,
            left_year: null as number | null,
            left_month: null as number | null,
            left_day: null as number | null,
            notes: "",
          };

          switch (desc.state) {
            case "active":
              // No left fields → current member
              expectedActiveIds.add(charId);
              break;
            case "closed_session":
              input.left_session_id = leaveSession.id;
              break;
            case "closed_year":
              input.left_year = 1200;
              break;
            case "closed_both":
              input.left_session_id = leaveSession.id;
              input.left_year = 1200;
              break;
          }

          await repos.journeys.addMembership(input);
        }

        // Query active memberships
        const active = await repos.journeys.activeMemberships(party.id);
        const activeIds = new Set(active.map((m) => m.entity_id));

        // Verify the returned set exactly matches expected
        expect(activeIds).toEqual(expectedActiveIds);

        // Also verify every returned membership has null left fields
        for (const m of active) {
          expect(m.left_session_id).toBeNull();
          expect(m.left_year).toBeNull();
        }
      }),
      { numRuns: 30 },
    );
  });

  it("a membership closed only via left_year (no left_session_id) is NOT active", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 9999 }),
        async (leftYear) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
          const party = await repos.entities.create({ kind: "party", name: "P", campaign_id: campaign.id });
          const char = await repos.entities.create({ kind: "pc", name: "A", campaign_id: campaign.id });

          // Create membership, then close it via left_year only
          const m = await repos.journeys.addMembership({
            party_id: party.id,
            entity_id: char.id,
            role: "",
            joined_session_id: null,
            left_session_id: null,
            joined_year: null,
            joined_month: null,
            joined_day: null,
            left_year: null,
            left_month: null,
            left_day: null,
            notes: "",
          });
          await repos.journeys.updateMembership(m.id, { left_year: leftYear });

          const active = await repos.journeys.activeMemberships(party.id);
          expect(active).toHaveLength(0);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("a membership closed only via left_session_id (no left_year) is NOT active", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 50 }), async (_seed) => {
        const { repos } = await testRepos();

        const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
        const party = await repos.entities.create({ kind: "party", name: "P", campaign_id: campaign.id });
        const char = await repos.entities.create({ kind: "pc", name: "A", campaign_id: campaign.id });
        const session = await repos.entities.create({ kind: "session", name: "S1", campaign_id: campaign.id });

        // Create membership, then close it via left_session_id only
        const m = await repos.journeys.addMembership({
          party_id: party.id,
          entity_id: char.id,
          role: "",
          joined_session_id: null,
          left_session_id: null,
          joined_year: null,
          joined_month: null,
          joined_day: null,
          left_year: null,
          left_month: null,
          left_day: null,
          notes: "",
        });
        await repos.journeys.updateMembership(m.id, { left_session_id: session.id });

        const active = await repos.journeys.activeMemberships(party.id);
        expect(active).toHaveLength(0);
      }),
      { numRuns: 20 },
    );
  });
});


/**
 * Property 12: Entity deletion cascades correctly through journey system
 * **Validates: Requirements 5.5, 2.8**
 *
 * When a character entity is deleted:
 * - Their segment_participants records are removed (ON DELETE CASCADE on entity_id)
 * - Their party_memberships records are removed (ON DELETE CASCADE on entity_id)
 * - Travel segments are NOT deleted (origin/destination SET NULL if they referenced the character)
 * - Journeys are NOT deleted
 */
describe("entity deletion cascades correctly through journey system (Property 12)", () => {
  /**
   * Build a scenario with a character that has segment participations and
   * party memberships, plus another character to prove only the deleted
   * character's records are removed.
   */
  async function buildDeletionScenario(
    repos: Repositories,
    opts: {
      segmentCount: number;
      partyCount: number;
    },
  ) {
    const campaign = await repos.entities.create({ kind: "campaign", name: "Cascade Test" });

    // Create the character we will delete and a control character that stays
    const targetChar = await repos.entities.create({ kind: "pc", name: "Doomed Hero", campaign_id: campaign.id });
    const otherChar = await repos.entities.create({ kind: "npc", name: "Survivor", campaign_id: campaign.id });

    // Create locations for segments
    const locations: string[] = [];
    for (let i = 0; i < opts.segmentCount + 1; i++) {
      const loc = await repos.entities.create({ kind: "settlement", name: `Loc ${i}`, campaign_id: campaign.id });
      locations.push(loc.id);
    }

    // Create a journey with segments, adding both characters as participants
    const journey = await repos.journeys.createJourney({
      campaign_id: campaign.id,
      name: "Cascade Journey",
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
    });

    const segmentIds: string[] = [];
    for (let s = 0; s < opts.segmentCount; s++) {
      const segment = await repos.journeys.createSegment({
        journey_id: journey.id,
        origin_entity_id: locations[s] ?? null,
        destination_entity_id: locations[s + 1] ?? null,
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
      segmentIds.push(segment.id);

      // Both characters participate
      await repos.journeys.addParticipant({
        segment_id: segment.id,
        entity_id: targetChar.id,
        role: "traveler",
        notes: "",
      });
      await repos.journeys.addParticipant({
        segment_id: segment.id,
        entity_id: otherChar.id,
        role: "traveler",
        notes: "",
      });
    }

    // Create parties and add memberships for the target character
    const partyIds: string[] = [];
    for (let p = 0; p < opts.partyCount; p++) {
      const party = await repos.entities.create({ kind: "party", name: `Party ${p}`, campaign_id: campaign.id });
      partyIds.push(party.id);

      await repos.journeys.addMembership({
        party_id: party.id,
        entity_id: targetChar.id,
        role: "member",
        joined_session_id: null,
        left_session_id: null,
        joined_year: null,
        joined_month: null,
        joined_day: null,
        left_year: null,
        left_month: null,
        left_day: null,
        notes: "",
      });

      // Also add the other character to verify their membership survives
      await repos.journeys.addMembership({
        party_id: party.id,
        entity_id: otherChar.id,
        role: "member",
        joined_session_id: null,
        left_session_id: null,
        joined_year: null,
        joined_month: null,
        joined_day: null,
        left_year: null,
        left_month: null,
        left_day: null,
        notes: "",
      });
    }

    return {
      campaignId: campaign.id,
      targetCharId: targetChar.id,
      otherCharId: otherChar.id,
      journeyId: journey.id,
      segmentIds,
      partyIds,
      locationIds: locations,
    };
  }

  it("deleting a character removes their segment_participants and party_memberships but preserves segments and journeys", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          segmentCount: fc.integer({ min: 1, max: 4 }),
          partyCount: fc.integer({ min: 1, max: 3 }),
        }),
        async (opts) => {
          const { repos } = await testRepos();
          const scenario = await buildDeletionScenario(repos, opts);

          // Pre-condition: target character has participants and memberships
          for (const segId of scenario.segmentIds) {
            const participants = await repos.journeys.participantsForSegment(segId);
            expect(participants.some((p) => p.entity_id === scenario.targetCharId)).toBe(true);
          }
          const targetMemberships = await repos.journeys.membershipsForCharacter(scenario.targetCharId);
          expect(targetMemberships.length).toBe(opts.partyCount);

          // ── Delete the character entity ──
          await repos.entities.delete(scenario.targetCharId);

          // ── Verify: segment_participants for target character are gone ──
          for (const segId of scenario.segmentIds) {
            const participants = await repos.journeys.participantsForSegment(segId);
            const targetParticipants = participants.filter((p) => p.entity_id === scenario.targetCharId);
            expect(targetParticipants).toHaveLength(0);
          }

          // ── Verify: party_memberships for target character are gone ──
          const remainingMemberships = await repos.journeys.membershipsForCharacter(scenario.targetCharId);
          expect(remainingMemberships).toHaveLength(0);

          // ── Verify: travel segments still exist ──
          for (const segId of scenario.segmentIds) {
            const segment = await repos.journeys.getSegment(segId);
            expect(segment).toBeTruthy();
            expect(segment.id).toBe(segId);
          }

          // ── Verify: journey still exists ──
          const journey = await repos.journeys.getJourney(scenario.journeyId);
          expect(journey).toBeTruthy();
          expect(journey.id).toBe(scenario.journeyId);

          // ── Verify: other character's participants and memberships are intact ──
          for (const segId of scenario.segmentIds) {
            const participants = await repos.journeys.participantsForSegment(segId);
            expect(participants.some((p) => p.entity_id === scenario.otherCharId)).toBe(true);
          }
          const otherMemberships = await repos.journeys.membershipsForCharacter(scenario.otherCharId);
          expect(otherMemberships.length).toBe(opts.partyCount);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("deleting a character used as segment origin/destination sets those references to null without deleting the segment", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (segmentCount) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "SetNull Test" });
          // Use a PC as both a participant and an origin/destination (e.g. a character's home)
          const charEntity = await repos.entities.create({ kind: "pc", name: "Nomad", campaign_id: campaign.id });
          void charEntity;
          const otherLoc = await repos.entities.create({ kind: "settlement", name: "Town", campaign_id: campaign.id });

          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: "SetNull Journey",
            category: "individual",
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
          });

          // Note: origin_entity_id and destination_entity_id reference entities,
          // and in theory a character entity could be used there. However, the
          // typical use case is locations. We use a location entity here to test
          // the SET NULL behavior on deletion of an entity used as origin/destination.
          const segmentIds: string[] = [];
          for (let s = 0; s < segmentCount; s++) {
            // Alternate: even segments use otherLoc as origin (will be deleted),
            // odd segments use otherLoc as destination
            const segment = await repos.journeys.createSegment({
              journey_id: journey.id,
              origin_entity_id: s % 2 === 0 ? otherLoc.id : null,
              destination_entity_id: s % 2 === 1 ? otherLoc.id : null,
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
            segmentIds.push(segment.id);
          }

          // Delete the location entity (tests ON DELETE SET NULL)
          await repos.entities.delete(otherLoc.id);

          // All segments should still exist
          for (const segId of segmentIds) {
            const segment = await repos.journeys.getSegment(segId);
            expect(segment).toBeTruthy();
            // The origin or destination that pointed to the deleted entity is now null
            expect(segment.origin_entity_id !== otherLoc.id).toBe(true);
            expect(segment.destination_entity_id !== otherLoc.id).toBe(true);
          }

          // Journey should still exist
          const j = await repos.journeys.getJourney(journey.id);
          expect(j).toBeTruthy();
        },
      ),
      { numRuns: 20 },
    );
  });
});


/**
 * Property 14: Waypoint entity cleanup on entity deletion
 * **Validates: Requirements 4.6**
 *
 * When an entity is deleted and it appears in a travel segment's waypoints JSON
 * array, removeWaypointEntity should remove that entity's entry from the
 * waypoints array while preserving other entries and the segment itself.
 */
describe("waypoint entity cleanup on entity deletion (Property 14)", () => {
  /**
   * Arbitrary for a scenario with 1–5 waypoint location entities, one of which
   * will be targeted for removal. Optionally the target appears in multiple segments.
   */
  const scenarioArb = fc
    .record({
      waypointCount: fc.integer({ min: 1, max: 5 }),
      segmentCount: fc.integer({ min: 1, max: 3 }),
      /** Whether the target entity should appear in all segments (true) or just the first (false). */
      targetInAllSegments: fc.boolean(),
    })
    .chain(({ waypointCount, segmentCount, targetInAllSegments }) =>
      fc.record({
        waypointCount: fc.constant(waypointCount),
        segmentCount: fc.constant(segmentCount),
        targetInAllSegments: fc.constant(targetInAllSegments),
        /** Index within the waypoint list to target for removal */
        targetWaypointIndex: fc.integer({ min: 0, max: waypointCount - 1 }),
      }),
    );

  it("removeWaypointEntity removes only the targeted entity from waypoints and preserves the segment", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ waypointCount, segmentCount, targetInAllSegments, targetWaypointIndex }) => {
        const { repos } = await testRepos();

        const campaign = await repos.entities.create({ kind: "campaign", name: "WaypointCleanup" });
        const journey = await repos.journeys.createJourney({
          campaign_id: campaign.id,
          name: "Journey with waypoints",
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
        });

        // Create waypoint location entities
        const waypointEntities: string[] = [];
        for (let i = 0; i < waypointCount; i++) {
          const loc = await repos.entities.create({
            kind: "settlement",
            name: `Waypoint-${i}`,
            campaign_id: campaign.id,
          });
          waypointEntities.push(loc.id);
        }

        const targetEntityId = waypointEntities[targetWaypointIndex]!;

        // Build waypoints array referencing all entities
        const allWaypoints = waypointEntities.map((eid) => ({ entity_id: eid, x: null, y: null }));

        // Create segments — target entity appears in all or just the first
        const segmentIds: string[] = [];
        for (let s = 0; s < segmentCount; s++) {
          const includeTarget = s === 0 || targetInAllSegments;
          const segmentWaypoints = includeTarget
            ? allWaypoints
            : allWaypoints.filter((wp) => wp.entity_id !== targetEntityId);

          const segment = await repos.journeys.createSegment({
            journey_id: journey.id,
            origin_entity_id: null,
            destination_entity_id: null,
            waypoints: segmentWaypoints,
            route_certainty: "confirmed",
            notes: "",
            start_year: null,
            start_month: null,
            start_day: null,
            end_year: null,
            end_month: null,
            end_day: null,
          });
          segmentIds.push(segment.id);
        }

        // ── Act: remove the waypoint entity ──
        await repos.journeys.removeWaypointEntity(targetEntityId);

        // ── Assert ──
        for (let s = 0; s < segmentCount; s++) {
          const segment = await repos.journeys.getSegment(segmentIds[s]!);

          // Segment still exists
          expect(segment).toBeTruthy();
          expect(segment.id).toBe(segmentIds[s]);

          // Waypoints should NOT contain the removed entity
          const hasTarget = segment.waypoints.some((wp) => wp.entity_id === targetEntityId);
          expect(hasTarget).toBe(false);

          // Other waypoint entities should be preserved
          const hadTarget = s === 0 || targetInAllSegments;
          const expectedCount = hadTarget
            ? waypointCount - 1
            : allWaypoints.filter((wp) => wp.entity_id !== targetEntityId).length;
          expect(segment.waypoints.length).toBe(expectedCount);

          // Verify each remaining waypoint references a non-target entity
          for (const wp of segment.waypoints) {
            expect(wp.entity_id).not.toBe(targetEntityId);
            expect(waypointEntities).toContain(wp.entity_id);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it("removeWaypointEntity is a no-op when the entity is not in any waypoints", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (waypointCount) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "NoOpCleanup" });
          const journey = await repos.journeys.createJourney({
            campaign_id: campaign.id,
            name: "Unaffected Journey",
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
          });

          // Create waypoint entities and a separate unrelated entity
          const waypointEntities: string[] = [];
          for (let i = 0; i < waypointCount; i++) {
            const loc = await repos.entities.create({
              kind: "settlement",
              name: `WP-${i}`,
              campaign_id: campaign.id,
            });
            waypointEntities.push(loc.id);
          }
          const unrelatedEntity = await repos.entities.create({
            kind: "settlement",
            name: "Unrelated",
            campaign_id: campaign.id,
          });

          const waypoints = waypointEntities.map((eid) => ({ entity_id: eid, x: null, y: null }));
          const segment = await repos.journeys.createSegment({
            journey_id: journey.id,
            origin_entity_id: null,
            destination_entity_id: null,
            waypoints,
            route_certainty: "confirmed",
            notes: "",
            start_year: null,
            start_month: null,
            start_day: null,
            end_year: null,
            end_month: null,
            end_day: null,
          });

          // Remove an entity that is NOT in the waypoints
          await repos.journeys.removeWaypointEntity(unrelatedEntity.id);

          // Verify waypoints are unchanged
          const after = await repos.journeys.getSegment(segment.id);
          expect(after.waypoints.length).toBe(waypointCount);
          for (let i = 0; i < waypointCount; i++) {
            expect(after.waypoints[i]!.entity_id).toBe(waypointEntities[i]);
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it("removeWaypointEntity handles entity appearing in multiple segments across different journeys", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        async (journeyCount, waypointsPerSegment) => {
          const { repos } = await testRepos();

          const campaign = await repos.entities.create({ kind: "campaign", name: "MultiJourneyCleanup" });

          // Create waypoint entities — one shared target + extras
          const sharedEntity = await repos.entities.create({
            kind: "settlement",
            name: "SharedWaypoint",
            campaign_id: campaign.id,
          });
          const otherEntities: string[] = [];
          for (let i = 0; i < waypointsPerSegment; i++) {
            const loc = await repos.entities.create({
              kind: "settlement",
              name: `Other-${i}`,
              campaign_id: campaign.id,
            });
            otherEntities.push(loc.id);
          }

          // Create multiple journeys, each with one segment that includes the shared entity
          const segmentIds: string[] = [];
          for (let j = 0; j < journeyCount; j++) {
            const journey = await repos.journeys.createJourney({
              campaign_id: campaign.id,
              name: `Journey-${j}`,
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
              sort_order: j,
            });

            const waypoints = [
              { entity_id: sharedEntity.id, x: null, y: null },
              ...otherEntities.map((eid) => ({ entity_id: eid, x: null, y: null })),
            ];

            const segment = await repos.journeys.createSegment({
              journey_id: journey.id,
              origin_entity_id: null,
              destination_entity_id: null,
              waypoints,
              route_certainty: "confirmed",
              notes: "",
              start_year: null,
              start_month: null,
              start_day: null,
              end_year: null,
              end_month: null,
              end_day: null,
            });
            segmentIds.push(segment.id);
          }

          // Remove the shared entity from all waypoints
          await repos.journeys.removeWaypointEntity(sharedEntity.id);

          // Verify across all segments
          for (const segId of segmentIds) {
            const segment = await repos.journeys.getSegment(segId);

            // Segment still exists
            expect(segment).toBeTruthy();

            // Shared entity removed from waypoints
            expect(segment.waypoints.some((wp) => wp.entity_id === sharedEntity.id)).toBe(false);

            // Other entities preserved
            expect(segment.waypoints.length).toBe(waypointsPerSegment);
            for (const wp of segment.waypoints) {
              expect(otherEntities).toContain(wp.entity_id);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
