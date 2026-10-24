/**
 * Unit tests for enrichedSegmentsForMap filter logic (RouteFilters).
 *
 * These are persistence-level tests using testRepos() to exercise the
 * repository's actual SQL filter behavior including AND logic, hideAll,
 * and date range filtering.
 *
 * Requirements: 9.4, 11.7
 */
import { describe, expect, it } from "vitest";
import { testRepos } from "./testUtils";
import type { Repositories } from "./repositories";
import type { JourneyCategory } from "@/domain/journeyTypes";

// ── Shared scenario builder ──

interface FilterScenario {
  campaignId: string;
  mapId: string;
  partyA: string;
  partyB: string;
  sessionX: string;
  sessionY: string;
  charAlpha: string;
  charBeta: string;
  charGamma: string;
  /** J1: backstory, partyA, sessionX, [Alpha] */
  j1: string;
  /** J2: campaign, partyA, sessionY, [Alpha, Beta] */
  j2: string;
  /** J3: individual, partyB, sessionX, [Beta] */
  j3: string;
  /** J4: party, partyB, sessionY, [Gamma] */
  j4: string;
  /** J5: backstory, no party, no session, [Alpha, Gamma] */
  j5: string;
  /** J6: campaign, partyA, no session, [Beta, Gamma] */
  j6: string;
}

/**
 * Build a rich scenario with 6 journeys across different categories,
 * parties, sessions, and characters. Each journey gets a segment with
 * locations linked to the map so they appear in enrichedSegmentsForMap.
 */
async function buildFilterScenario(repos: Repositories): Promise<FilterScenario> {
  const campaign = await repos.entities.create({ kind: "campaign", name: "FilterCampaign" });
  const map = await repos.worldMaps.create({ campaign_id: campaign.id, name: "MainMap", seed: "42" });

  // Parties
  const partyA = await repos.entities.create({ kind: "party", name: "Party A", campaign_id: campaign.id });
  const partyB = await repos.entities.create({ kind: "party", name: "Party B", campaign_id: campaign.id });

  // Sessions
  const sessionX = await repos.entities.create({ kind: "session", name: "Session X", campaign_id: campaign.id });
  const sessionY = await repos.entities.create({ kind: "session", name: "Session Y", campaign_id: campaign.id });

  // Characters
  const charAlpha = await repos.entities.create({ kind: "pc", name: "Alpha", campaign_id: campaign.id });
  const charBeta = await repos.entities.create({ kind: "npc", name: "Beta", campaign_id: campaign.id });
  const charGamma = await repos.entities.create({ kind: "pc", name: "Gamma", campaign_id: campaign.id });

  // Create a pool of locations and link them to the map
  const locations: string[] = [];
  for (let i = 0; i < 12; i++) {
    const loc = await repos.entities.create({ kind: "settlement", name: `Town ${i}`, campaign_id: campaign.id });
    locations.push(loc.id);
    await repos.worldMaps.linkFeature({
      map_id: map.id,
      feature_type: "burg",
      feature_id: i + 1,
      feature_name: `Town ${i}`,
      x: i * 100,
      y: i * 50,
      entity_id: loc.id,
    });
  }

  // Journey configs: [name, category, party, session, chars, locPair]
  const configs: {
    name: string;
    category: JourneyCategory;
    partyId: string | null;
    sessionId: string | null;
    chars: string[];
    originLoc: number; // index into locations[]
    destLoc: number;
  }[] = [
      { name: "J1", category: "backstory", partyId: partyA.id, sessionId: sessionX.id, chars: [charAlpha.id], originLoc: 0, destLoc: 1 },
      { name: "J2", category: "campaign", partyId: partyA.id, sessionId: sessionY.id, chars: [charAlpha.id, charBeta.id], originLoc: 2, destLoc: 3 },
      { name: "J3", category: "individual", partyId: partyB.id, sessionId: sessionX.id, chars: [charBeta.id], originLoc: 4, destLoc: 5 },
      { name: "J4", category: "party", partyId: partyB.id, sessionId: sessionY.id, chars: [charGamma.id], originLoc: 6, destLoc: 7 },
      { name: "J5", category: "backstory", partyId: null, sessionId: null, chars: [charAlpha.id, charGamma.id], originLoc: 8, destLoc: 9 },
      { name: "J6", category: "campaign", partyId: partyA.id, sessionId: null, chars: [charBeta.id, charGamma.id], originLoc: 10, destLoc: 11 },
    ];

  const journeyIds: string[] = [];

  for (const cfg of configs) {
    const journey = await repos.journeys.createJourney({
      campaign_id: campaign.id,
      name: cfg.name,
      category: cfg.category,
      route_certainty: "known",
      party_id: cfg.partyId,
      session_id: cfg.sessionId,
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

    const segment = await repos.journeys.createSegment({
      journey_id: journey.id,
      origin_entity_id: locations[cfg.originLoc]!,
      destination_entity_id: locations[cfg.destLoc]!,
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
    mapId: map.id,
    partyA: partyA.id,
    partyB: partyB.id,
    sessionX: sessionX.id,
    sessionY: sessionY.id,
    charAlpha: charAlpha.id,
    charBeta: charBeta.id,
    charGamma: charGamma.id,
    j1: journeyIds[0]!,
    j2: journeyIds[1]!,
    j3: journeyIds[2]!,
    j4: journeyIds[3]!,
    j5: journeyIds[4]!,
    j6: journeyIds[5]!,
  };
}

/** Helper: extract journey IDs from enriched segments (de-duped and sorted for stable comparison). */
function journeyIdsOf(segments: { journey: { id: string } }[]): string[] {
  return [...new Set(segments.map((s) => s.journey.id))].sort();
}

// ── Tests ──

describe("enrichedSegmentsForMap filter logic", () => {
  describe("no filters (baseline)", () => {
    it("returns all segments when no filters are applied", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      const all = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId);
      expect(all).toHaveLength(6); // one segment per journey
      expect(journeyIdsOf(all).sort()).toEqual([s.j1, s.j2, s.j3, s.j4, s.j5, s.j6].sort());
    });

    it("returns all segments when filters object is empty", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      const all = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {});
      expect(all).toHaveLength(6);
    });
  });

  describe("hideAll filter (Req 11.6)", () => {
    it("returns empty results when hideAll is true", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, { hideAll: true });
      expect(result).toHaveLength(0);
    });

    it("returns empty even when other filters would match", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        hideAll: true,
        categories: ["backstory", "campaign"],
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("single-filter selection", () => {
    it("filters by a single character — returns only segments where that character participates", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Alpha participates in J1, J2, J5
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j2, s.j5].sort());
    });

    it("filters by a single party — returns only segments from journeys linked to that party", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Party A: J1, J2, J6
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        partyIds: [s.partyA],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j2, s.j6].sort());
    });

    it("filters by a single session — returns only segments from journeys linked to that session", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Session X: J1, J3
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        sessionIds: [s.sessionX],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j3].sort());
    });

    it("filters by a single category — returns only segments from journeys with that category", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // backstory: J1, J5
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        categories: ["backstory"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j5].sort());
    });

    it("filters by multiple categories (OR within category filter)", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // backstory OR campaign: J1, J2, J5, J6
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        categories: ["backstory", "campaign"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j2, s.j5, s.j6].sort());
    });

    it("filters by multiple characters (OR within character filter)", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Alpha (J1,J2,J5) OR Beta (J2,J3,J6) => J1,J2,J3,J5,J6
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha, s.charBeta],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j2, s.j3, s.j5, s.j6].sort());
    });
  });

  describe("AND logic across filter types (Req 11.7)", () => {
    it("character AND party — narrower than either alone", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Alpha in (J1,J2,J5) AND partyA in (J1,J2,J6) => intersection = J1, J2
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
        partyIds: [s.partyA],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1, s.j2].sort());
    });

    it("character AND session — narrower than either alone", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Alpha in (J1,J2,J5) AND sessionX in (J1,J3) => intersection = J1
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
        sessionIds: [s.sessionX],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j1].sort());
    });

    it("party AND category — narrower than either alone", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // partyA in (J1,J2,J6) AND campaign in (J2,J6) => intersection = J2, J6
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        partyIds: [s.partyA],
        categories: ["campaign"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j2, s.j6].sort());
    });

    it("session AND category — narrower than either alone", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // sessionY in (J2,J4) AND party in (J4) => intersection = J4
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        sessionIds: [s.sessionY],
        categories: ["party"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j4].sort());
    });

    it("three filters combined — character AND party AND category", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Beta in (J2,J3,J6) AND partyA in (J1,J2,J6) AND campaign in (J2,J6)
      // => intersection = J2, J6
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charBeta],
        partyIds: [s.partyA],
        categories: ["campaign"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j2, s.j6].sort());
    });

    it("all four filters combined — character AND party AND session AND category", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Alpha in (J1,J2,J5) AND partyA in (J1,J2,J6) AND sessionY in (J2,J4) AND campaign in (J2,J6)
      // => intersection = J2
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
        partyIds: [s.partyA],
        sessionIds: [s.sessionY],
        categories: ["campaign"],
      });
      expect(journeyIdsOf(result).sort()).toEqual([s.j2].sort());
    });

    it("adding more filters never increases the result set", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Start with one filter
      const byChar = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
      });
      const byCharIds = new Set(journeyIdsOf(byChar));

      // Add party filter — result should be a subset
      const byCharAndParty = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
        partyIds: [s.partyA],
      });
      const byCharAndPartyIds = new Set(journeyIdsOf(byCharAndParty));
      for (const id of byCharAndPartyIds) {
        expect(byCharIds.has(id)).toBe(true);
      }

      // Add session filter — result should be an even narrower subset
      const byThree = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charAlpha],
        partyIds: [s.partyA],
        sessionIds: [s.sessionY],
      });
      const byThreeIds = new Set(journeyIdsOf(byThree));
      for (const id of byThreeIds) {
        expect(byCharAndPartyIds.has(id)).toBe(true);
      }

      expect(byThreeIds.size).toBeLessThanOrEqual(byCharAndPartyIds.size);
      expect(byCharAndPartyIds.size).toBeLessThanOrEqual(byCharIds.size);
    });

    it("returns empty when filter combination matches nothing", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // Gamma in (J4,J5,J6) AND partyA in (J1,J2,J6) AND sessionX in (J1,J3)
      // partyA ∩ sessionX = J1; Gamma is not in J1 => empty
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        characterIds: [s.charGamma],
        partyIds: [s.partyA],
        sessionIds: [s.sessionX],
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("date range filter (Req 11.8)", () => {
    /**
     * Build a scenario with dated journeys for date range tests.
     * J-early:   year 100 → year 200  (backstory)
     * J-mid:     year 300 → year 400  (campaign)
     * J-late:    year 500 → year 600  (individual)
     * J-open:    year 450 → null end  (party, open-ended)
     * J-undated: null dates            (backstory)
     */
    async function buildDatedScenario(repos: Repositories) {
      const campaign = await repos.entities.create({ kind: "campaign", name: "DatedCampaign" });
      const map = await repos.worldMaps.create({ campaign_id: campaign.id, name: "DatedMap", seed: "99" });
      const char = await repos.entities.create({ kind: "pc", name: "Traveler", campaign_id: campaign.id });

      // Create locations
      const locs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const loc = await repos.entities.create({ kind: "settlement", name: `Loc-D${i}`, campaign_id: campaign.id });
        locs.push(loc.id);
        await repos.worldMaps.linkFeature({
          map_id: map.id, feature_type: "burg", feature_id: 100 + i,
          feature_name: `Loc-D${i}`, x: i * 10, y: i * 10, entity_id: loc.id,
        });
      }

      const createDatedJourney = async (
        name: string,
        category: JourneyCategory,
        startYear: number | null,
        endYear: number | null,
        locPair: [number, number],
      ) => {
        const j = await repos.journeys.createJourney({
          campaign_id: campaign.id,
          name,
          category,
          route_certainty: "known",
          party_id: null,
          session_id: null,
          description: "",
          dm_notes: "",
          start_year: startYear,
          start_month: null,
          start_day: null,
          end_year: endYear,
          end_month: null,
          end_day: null,
          sort_order: 0,
        });
        const seg = await repos.journeys.createSegment({
          journey_id: j.id,
          origin_entity_id: locs[locPair[0]]!,
          destination_entity_id: locs[locPair[1]]!,
          waypoints: [],
          route_certainty: "confirmed",
          notes: "",
          start_year: null, start_month: null, start_day: null,
          end_year: null, end_month: null, end_day: null,
        });
        await repos.journeys.addParticipant({ segment_id: seg.id, entity_id: char.id, role: "traveler", notes: "" });
        return j.id;
      };

      const jEarly = await createDatedJourney("J-early", "backstory", 100, 200, [0, 1]);
      const jMid = await createDatedJourney("J-mid", "campaign", 300, 400, [2, 3]);
      const jLate = await createDatedJourney("J-late", "individual", 500, 600, [4, 5]);
      const jOpen = await createDatedJourney("J-open", "party", 450, null, [6, 7]);
      const jUndated = await createDatedJourney("J-undated", "backstory", null, null, [8, 9]);

      return { campaignId: campaign.id, mapId: map.id, jEarly, jMid, jLate, jOpen, jUndated };
    }

    it("startDate excludes journeys that ended before the filter start", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Filter: startDate = year 250
      // J-early ends at 200 (before 250) → excluded
      // J-mid, J-late, J-open have end at or after 250 (or null) → included
      // J-undated has null end → included (NULL means not excluded by startDate check)
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        startDate: { year: 250 },
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).not.toContain(s.jEarly);
      expect(jIds).toContain(s.jMid);
      expect(jIds).toContain(s.jLate);
      expect(jIds).toContain(s.jOpen);
      expect(jIds).toContain(s.jUndated);
    });

    it("endDate excludes journeys that started after the filter end", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Filter: endDate = year 350
      // J-late starts at 500 (after 350) → excluded
      // J-open starts at 450 (after 350) → excluded
      // J-early, J-mid start at or before 350 → included
      // J-undated has null start → included
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        endDate: { year: 350 },
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).toContain(s.jEarly);
      expect(jIds).toContain(s.jMid);
      expect(jIds).not.toContain(s.jLate);
      expect(jIds).not.toContain(s.jOpen);
      expect(jIds).toContain(s.jUndated);
    });

    it("date range selects only overlapping journeys", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Filter: startDate=250, endDate=350
      // Overlap means: journey end >= 250 AND journey start <= 350
      // J-early:  end 200 < 250 → excluded
      // J-mid:    start 300 <= 350 AND end 400 >= 250 → included
      // J-late:   start 500 > 350 → excluded
      // J-open:   start 450 > 350 → excluded
      // J-undated: null dates → included (neither condition excludes it)
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        startDate: { year: 250 },
        endDate: { year: 350 },
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).not.toContain(s.jEarly);
      expect(jIds).toContain(s.jMid);
      expect(jIds).not.toContain(s.jLate);
      expect(jIds).not.toContain(s.jOpen);
      expect(jIds).toContain(s.jUndated);
    });

    it("open-ended journeys are included when their start overlaps the range", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Filter: startDate=400, endDate=500
      // J-open:  start 450 <= 500, end null >= 400 → included
      // J-late:  start 500 <= 500, end 600 >= 400 → included
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        startDate: { year: 400 },
        endDate: { year: 500 },
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).toContain(s.jOpen);
      expect(jIds).toContain(s.jLate);
      expect(jIds).not.toContain(s.jEarly);
    });

    it("undated journeys are always included regardless of date filter", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Even a narrow range should include the undated journey
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        startDate: { year: 999 },
        endDate: { year: 999 },
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).toContain(s.jUndated);
    });

    it("date range filter combines with other filters via AND", async () => {
      const { repos } = await testRepos();
      const s = await buildDatedScenario(repos);

      // Filter: startDate=250, endDate=350, category=backstory
      // Date overlap: J-mid, J-undated (from the range test above)
      // backstory: J-early, J-undated
      // AND: only J-undated satisfies both
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        startDate: { year: 250 },
        endDate: { year: 350 },
        categories: ["backstory"],
      });
      const jIds = journeyIdsOf(result);
      expect(jIds).toEqual([s.jUndated]);
    });

    it("month-level date precision works for filtering", async () => {
      const { repos } = await testRepos();
      const campaign = await repos.entities.create({ kind: "campaign", name: "MonthTest" });
      const map = await repos.worldMaps.create({ campaign_id: campaign.id, name: "MonthMap", seed: "77" });
      const char = await repos.entities.create({ kind: "pc", name: "MonthHero", campaign_id: campaign.id });
      const loc1 = await repos.entities.create({ kind: "settlement", name: "MonthTown1", campaign_id: campaign.id });
      const loc2 = await repos.entities.create({ kind: "settlement", name: "MonthTown2", campaign_id: campaign.id });
      await repos.worldMaps.linkFeature({ map_id: map.id, feature_type: "burg", feature_id: 1, feature_name: "MT1", x: 10, y: 10, entity_id: loc1.id });
      await repos.worldMaps.linkFeature({ map_id: map.id, feature_type: "burg", feature_id: 2, feature_name: "MT2", x: 20, y: 20, entity_id: loc2.id });

      // Journey: year 100, month 6 → year 100, month 9
      const j = await repos.journeys.createJourney({
        campaign_id: campaign.id, name: "MonthJourney", category: "campaign",
        route_certainty: "known", party_id: null, session_id: null,
        description: "", dm_notes: "",
        start_year: 100, start_month: 6, start_day: null,
        end_year: 100, end_month: 9, end_day: null, sort_order: 0,
      });
      const seg = await repos.journeys.createSegment({
        journey_id: j.id, origin_entity_id: loc1.id, destination_entity_id: loc2.id,
        waypoints: [], route_certainty: "confirmed", notes: "",
        start_year: null, start_month: null, start_day: null,
        end_year: null, end_month: null, end_day: null,
      });
      await repos.journeys.addParticipant({ segment_id: seg.id, entity_id: char.id, role: "traveler", notes: "" });

      // startDate month 10 (after journey end month 9) → should exclude
      const excluded = await repos.journeys.enrichedSegmentsForMap(campaign.id, map.id, {
        startDate: { year: 100, month: 10 },
      });
      expect(excluded).toHaveLength(0);

      // startDate month 8 (journey ends month 9, which is >= 8) → should include
      const included = await repos.journeys.enrichedSegmentsForMap(campaign.id, map.id, {
        startDate: { year: 100, month: 8 },
      });
      expect(included).toHaveLength(1);
    });
  });

  describe("enrichment verification", () => {
    it("returned segments include correct coordinate data from map_feature_links", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      const all = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId);
      for (const seg of all) {
        // Every segment in our scenario has mapped origin and destination
        expect(seg.origin_coords).not.toBeNull();
        expect(seg.destination_coords).not.toBeNull();
        expect(typeof seg.origin_coords!.x).toBe("number");
        expect(typeof seg.origin_coords!.y).toBe("number");
      }
    });

    it("returned segments include participant data", async () => {
      const { repos } = await testRepos();
      const s = await buildFilterScenario(repos);

      // J2 has both Alpha and Beta
      const result = await repos.journeys.enrichedSegmentsForMap(s.campaignId, s.mapId, {
        categories: ["campaign"],
        sessionIds: [s.sessionY],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.journey.name).toBe("J2");
      expect(result[0]!.participants.map((p) => p.entity_id).sort()).toEqual(
        [s.charAlpha, s.charBeta].sort(),
      );
    });
  });
});
