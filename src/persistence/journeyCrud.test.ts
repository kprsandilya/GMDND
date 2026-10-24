import { describe, expect, it } from "vitest";
import { JourneyRepository, ValidationError } from "./repositories/journeys";
import { NotFoundError } from "./repositories/common";
import { testRepos } from "./testUtils";
import type { JourneyInput, SegmentInput } from "@/domain/journeyTypes";

/** Helper to create a campaign and return its id. */
async function setupCampaign(repos: Awaited<ReturnType<typeof testRepos>>["repos"]) {
  return repos.entities.create({ kind: "campaign", name: "Test Campaign" });
}

/** Minimal valid journey input for a given campaign. */
function baseInput(campaignId: string, overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    campaign_id: campaignId,
    name: "Road to Waterdeep",
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

describe("JourneyRepository — Journey CRUD", () => {
  describe("createJourney", () => {
    it("creates a journey and returns it with generated id and timestamps", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      const journey = await jr.createJourney(baseInput(campaign.id));

      expect(journey.id).toBeTruthy();
      expect(journey.campaign_id).toBe(campaign.id);
      expect(journey.name).toBe("Road to Waterdeep");
      expect(journey.category).toBe("campaign");
      expect(journey.route_certainty).toBe("known");
      expect(journey.description).toBe("");
      expect(journey.dm_notes).toBe("");
      expect(journey.sort_order).toBe(0);
      expect(journey.created_at).toBeTruthy();
      expect(journey.updated_at).toBeTruthy();
    });

    it("trims the journey name", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      const journey = await jr.createJourney(baseInput(campaign.id, { name: "  Trimmed Name  " }));
      expect(journey.name).toBe("Trimmed Name");
    });

    it("stores optional fields correctly", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const session = await repos.entities.create({ kind: "session", name: "Session 1", campaign_id: campaign.id });
      const party = await repos.entities.create({ kind: "party", name: "The Heroes", campaign_id: campaign.id });

      const journey = await jr.createJourney(
        baseInput(campaign.id, {
          session_id: session.id,
          party_id: party.id,
          description: "A long journey",
          dm_notes: "Secret route",
          category: "backstory",
          route_certainty: "approximate",
          start_year: 1492,
          start_month: 3,
          start_day: 15,
          end_year: 1492,
          end_month: 6,
          end_day: null,
          sort_order: 5,
        }),
      );

      expect(journey.session_id).toBe(session.id);
      expect(journey.party_id).toBe(party.id);
      expect(journey.description).toBe("A long journey");
      expect(journey.dm_notes).toBe("Secret route");
      expect(journey.category).toBe("backstory");
      expect(journey.route_certainty).toBe("approximate");
      expect(journey.start_year).toBe(1492);
      expect(journey.start_month).toBe(3);
      expect(journey.start_day).toBe(15);
      expect(journey.end_year).toBe(1492);
      expect(journey.end_month).toBe(6);
      expect(journey.end_day).toBeNull();
      expect(journey.sort_order).toBe(5);
    });

    it("rejects empty name", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { name: "" }))).rejects.toThrow(ValidationError);
    });

    it("rejects whitespace-only name", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { name: "   " }))).rejects.toThrow(ValidationError);
    });

    it("rejects name exceeding 200 characters", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { name: "a".repeat(201) }))).rejects.toThrow(ValidationError);
    });

    it("accepts name at exactly 200 characters", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      const journey = await jr.createJourney(baseInput(campaign.id, { name: "a".repeat(200) }));
      expect(journey.name).toHaveLength(200);
    });

    it("rejects invalid category", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { category: "invalid" as never }))).rejects.toThrow(ValidationError);
    });

    it("rejects invalid route_certainty", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { route_certainty: "fake" as never }))).rejects.toThrow(ValidationError);
    });

    it("rejects invalid month values", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { start_month: 0 }))).rejects.toThrow(ValidationError);
      await expect(jr.createJourney(baseInput(campaign.id, { start_month: 13 }))).rejects.toThrow(ValidationError);
      await expect(jr.createJourney(baseInput(campaign.id, { end_month: 0 }))).rejects.toThrow(ValidationError);
    });

    it("rejects invalid day values", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await expect(jr.createJourney(baseInput(campaign.id, { start_day: 0 }))).rejects.toThrow(ValidationError);
      await expect(jr.createJourney(baseInput(campaign.id, { start_day: 32 }))).rejects.toThrow(ValidationError);
      await expect(jr.createJourney(baseInput(campaign.id, { end_day: 32 }))).rejects.toThrow(ValidationError);
    });

    it("allows all categories", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const categories = ["backstory", "campaign", "individual", "party", "npc", "flashback", "uncertain"] as const;

      for (const category of categories) {
        const j = await jr.createJourney(baseInput(campaign.id, { name: `Journey ${category}`, category }));
        expect(j.category).toBe(category);
      }
    });

    it("allows all route certainties", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const certainties = ["known", "approximate", "unknown"] as const;

      for (const rc of certainties) {
        const j = await jr.createJourney(baseInput(campaign.id, { name: `Journey ${rc}`, route_certainty: rc }));
        expect(j.route_certainty).toBe(rc);
      }
    });
  });

  describe("getJourney", () => {
    it("returns a journey by id", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      const created = await jr.createJourney(baseInput(campaign.id));
      const fetched = await jr.getJourney(created.id);

      expect(fetched).toEqual(created);
    });

    it("throws NotFoundError for missing id", async () => {
      const { driver } = await testRepos();
      const jr = new JourneyRepository(driver);

      await expect(jr.getJourney("nonexistent-id")).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateJourney", () => {
    it("updates journey fields and sets updated_at", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      const updated = await jr.updateJourney(created.id, { name: "New Name", description: "Updated" });

      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("Updated");
      expect(updated.updated_at).toBeTruthy();
      // updated_at should be >= created_at (may be same millisecond in fast tests)
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(created.updated_at).getTime());
      // Unchanged fields remain the same
      expect(updated.category).toBe(created.category);
      expect(updated.campaign_id).toBe(created.campaign_id);
    });

    it("validates name on update", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      await expect(jr.updateJourney(created.id, { name: "" })).rejects.toThrow(ValidationError);
      await expect(jr.updateJourney(created.id, { name: "   " })).rejects.toThrow(ValidationError);
      await expect(jr.updateJourney(created.id, { name: "x".repeat(201) })).rejects.toThrow(ValidationError);
    });

    it("trims name on update", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      const updated = await jr.updateJourney(created.id, { name: "  Trimmed  " });
      expect(updated.name).toBe("Trimmed");
    });

    it("validates category on update", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      await expect(jr.updateJourney(created.id, { category: "bogus" as never })).rejects.toThrow(ValidationError);
    });

    it("validates route_certainty on update", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      await expect(jr.updateJourney(created.id, { route_certainty: "wrong" as never })).rejects.toThrow(ValidationError);
    });

    it("validates date fields on update", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      await expect(jr.updateJourney(created.id, { start_month: 13 })).rejects.toThrow(ValidationError);
      await expect(jr.updateJourney(created.id, { end_day: 0 })).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for missing journey", async () => {
      const { driver } = await testRepos();
      const jr = new JourneyRepository(driver);

      await expect(jr.updateJourney("missing-id", { name: "X" })).rejects.toThrow(NotFoundError);
    });

    it("succeeds with empty patch (no-op)", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      const result = await jr.updateJourney(created.id, {});
      expect(result.name).toBe(created.name);
    });
  });

  describe("deleteJourney", () => {
    it("deletes a journey", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const created = await jr.createJourney(baseInput(campaign.id));

      await jr.deleteJourney(created.id);

      await expect(jr.getJourney(created.id)).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for missing journey", async () => {
      const { driver } = await testRepos();
      const jr = new JourneyRepository(driver);

      await expect(jr.deleteJourney("missing-id")).rejects.toThrow(NotFoundError);
    });
  });

  describe("listJourneys", () => {
    it("lists journeys for a campaign ordered by sort_order then date then created_at", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      const j1 = await jr.createJourney(baseInput(campaign.id, { name: "Journey B", sort_order: 1, start_year: 1500 }));
      const j2 = await jr.createJourney(baseInput(campaign.id, { name: "Journey A", sort_order: 0, start_year: 1490 }));
      const j3 = await jr.createJourney(baseInput(campaign.id, { name: "Journey C", sort_order: 0, start_year: null }));

      const list = await jr.listJourneys(campaign.id);

      // sort_order 0 first, then by start_year (null last among equal sort_order), then sort_order 1
      expect(list[0]!.name).toBe("Journey A"); // sort_order 0, year 1490
      expect(list[1]!.name).toBe("Journey C"); // sort_order 0, year null (sorts after dated)
      expect(list[2]!.name).toBe("Journey B"); // sort_order 1
    });

    it("filters by category", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);

      await jr.createJourney(baseInput(campaign.id, { name: "Campaign J", category: "campaign" }));
      await jr.createJourney(baseInput(campaign.id, { name: "Backstory J", category: "backstory" }));

      const filtered = await jr.listJourneys(campaign.id, { campaignId: campaign.id, category: "backstory" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe("Backstory J");
    });

    it("filters by session_id", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const session = await repos.entities.create({ kind: "session", name: "S1", campaign_id: campaign.id });

      await jr.createJourney(baseInput(campaign.id, { name: "With session", session_id: session.id }));
      await jr.createJourney(baseInput(campaign.id, { name: "No session" }));

      const filtered = await jr.listJourneys(campaign.id, { campaignId: campaign.id, sessionId: session.id });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe("With session");
    });

    it("filters by party_id", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const party = await repos.entities.create({ kind: "party", name: "Adventurers", campaign_id: campaign.id });

      await jr.createJourney(baseInput(campaign.id, { name: "Party J", party_id: party.id }));
      await jr.createJourney(baseInput(campaign.id, { name: "Solo J" }));

      const filtered = await jr.listJourneys(campaign.id, { campaignId: campaign.id, partyId: party.id });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe("Party J");
    });

    it("returns empty for different campaign", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaignA = await repos.entities.create({ kind: "campaign", name: "A" });
      const campaignB = await repos.entities.create({ kind: "campaign", name: "B" });

      await jr.createJourney(baseInput(campaignA.id));

      const list = await jr.listJourneys(campaignB.id);
      expect(list).toHaveLength(0);
    });
  });

  describe("journeysForSession", () => {
    it("returns journeys linked to a session", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const session = await repos.entities.create({ kind: "session", name: "S1", campaign_id: campaign.id });

      await jr.createJourney(baseInput(campaign.id, { name: "Linked", session_id: session.id }));
      await jr.createJourney(baseInput(campaign.id, { name: "Unlinked" }));

      const list = await jr.journeysForSession(session.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe("Linked");
    });
  });

  describe("journeysForParty", () => {
    it("returns journeys linked to a party", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const party = await repos.entities.create({ kind: "party", name: "Heroes", campaign_id: campaign.id });

      await jr.createJourney(baseInput(campaign.id, { name: "Party Journey", party_id: party.id }));
      await jr.createJourney(baseInput(campaign.id, { name: "Solo Journey" }));

      const list = await jr.journeysForParty(party.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe("Party Journey");
    });
  });

  describe("journeysForCharacter", () => {
    it("returns journeys where the character participates in a segment", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const pc = await repos.entities.create({ kind: "pc", name: "Arin", campaign_id: campaign.id });

      // Create a journey with a segment and participant
      const journey = await jr.createJourney(baseInput(campaign.id, { name: "With Arin" }));
      await driver.execute(
        "INSERT INTO travel_segments (id, journey_id, sort_order, waypoints, route_certainty, notes, created_at, updated_at) VALUES (?, ?, 0, '[]', 'confirmed', '', ?, ?)",
        ["seg-1", journey.id, new Date().toISOString(), new Date().toISOString()],
      );
      await driver.execute("INSERT INTO segment_participants (id, segment_id, entity_id, role, notes, created_at) VALUES (?, ?, ?, 'traveler', '', ?)", [
        "sp-1",
        "seg-1",
        pc.id,
        new Date().toISOString(),
      ]);

      // Create another journey without the character
      await jr.createJourney(baseInput(campaign.id, { name: "Without Arin" }));

      const list = await jr.journeysForCharacter(pc.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe("With Arin");
    });

    it("returns empty when character has no segments", async () => {
      const { repos, driver } = await testRepos();
      const jr = new JourneyRepository(driver);
      const campaign = await setupCampaign(repos);
      const pc = await repos.entities.create({ kind: "pc", name: "Loner", campaign_id: campaign.id });

      await jr.createJourney(baseInput(campaign.id));

      const list = await jr.journeysForCharacter(pc.id);
      expect(list).toHaveLength(0);
    });
  });
});


/** Minimal valid segment input for a given journey. */
function baseSegmentInput(journeyId: string, overrides: Partial<SegmentInput> = {}): SegmentInput {
  return {
    journey_id: journeyId,
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
    ...overrides,
  };
}

describe("JourneyRepository — Travel Segment CRUD", () => {
  /** Shared setup: create a campaign and a journey. */
  async function setup() {
    const { repos, driver } = await testRepos();
    const jr = new JourneyRepository(driver);
    const campaign = await repos.entities.create({ kind: "campaign", name: "Test Campaign" });
    const journey = await jr.createJourney(baseInput(campaign.id));
    return { repos, driver, jr, campaign, journey };
  }

  describe("createSegment", () => {
    it("creates a segment and returns it with generated id and timestamps", async () => {
      const { jr, journey } = await setup();

      const segment = await jr.createSegment(baseSegmentInput(journey.id));

      expect(segment.id).toBeTruthy();
      expect(segment.journey_id).toBe(journey.id);
      expect(segment.origin_entity_id).toBeNull();
      expect(segment.destination_entity_id).toBeNull();
      expect(segment.waypoints).toEqual([]);
      expect(segment.route_certainty).toBe("confirmed");
      expect(segment.notes).toBe("");
      expect(segment.sort_order).toBe(0);
      expect(segment.created_at).toBeTruthy();
      expect(segment.updated_at).toBeTruthy();
    });

    it("auto-assigns sort_order incrementally", async () => {
      const { jr, journey } = await setup();

      const s1 = await jr.createSegment(baseSegmentInput(journey.id));
      const s2 = await jr.createSegment(baseSegmentInput(journey.id));
      const s3 = await jr.createSegment(baseSegmentInput(journey.id));

      expect(s1.sort_order).toBe(0);
      expect(s2.sort_order).toBe(1);
      expect(s3.sort_order).toBe(2);
    });

    it("allows explicit sort_order", async () => {
      const { jr, journey } = await setup();

      const segment = await jr.createSegment(baseSegmentInput(journey.id, { sort_order: 10 }));
      expect(segment.sort_order).toBe(10);
    });

    it("stores origin and destination entity ids", async () => {
      const { jr, journey, repos, campaign } = await setup();
      const origin = await repos.entities.create({ kind: "location", name: "Waterdeep", campaign_id: campaign.id });
      const dest = await repos.entities.create({ kind: "location", name: "Neverwinter", campaign_id: campaign.id });

      const segment = await jr.createSegment(
        baseSegmentInput(journey.id, { origin_entity_id: origin.id, destination_entity_id: dest.id }),
      );

      expect(segment.origin_entity_id).toBe(origin.id);
      expect(segment.destination_entity_id).toBe(dest.id);
    });

    it("stores waypoints as JSON", async () => {
      const { jr, journey } = await setup();
      const waypoints = [
        { entity_id: null, x: 100, y: 200 },
        { entity_id: "some-entity", x: null, y: null },
      ];

      const segment = await jr.createSegment(baseSegmentInput(journey.id, { waypoints }));

      expect(segment.waypoints).toEqual(waypoints);
    });

    it("stores date fields", async () => {
      const { jr, journey } = await setup();

      const segment = await jr.createSegment(
        baseSegmentInput(journey.id, {
          start_year: 1492,
          start_month: 3,
          start_day: 15,
          end_year: 1492,
          end_month: 6,
          end_day: 20,
        }),
      );

      expect(segment.start_year).toBe(1492);
      expect(segment.start_month).toBe(3);
      expect(segment.start_day).toBe(15);
      expect(segment.end_year).toBe(1492);
      expect(segment.end_month).toBe(6);
      expect(segment.end_day).toBe(20);
    });

    it("rejects non-existent journey_id", async () => {
      const { jr } = await setup();

      await expect(jr.createSegment(baseSegmentInput("nonexistent-journey"))).rejects.toThrow(NotFoundError);
    });

    it("rejects waypoints exceeding 50 entries", async () => {
      const { jr, journey } = await setup();
      const waypoints = Array.from({ length: 51 }, (_, i) => ({ entity_id: null, x: i, y: i }));

      await expect(jr.createSegment(baseSegmentInput(journey.id, { waypoints }))).rejects.toThrow(ValidationError);
    });

    it("accepts exactly 50 waypoints", async () => {
      const { jr, journey } = await setup();
      const waypoints = Array.from({ length: 50 }, (_, i) => ({ entity_id: null, x: i, y: i }));

      const segment = await jr.createSegment(baseSegmentInput(journey.id, { waypoints }));
      expect(segment.waypoints).toHaveLength(50);
    });

    it("rejects invalid segment certainty", async () => {
      const { jr, journey } = await setup();

      await expect(
        jr.createSegment(baseSegmentInput(journey.id, { route_certainty: "bogus" as never })),
      ).rejects.toThrow(ValidationError);
    });

    it("allows all segment certainties", async () => {
      const { jr, journey } = await setup();
      const certainties = ["confirmed", "estimated", "speculative"] as const;

      for (const rc of certainties) {
        const s = await jr.createSegment(baseSegmentInput(journey.id, { route_certainty: rc }));
        expect(s.route_certainty).toBe(rc);
      }
    });

    it("rejects invalid month values", async () => {
      const { jr, journey } = await setup();

      await expect(jr.createSegment(baseSegmentInput(journey.id, { start_month: 0 }))).rejects.toThrow(ValidationError);
      await expect(jr.createSegment(baseSegmentInput(journey.id, { start_month: 13 }))).rejects.toThrow(ValidationError);
      await expect(jr.createSegment(baseSegmentInput(journey.id, { end_month: 0 }))).rejects.toThrow(ValidationError);
    });

    it("rejects invalid day values", async () => {
      const { jr, journey } = await setup();

      await expect(jr.createSegment(baseSegmentInput(journey.id, { start_day: 0 }))).rejects.toThrow(ValidationError);
      await expect(jr.createSegment(baseSegmentInput(journey.id, { start_day: 32 }))).rejects.toThrow(ValidationError);
      await expect(jr.createSegment(baseSegmentInput(journey.id, { end_day: 32 }))).rejects.toThrow(ValidationError);
    });
  });

  describe("getSegment", () => {
    it("returns a segment by id", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      const fetched = await jr.getSegment(created.id);
      expect(fetched).toEqual(created);
    });

    it("throws NotFoundError for missing id", async () => {
      const { jr } = await setup();

      await expect(jr.getSegment("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateSegment", () => {
    it("updates segment fields and sets updated_at", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      const updated = await jr.updateSegment(created.id, {
        notes: "Updated notes",
        route_certainty: "speculative",
      });

      expect(updated.notes).toBe("Updated notes");
      expect(updated.route_certainty).toBe("speculative");
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(created.updated_at).getTime());
    });

    it("updates waypoints", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      const newWaypoints = [{ entity_id: null, x: 50, y: 75 }];
      const updated = await jr.updateSegment(created.id, { waypoints: newWaypoints });

      expect(updated.waypoints).toEqual(newWaypoints);
    });

    it("validates route_certainty on update", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      await expect(jr.updateSegment(created.id, { route_certainty: "invalid" as never })).rejects.toThrow(ValidationError);
    });

    it("validates waypoints length on update", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));
      const tooMany = Array.from({ length: 51 }, (_, i) => ({ entity_id: null, x: i, y: i }));

      await expect(jr.updateSegment(created.id, { waypoints: tooMany })).rejects.toThrow(ValidationError);
    });

    it("validates date fields on update", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      await expect(jr.updateSegment(created.id, { start_month: 13 })).rejects.toThrow(ValidationError);
      await expect(jr.updateSegment(created.id, { end_day: 0 })).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for missing segment", async () => {
      const { jr } = await setup();

      await expect(jr.updateSegment("missing-id", { notes: "x" })).rejects.toThrow(NotFoundError);
    });

    it("succeeds with empty patch (no-op)", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      const result = await jr.updateSegment(created.id, {});
      expect(result.journey_id).toBe(created.journey_id);
    });
  });

  describe("deleteSegment", () => {
    it("deletes a segment", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      await jr.deleteSegment(created.id);

      await expect(jr.getSegment(created.id)).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for missing segment", async () => {
      const { jr } = await setup();

      await expect(jr.deleteSegment("missing-id")).rejects.toThrow(NotFoundError);
    });

    it("does not delete the parent journey", async () => {
      const { jr, journey } = await setup();
      const created = await jr.createSegment(baseSegmentInput(journey.id));

      await jr.deleteSegment(created.id);

      const j = await jr.getJourney(journey.id);
      expect(j.id).toBe(journey.id);
    });
  });

  describe("listSegments", () => {
    it("lists segments for a journey ordered by sort_order", async () => {
      const { jr, journey } = await setup();

      const s1 = await jr.createSegment(baseSegmentInput(journey.id, { sort_order: 2 }));
      const s2 = await jr.createSegment(baseSegmentInput(journey.id, { sort_order: 0 }));
      const s3 = await jr.createSegment(baseSegmentInput(journey.id, { sort_order: 1 }));

      const list = await jr.listSegments(journey.id);

      expect(list).toHaveLength(3);
      expect(list[0]!.id).toBe(s2.id); // sort_order 0
      expect(list[1]!.id).toBe(s3.id); // sort_order 1
      expect(list[2]!.id).toBe(s1.id); // sort_order 2
    });

    it("returns empty array for journey with no segments", async () => {
      const { jr, journey } = await setup();

      const list = await jr.listSegments(journey.id);
      expect(list).toHaveLength(0);
    });

    it("does not return segments from other journeys", async () => {
      const { jr, journey, campaign } = await setup();
      const otherJourney = await jr.createJourney(baseInput(campaign.id, { name: "Other" }));

      await jr.createSegment(baseSegmentInput(journey.id));
      await jr.createSegment(baseSegmentInput(otherJourney.id));

      const list = await jr.listSegments(journey.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.journey_id).toBe(journey.id);
    });
  });

  describe("reorderSegments", () => {
    it("updates sort_order to match the given id order", async () => {
      const { jr, journey } = await setup();

      const s1 = await jr.createSegment(baseSegmentInput(journey.id));
      const s2 = await jr.createSegment(baseSegmentInput(journey.id));
      const s3 = await jr.createSegment(baseSegmentInput(journey.id));

      // Reverse the order
      await jr.reorderSegments(journey.id, [s3.id, s2.id, s1.id]);

      const list = await jr.listSegments(journey.id);
      expect(list[0]!.id).toBe(s3.id);
      expect(list[0]!.sort_order).toBe(0);
      expect(list[1]!.id).toBe(s2.id);
      expect(list[1]!.sort_order).toBe(1);
      expect(list[2]!.id).toBe(s1.id);
      expect(list[2]!.sort_order).toBe(2);
    });

    it("handles empty orderedIds gracefully", async () => {
      const { jr, journey } = await setup();

      // Should not throw
      await jr.reorderSegments(journey.id, []);
    });
  });
});


describe("JourneyRepository — Segment Participants", () => {
  /** Shared setup: create a campaign, journey, segment, and a PC entity. */
  async function setup() {
    const { repos, driver } = await testRepos();
    const jr = new JourneyRepository(driver);
    const campaign = await repos.entities.create({ kind: "campaign", name: "Test Campaign" });
    const journey = await jr.createJourney(baseInput(campaign.id));
    const segment = await jr.createSegment(baseSegmentInput(journey.id));
    const pc = await repos.entities.create({ kind: "pc", name: "Arin", campaign_id: campaign.id });
    const npc = await repos.entities.create({ kind: "npc", name: "Gandalf", campaign_id: campaign.id });
    return { repos, driver, jr, campaign, journey, segment, pc, npc };
  }

  describe("addParticipant", () => {
    it("creates a participant and returns it with generated id", async () => {
      const { jr, segment, pc } = await setup();

      const participant = await jr.addParticipant({
        segment_id: segment.id,
        entity_id: pc.id,
        role: "scout",
        notes: "Led the way",
      });

      expect(participant.id).toBeTruthy();
      expect(participant.segment_id).toBe(segment.id);
      expect(participant.entity_id).toBe(pc.id);
      expect(participant.role).toBe("scout");
      expect(participant.notes).toBe("Led the way");
      expect(participant.created_at).toBeTruthy();
    });

    it("defaults role to 'traveler' when not provided", async () => {
      const { jr, segment, pc } = await setup();

      const participant = await jr.addParticipant({
        segment_id: segment.id,
        entity_id: pc.id,
        role: "",
        notes: "",
      });

      expect(participant.role).toBe("traveler");
    });

    it("allows NPC entities as participants", async () => {
      const { jr, segment, npc } = await setup();

      const participant = await jr.addParticipant({
        segment_id: segment.id,
        entity_id: npc.id,
        role: "guide",
        notes: "",
      });

      expect(participant.entity_id).toBe(npc.id);
      expect(participant.role).toBe("guide");
    });

    it("rejects entity of non-pc/npc kind", async () => {
      const { jr, segment, repos, campaign } = await setup();
      const location = await repos.entities.create({ kind: "location", name: "Waterdeep", campaign_id: campaign.id });

      await expect(
        jr.addParticipant({ segment_id: segment.id, entity_id: location.id, role: "traveler", notes: "" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects non-existent entity_id", async () => {
      const { jr, segment } = await setup();

      await expect(
        jr.addParticipant({ segment_id: segment.id, entity_id: "nonexistent", role: "traveler", notes: "" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects non-existent segment_id", async () => {
      const { jr, pc } = await setup();

      await expect(
        jr.addParticipant({ segment_id: "nonexistent", entity_id: pc.id, role: "traveler", notes: "" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects duplicate (segment_id, entity_id) with descriptive error", async () => {
      const { jr, segment, pc } = await setup();

      await jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "traveler", notes: "" });

      await expect(
        jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "guide", notes: "" }),
      ).rejects.toThrow(ValidationError);

      await expect(
        jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "guide", notes: "" }),
      ).rejects.toThrow(/already a participant/);
    });

    it("allows same entity on different segments", async () => {
      const { jr, journey, pc } = await setup();
      const segment2 = await jr.createSegment(baseSegmentInput(journey.id));

      const p1 = await jr.addParticipant({ segment_id: (await jr.listSegments(journey.id))[0]!.id, entity_id: pc.id, role: "traveler", notes: "" });
      const p2 = await jr.addParticipant({ segment_id: segment2.id, entity_id: pc.id, role: "traveler", notes: "" });

      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe("removeParticipant", () => {
    it("removes a participant", async () => {
      const { jr, segment, pc } = await setup();
      const participant = await jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "traveler", notes: "" });

      await jr.removeParticipant(participant.id);

      const list = await jr.participantsForSegment(segment.id);
      expect(list).toHaveLength(0);
    });

    it("throws NotFoundError for non-existent id", async () => {
      const { jr } = await setup();

      await expect(jr.removeParticipant("nonexistent")).rejects.toThrow(NotFoundError);
    });

    it("does not affect other participants on the same segment", async () => {
      const { jr, segment, pc, npc } = await setup();
      const p1 = await jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "traveler", notes: "" });
      const p2 = await jr.addParticipant({ segment_id: segment.id, entity_id: npc.id, role: "guide", notes: "" });

      await jr.removeParticipant(p1.id);

      const list = await jr.participantsForSegment(segment.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(p2.id);
    });
  });

  describe("participantsForSegment", () => {
    it("returns participants ordered by created_at", async () => {
      const { jr, segment, pc, npc } = await setup();
      const p1 = await jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "traveler", notes: "" });
      const p2 = await jr.addParticipant({ segment_id: segment.id, entity_id: npc.id, role: "guide", notes: "" });

      const list = await jr.participantsForSegment(segment.id);

      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe(p1.id);
      expect(list[1]!.id).toBe(p2.id);
    });

    it("returns empty array for segment with no participants", async () => {
      const { jr, segment } = await setup();

      const list = await jr.participantsForSegment(segment.id);
      expect(list).toHaveLength(0);
    });

    it("does not return participants from other segments", async () => {
      const { jr, segment, journey, pc, npc } = await setup();
      const segment2 = await jr.createSegment(baseSegmentInput(journey.id));

      await jr.addParticipant({ segment_id: segment.id, entity_id: pc.id, role: "traveler", notes: "" });
      await jr.addParticipant({ segment_id: segment2.id, entity_id: npc.id, role: "guide", notes: "" });

      const list = await jr.participantsForSegment(segment.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.entity_id).toBe(pc.id);
    });
  });
});
