import type {
  ConfidenceLevel,
  DmReferenceData,
  EnrichedMembership,
  EnrichedSegment,
  ExtendedTimelineEvent,
  Journey,
  JourneyCategory,
  JourneyFilters,
  JourneyInput,
  JourneyPatch,
  MembershipInput,
  MembershipPatch,
  ParticipantInput,
  PartyMembership,
  RouteCertainty,
  RouteFilters,
  SegmentCertainty,
  SegmentInput,
  SegmentPatch,
  SegmentParticipant,
  TimelineEventCategory,
  TimelineEventParticipant,
  TravelSegment,
  Waypoint,
} from "@/domain/journeyTypes";
import type { ItemInstanceWithDefinition, LinkedEntity } from "@/domain/types";
import { JOURNEY_CATEGORIES, ROUTE_CERTAINTIES, SEGMENT_CERTAINTIES } from "@/domain/journeyTypes";
import type { Row, SqlDriver } from "../driver";
import { NotFoundError, bool, buildSet, newId, now, num, parseJson, requireRow, str, text } from "./common";
import { mapEntity } from "./entities";
import { mapInstance } from "./inventory";
import { validateJourneyName as validateName } from "./journeyValidation";

// ── Validation helpers ──

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Trims and validates a journey name (1–200 chars, non-empty). Throws on invalid input. */
function validateJourneyName(name: string): string {
  const result = validateName(name);
  if (!result.valid) throw new ValidationError(result.error!);
  return result.trimmed;
}

function validateCategory(category: string): JourneyCategory {
  if (!(JOURNEY_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`Invalid journey category: ${category}`);
  }
  return category as JourneyCategory;
}

function validateRouteCertainty(certainty: string): RouteCertainty {
  if (!(ROUTE_CERTAINTIES as readonly string[]).includes(certainty)) {
    throw new ValidationError(`Invalid route certainty: ${certainty}`);
  }
  return certainty as RouteCertainty;
}

function validateDateFields(fields: {
  start_month?: number | null;
  start_day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
}): void {
  if (fields.start_month != null && (fields.start_month < 1 || fields.start_month > 12)) {
    throw new ValidationError("Start month must be between 1 and 12");
  }
  if (fields.start_day != null && (fields.start_day < 1 || fields.start_day > 31)) {
    throw new ValidationError("Start day must be between 1 and 31");
  }
  if (fields.end_month != null && (fields.end_month < 1 || fields.end_month > 12)) {
    throw new ValidationError("End month must be between 1 and 12");
  }
  if (fields.end_day != null && (fields.end_day < 1 || fields.end_day > 31)) {
    throw new ValidationError("End day must be between 1 and 31");
  }
}

function validateSegmentCertainty(certainty: string): SegmentCertainty {
  if (!(SEGMENT_CERTAINTIES as readonly string[]).includes(certainty)) {
    throw new ValidationError(`Invalid segment certainty: ${certainty}`);
  }
  return certainty as SegmentCertainty;
}

function validateWaypoints(waypoints: Waypoint[]): void {
  if (waypoints.length > 50) {
    throw new ValidationError("Waypoints array must not exceed 50 entries");
  }
}

/** Validates that segment_id is not set without a journey_id (Requirement 6.9). */
function validateSegmentJourneyRef(segmentId: string | null | undefined, journeyId: string | null | undefined): void {
  if (segmentId != null && (journeyId == null || journeyId === "")) {
    throw new ValidationError("A segment cannot exist without its parent journey reference");
  }
}

// ── Row mappers ──

function mapSegment(row: Row): TravelSegment {
  return {
    id: String(row.id),
    journey_id: String(row.journey_id),
    origin_entity_id: str(row.origin_entity_id),
    destination_entity_id: str(row.destination_entity_id),
    waypoints: parseJson<Waypoint[]>(row.waypoints, []),
    start_year: num(row.start_year),
    start_month: num(row.start_month),
    start_day: num(row.start_day),
    end_year: num(row.end_year),
    end_month: num(row.end_month),
    end_day: num(row.end_day),
    sort_order: num(row.sort_order) ?? 0,
    route_certainty: String(row.route_certainty) as SegmentCertainty,
    notes: text(row.notes),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

function mapJourney(row: Row): Journey {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    party_id: str(row.party_id),
    session_id: str(row.session_id),
    name: text(row.name),
    category: String(row.category) as JourneyCategory,
    description: text(row.description),
    dm_notes: text(row.dm_notes),
    route_certainty: String(row.route_certainty) as RouteCertainty,
    start_year: num(row.start_year),
    start_month: num(row.start_month),
    start_day: num(row.start_day),
    end_year: num(row.end_year),
    end_month: num(row.end_month),
    end_day: num(row.end_day),
    sort_order: num(row.sort_order) ?? 0,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

function mapMembership(row: Row): PartyMembership {
  return {
    id: String(row.id),
    party_id: String(row.party_id),
    entity_id: String(row.entity_id),
    role: text(row.role),
    joined_session_id: str(row.joined_session_id),
    left_session_id: str(row.left_session_id),
    joined_year: num(row.joined_year),
    joined_month: num(row.joined_month),
    joined_day: num(row.joined_day),
    left_year: num(row.left_year),
    left_month: num(row.left_month),
    left_day: num(row.left_day),
    notes: text(row.notes),
    created_at: text(row.created_at),
  };
}

function mapEnrichedMembership(row: Row): EnrichedMembership {
  return {
    ...mapMembership(row),
    entity_name: text(row.entity_name),
    entity_kind: text(row.entity_kind),
    joined_session_name: str(row.joined_session_name),
    left_session_name: str(row.left_session_name),
  };
}

function mapEventParticipant(row: Row): TimelineEventParticipant {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    entity_id: String(row.entity_id),
    role: text(row.role),
    created_at: text(row.created_at),
  };
}

function mapExtendedTimelineEvent(row: Row): ExtendedTimelineEvent {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    entity_id: str(row.entity_id),
    title: text(row.title),
    body_md: text(row.body_md),
    year: num(row.year),
    month: num(row.month),
    day: num(row.day),
    kind: String(row.kind),
    secret: bool(row.secret),
    category: (str(row.category) ?? "general") as TimelineEventCategory,
    session_id: str(row.session_id),
    journey_id: str(row.journey_id),
    segment_id: str(row.segment_id),
    location_id: str(row.location_id),
    confidence: (str(row.confidence) ?? "certain") as ConfidenceLevel,
    manual_order: num(row.manual_order) ?? 0,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

function mapParticipant(row: Row): SegmentParticipant {
  return {
    id: String(row.id),
    segment_id: String(row.segment_id),
    entity_id: String(row.entity_id),
    role: text(row.role),
    notes: text(row.notes),
    created_at: text(row.created_at),
  };
}

// ── Repository ──

export class JourneyRepository {
  constructor(private readonly db: SqlDriver) { }

  // ── Journeys ──

  async createJourney(input: JourneyInput): Promise<Journey> {
    const name = validateJourneyName(input.name);
    const category = validateCategory(input.category);
    const routeCertainty = validateRouteCertainty(input.route_certainty);
    validateDateFields(input);

    const id = input.id ?? newId();
    const ts = now();

    await this.db.execute(
      `INSERT INTO journeys (id, campaign_id, party_id, session_id, name, category, description, dm_notes, route_certainty, start_year, start_month, start_day, end_year, end_month, end_day, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.campaign_id,
        input.party_id ?? null,
        input.session_id ?? null,
        name,
        category,
        input.description ?? "",
        input.dm_notes ?? "",
        routeCertainty,
        input.start_year ?? null,
        input.start_month ?? null,
        input.start_day ?? null,
        input.end_year ?? null,
        input.end_month ?? null,
        input.end_day ?? null,
        input.sort_order ?? 0,
        ts,
        ts,
      ],
    );

    return this.getJourney(id);
  }

  async getJourney(id: string): Promise<Journey> {
    const rows = await this.db.select("SELECT * FROM journeys WHERE id = ?", [id]);
    return mapJourney(requireRow(rows, "Journey", id));
  }

  async updateJourney(id: string, patch: JourneyPatch): Promise<Journey> {
    // Validate fields if provided
    if (patch.name !== undefined) {
      patch = { ...patch, name: validateJourneyName(patch.name) };
    }
    if (patch.category !== undefined) {
      validateCategory(patch.category);
    }
    if (patch.route_certainty !== undefined) {
      validateRouteCertainty(patch.route_certainty);
    }
    validateDateFields({
      start_month: patch.start_month,
      start_day: patch.start_day,
      end_month: patch.end_month,
      end_day: patch.end_day,
    });

    const { set, params, empty } = buildSet({ ...patch, updated_at: now() });
    if (!empty) {
      const result = await this.db.execute(`UPDATE journeys SET ${set} WHERE id = ?`, [...params, id]);
      if (result.changes === 0) throw new NotFoundError("Journey", id);
    } else {
      // Even with an empty patch, verify the journey exists
      await this.getJourney(id);
    }

    return this.getJourney(id);
  }

  async deleteJourney(id: string): Promise<void> {
    // Verify existence first — throws NotFoundError if missing
    await this.getJourney(id);
    await this.db.execute("DELETE FROM journeys WHERE id = ?", [id]);
  }

  async listJourneys(campaignId: string, filters?: JourneyFilters): Promise<Journey[]> {
    const conditions: string[] = ["j.campaign_id = ?"];
    const params: (string | number | boolean | null)[] = [campaignId];
    let needsJoin = false;

    if (filters?.category) {
      conditions.push("j.category = ?");
      params.push(filters.category);
    }
    if (filters?.sessionId) {
      conditions.push("j.session_id = ?");
      params.push(filters.sessionId);
    }
    if (filters?.partyId) {
      conditions.push("j.party_id = ?");
      params.push(filters.partyId);
    }
    if (filters?.characterId) {
      needsJoin = true;
      conditions.push("sp.entity_id = ?");
      params.push(filters.characterId);
    }

    const joinClause = needsJoin
      ? "JOIN travel_segments ts ON ts.journey_id = j.id JOIN segment_participants sp ON sp.segment_id = ts.id"
      : "";
    const distinct = needsJoin ? "DISTINCT" : "";

    const rows = await this.db.select(
      `SELECT ${distinct} j.* FROM journeys j ${joinClause} WHERE ${conditions.join(" AND ")} ORDER BY j.sort_order, j.start_year IS NULL, j.start_year, j.created_at`,
      params,
    );
    return rows.map(mapJourney);
  }

  async journeysForSession(sessionId: string): Promise<Journey[]> {
    const rows = await this.db.select("SELECT * FROM journeys WHERE session_id = ? ORDER BY sort_order, created_at", [sessionId]);
    return rows.map(mapJourney);
  }

  async journeysForParty(partyId: string): Promise<Journey[]> {
    const rows = await this.db.select("SELECT * FROM journeys WHERE party_id = ? ORDER BY sort_order, created_at", [partyId]);
    return rows.map(mapJourney);
  }

  async journeysForCharacter(entityId: string): Promise<Journey[]> {
    const rows = await this.db.select(
      `SELECT DISTINCT j.* FROM journeys j
       JOIN travel_segments ts ON ts.journey_id = j.id
       JOIN segment_participants sp ON sp.segment_id = ts.id
       WHERE sp.entity_id = ?
       ORDER BY j.sort_order, j.created_at`,
      [entityId],
    );
    return rows.map(mapJourney);
  }

  // ── Travel Segments ──

  async createSegment(input: SegmentInput): Promise<TravelSegment> {
    // Validate journey exists
    const journeyRows = await this.db.select("SELECT id FROM journeys WHERE id = ?", [input.journey_id]);
    if (journeyRows.length === 0) throw new NotFoundError("Journey", input.journey_id);

    // Validate waypoints
    const waypoints = input.waypoints ?? [];
    validateWaypoints(waypoints);

    // Validate segment-level route certainty
    const routeCertainty = validateSegmentCertainty(input.route_certainty);

    // Validate date fields
    validateDateFields({
      start_month: input.start_month,
      start_day: input.start_day,
      end_month: input.end_month,
      end_day: input.end_day,
    });

    // Auto-assign sort_order
    let sortOrder = input.sort_order;
    if (sortOrder === undefined || sortOrder === null) {
      const maxRows = await this.db.select(
        "SELECT MAX(sort_order) as max_order FROM travel_segments WHERE journey_id = ?",
        [input.journey_id],
      );
      const maxOrder = num(maxRows[0]?.max_order);
      sortOrder = maxOrder !== null ? maxOrder + 1 : 0;
    }

    const id = input.id ?? newId();
    const ts = now();

    await this.db.execute(
      `INSERT INTO travel_segments (id, journey_id, origin_entity_id, destination_entity_id, waypoints, start_year, start_month, start_day, end_year, end_month, end_day, sort_order, route_certainty, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.journey_id,
        input.origin_entity_id ?? null,
        input.destination_entity_id ?? null,
        JSON.stringify(waypoints),
        input.start_year ?? null,
        input.start_month ?? null,
        input.start_day ?? null,
        input.end_year ?? null,
        input.end_month ?? null,
        input.end_day ?? null,
        sortOrder,
        routeCertainty,
        input.notes ?? "",
        ts,
        ts,
      ],
    );

    return this.getSegment(id);
  }

  async getSegment(id: string): Promise<TravelSegment> {
    const rows = await this.db.select("SELECT * FROM travel_segments WHERE id = ?", [id]);
    return mapSegment(requireRow(rows, "TravelSegment", id));
  }

  async updateSegment(id: string, patch: SegmentPatch): Promise<TravelSegment> {
    // Validate fields if provided
    if (patch.route_certainty !== undefined) {
      validateSegmentCertainty(patch.route_certainty);
    }
    if (patch.waypoints !== undefined) {
      validateWaypoints(patch.waypoints);
    }
    validateDateFields({
      start_month: patch.start_month,
      start_day: patch.start_day,
      end_month: patch.end_month,
      end_day: patch.end_day,
    });

    const serialized: Record<string, unknown> = { ...patch, updated_at: now() };
    // Serialize waypoints to JSON string if provided
    if (patch.waypoints !== undefined) {
      serialized.waypoints = JSON.stringify(patch.waypoints);
    }

    const { set, params, empty } = buildSet(serialized);
    if (!empty) {
      const result = await this.db.execute(`UPDATE travel_segments SET ${set} WHERE id = ?`, [...params, id]);
      if (result.changes === 0) throw new NotFoundError("TravelSegment", id);
    } else {
      // Even with an empty patch, verify the segment exists
      await this.getSegment(id);
    }

    return this.getSegment(id);
  }

  async deleteSegment(id: string): Promise<void> {
    // Verify existence first — throws NotFoundError if missing
    await this.getSegment(id);
    await this.db.execute("DELETE FROM travel_segments WHERE id = ?", [id]);
  }

  async listSegments(journeyId: string): Promise<TravelSegment[]> {
    const rows = await this.db.select(
      "SELECT * FROM travel_segments WHERE journey_id = ? ORDER BY sort_order",
      [journeyId],
    );
    return rows.map(mapSegment);
  }

  async reorderSegments(journeyId: string, orderedIds: string[]): Promise<void> {
    const statements = orderedIds.map((id, index) => ({
      sql: "UPDATE travel_segments SET sort_order = ?, updated_at = ? WHERE id = ? AND journey_id = ?",
      params: [index, now(), id, journeyId] as (string | number | boolean | null)[],
    }));
    await this.db.batch(statements);
  }

  /** Reorder journeys within a campaign by setting sequential sort_order values. */
  async reorderJourneys(campaignId: string, orderedIds: string[]): Promise<void> {
    const statements = orderedIds.map((id, index) => ({
      sql: "UPDATE journeys SET sort_order = ?, updated_at = ? WHERE id = ? AND campaign_id = ?",
      params: [index, now(), id, campaignId] as (string | number | boolean | null)[],
    }));
    await this.db.batch(statements);
  }

  // ── Segment Participants ──

  async addParticipant(input: ParticipantInput): Promise<SegmentParticipant> {
    // Validate entity exists and kind is a character-like entity
    const entityRows = await this.db.select("SELECT kind FROM entities WHERE id = ?", [input.entity_id]);
    if (entityRows.length === 0) {
      throw new ValidationError(`Entity not found: ${input.entity_id}`);
    }
    const kind = String(entityRows[0].kind);
    if (kind !== "pc" && kind !== "npc" && kind !== "creature") {
      throw new ValidationError(`Entity must be of kind pc, npc, or creature, got: ${kind}`);
    }

    // Validate segment exists
    const segmentRows = await this.db.select("SELECT id FROM travel_segments WHERE id = ?", [input.segment_id]);
    if (segmentRows.length === 0) {
      throw new NotFoundError("TravelSegment", input.segment_id);
    }

    const id = input.id ?? newId();
    const role = input.role || "traveler";
    const ts = now();

    try {
      await this.db.execute(
        `INSERT INTO segment_participants (id, segment_id, entity_id, role, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.segment_id, input.entity_id, role, input.notes ?? "", ts],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message) || /unique/i.test(message)) {
        throw new ValidationError("Character is already a participant on this segment");
      }
      throw error;
    }

    const rows = await this.db.select("SELECT * FROM segment_participants WHERE id = ?", [id]);
    return mapParticipant(requireRow(rows, "SegmentParticipant", id));
  }

  async removeParticipant(id: string): Promise<void> {
    const result = await this.db.execute("DELETE FROM segment_participants WHERE id = ?", [id]);
    if (result.changes === 0) throw new NotFoundError("SegmentParticipant", id);
  }

  async participantsForSegment(segmentId: string): Promise<SegmentParticipant[]> {
    const rows = await this.db.select(
      "SELECT * FROM segment_participants WHERE segment_id = ? ORDER BY created_at",
      [segmentId],
    );
    return rows.map(mapParticipant);
  }

  // ── Party Memberships ──

  async addMembership(input: MembershipInput): Promise<PartyMembership> {
    // Requirement 2.11: reject if character already has an active membership in the same party
    const active = await this.hasActiveMembership(input.party_id, input.entity_id);
    if (active) {
      throw new ValidationError("Character is already an active member of this party");
    }

    // Validate role length
    if (input.role && input.role.length > 100) {
      throw new ValidationError("Membership role must be 100 characters or fewer");
    }

    const id = input.id ?? newId();
    const ts = now();

    await this.db.execute(
      `INSERT INTO party_memberships (id, party_id, entity_id, role, joined_session_id, left_session_id, joined_year, joined_month, joined_day, left_year, left_month, left_day, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.party_id,
        input.entity_id,
        input.role ?? "",
        input.joined_session_id ?? null,
        input.left_session_id ?? null,
        input.joined_year ?? null,
        input.joined_month ?? null,
        input.joined_day ?? null,
        input.left_year ?? null,
        input.left_month ?? null,
        input.left_day ?? null,
        input.notes ?? "",
        ts,
      ],
    );

    return this.getMembership(id);
  }

  async getMembership(id: string): Promise<PartyMembership> {
    const rows = await this.db.select("SELECT * FROM party_memberships WHERE id = ?", [id]);
    return mapMembership(requireRow(rows, "PartyMembership", id));
  }

  async updateMembership(id: string, patch: MembershipPatch): Promise<PartyMembership> {
    // Validate role length if provided
    if (patch.role !== undefined && patch.role.length > 100) {
      throw new ValidationError("Membership role must be 100 characters or fewer");
    }

    const { set, params, empty } = buildSet(patch);
    if (!empty) {
      const result = await this.db.execute(`UPDATE party_memberships SET ${set} WHERE id = ?`, [...params, id]);
      if (result.changes === 0) throw new NotFoundError("PartyMembership", id);
    } else {
      // Even with an empty patch, verify the membership exists
      await this.getMembership(id);
    }

    return this.getMembership(id);
  }

  async removeMembership(id: string): Promise<void> {
    const result = await this.db.execute("DELETE FROM party_memberships WHERE id = ?", [id]);
    if (result.changes === 0) throw new NotFoundError("PartyMembership", id);
  }

  async membershipsForParty(partyId: string): Promise<EnrichedMembership[]> {
    const rows = await this.db.select(
      `SELECT pm.*, e.name as entity_name, e.kind as entity_kind,
              js.name as joined_session_name, ls.name as left_session_name
       FROM party_memberships pm
       JOIN entities e ON e.id = pm.entity_id
       LEFT JOIN entities js ON js.id = pm.joined_session_id
       LEFT JOIN entities ls ON ls.id = pm.left_session_id
       WHERE pm.party_id = ?
       ORDER BY pm.joined_year IS NULL, pm.joined_year, pm.created_at`,
      [partyId],
    );
    return rows.map(mapEnrichedMembership);
  }

  async membershipsForCharacter(entityId: string): Promise<PartyMembership[]> {
    const rows = await this.db.select(
      "SELECT * FROM party_memberships WHERE entity_id = ? ORDER BY created_at",
      [entityId],
    );
    return rows.map(mapMembership);
  }

  async activeMemberships(partyId: string): Promise<EnrichedMembership[]> {
    const rows = await this.db.select(
      `SELECT pm.*, e.name as entity_name, e.kind as entity_kind,
              js.name as joined_session_name, ls.name as left_session_name
       FROM party_memberships pm
       JOIN entities e ON e.id = pm.entity_id
       LEFT JOIN entities js ON js.id = pm.joined_session_id
       LEFT JOIN entities ls ON ls.id = pm.left_session_id
       WHERE pm.party_id = ? AND pm.left_session_id IS NULL AND pm.left_year IS NULL
       ORDER BY pm.joined_year IS NULL, pm.joined_year, pm.created_at`,
      [partyId],
    );
    return rows.map(mapEnrichedMembership);
  }

  async membershipAtSession(partyId: string, sessionId: string): Promise<EnrichedMembership[]> {
    const rows = await this.db.select(
      `SELECT pm.*, e.name as entity_name, e.kind as entity_kind,
              js.name as joined_session_name, ls.name as left_session_name
       FROM party_memberships pm
       JOIN entities e ON e.id = pm.entity_id
       LEFT JOIN entities js ON js.id = pm.joined_session_id
       LEFT JOIN entities ls ON ls.id = pm.left_session_id
       JOIN entities qs ON qs.id = ?
       WHERE pm.party_id = ?
         AND (pm.joined_session_id IS NULL OR js.sort_order <= qs.sort_order)
         AND (pm.left_session_id IS NULL OR ls.sort_order >= qs.sort_order)
       ORDER BY pm.joined_year IS NULL, pm.joined_year, pm.created_at`,
      [sessionId, partyId],
    );
    return rows.map(mapEnrichedMembership);
  }

  async membershipAtDate(partyId: string, year: number, month?: number, day?: number): Promise<EnrichedMembership[]> {
    // A partial date spans the entire calendar period it represents.
    // E.g. year-only means "any time during that year", year+month means "any time during that month".
    // A membership is included if its joined date is at or before the query date
    // and its left date is null or at or after the query date.
    const rows = await this.db.select(
      `SELECT pm.*, e.name as entity_name, e.kind as entity_kind,
              js.name as joined_session_name, ls.name as left_session_name
       FROM party_memberships pm
       JOIN entities e ON e.id = pm.entity_id
       LEFT JOIN entities js ON js.id = pm.joined_session_id
       LEFT JOIN entities ls ON ls.id = pm.left_session_id
       WHERE pm.party_id = ?
         AND (
           pm.joined_year IS NULL
           OR pm.joined_year < ?
           OR (pm.joined_year = ? AND (? IS NULL OR pm.joined_month IS NULL OR pm.joined_month < ? OR (pm.joined_month = ? AND (? IS NULL OR pm.joined_day IS NULL OR pm.joined_day <= ?))))
         )
         AND (
           pm.left_year IS NULL
           OR pm.left_year > ?
           OR (pm.left_year = ? AND (? IS NULL OR pm.left_month IS NULL OR pm.left_month > ? OR (pm.left_month = ? AND (? IS NULL OR pm.left_day IS NULL OR pm.left_day >= ?))))
         )
       ORDER BY pm.joined_year IS NULL, pm.joined_year, pm.created_at`,
      [
        partyId,
        // joined date <= query date
        year, year, month ?? null, month ?? null, month ?? null, day ?? null, day ?? null,
        // left date >= query date (or null)
        year, year, month ?? null, month ?? null, month ?? null, day ?? null, day ?? null,
      ],
    );
    return rows.map(mapEnrichedMembership);
  }

  async hasActiveMembership(partyId: string, entityId: string): Promise<boolean> {
    const rows = await this.db.select(
      `SELECT COUNT(*) as cnt FROM party_memberships
       WHERE party_id = ? AND entity_id = ? AND left_session_id IS NULL AND left_year IS NULL`,
      [partyId, entityId],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  // ── Timeline Event Participants ──

  async addEventParticipant(eventId: string, entityId: string, role?: string): Promise<TimelineEventParticipant> {
    const id = newId();
    const ts = now();
    const resolvedRole = role ?? "";

    try {
      await this.db.execute(
        `INSERT INTO timeline_event_participants (id, event_id, entity_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, eventId, entityId, resolvedRole, ts],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message) || /unique/i.test(message)) {
        throw new ValidationError("Character already participates in this event with the same role");
      }
      throw error;
    }

    const rows = await this.db.select("SELECT * FROM timeline_event_participants WHERE id = ?", [id]);
    return mapEventParticipant(requireRow(rows, "TimelineEventParticipant", id));
  }

  async removeEventParticipant(id: string): Promise<void> {
    const result = await this.db.execute("DELETE FROM timeline_event_participants WHERE id = ?", [id]);
    if (result.changes === 0) throw new NotFoundError("TimelineEventParticipant", id);
  }

  async eventParticipants(eventId: string): Promise<TimelineEventParticipant[]> {
    const rows = await this.db.select(
      "SELECT * FROM timeline_event_participants WHERE event_id = ? ORDER BY created_at",
      [eventId],
    );
    return rows.map(mapEventParticipant);
  }

  async eventsForCharacter(entityId: string): Promise<ExtendedTimelineEvent[]> {
    const rows = await this.db.select(
      `SELECT DISTINCT te.* FROM timeline_events te
       LEFT JOIN timeline_event_participants tep ON tep.event_id = te.id
       WHERE te.entity_id = ? OR tep.entity_id = ?
       ORDER BY te.manual_order ASC, te.year IS NULL, te.year, te.month IS NULL, te.month, te.day IS NULL, te.day, te.created_at`,
      [entityId, entityId],
    );
    return rows.map(mapExtendedTimelineEvent);
  }

  async eventsForSegments(segmentIds: string[]): Promise<Record<string, ExtendedTimelineEvent[]>> {
    if (segmentIds.length === 0) return {};
    const placeholders = segmentIds.map(() => "?").join(",");
    const rows = await this.db.select(
      `SELECT * FROM timeline_events WHERE segment_id IN (${placeholders})
       ORDER BY manual_order ASC, year IS NULL, year, month IS NULL, month, day IS NULL, day, created_at`,
      segmentIds,
    );
    const result: Record<string, ExtendedTimelineEvent[]> = {};
    for (const row of rows) {
      const event = mapExtendedTimelineEvent(row);
      const segId = event.segment_id!;
      if (!result[segId]) result[segId] = [];
      result[segId].push(event);
    }
    return result;
  }

  // ── Validation helpers (for future timeline event create/update) ──

  /** Validates Requirement 6.9: segment_id requires a non-null journey_id. */
  validateSegmentJourneyRef(segmentId: string | null | undefined, journeyId: string | null | undefined): void {
    validateSegmentJourneyRef(segmentId, journeyId);
  }

  // ── Enriched Queries ──

  /** Look up (x, y) for an entity on a specific map. */
  private async lookupCoords(entityId: string, mapId: string): Promise<{ x: number; y: number } | null> {
    const rows = await this.db.select(
      "SELECT x, y FROM map_feature_links WHERE entity_id = ? AND map_id = ? LIMIT 1",
      [entityId, mapId],
    );
    const row = rows[0];
    if (!row) return null;
    const x = num(row.x);
    const y = num(row.y);
    if (x == null || y == null) return null;
    return { x, y };
  }

  /** Look up (x, y) for an entity on any map (first match). */
  private async lookupCoordsAnyMap(entityId: string): Promise<{ x: number; y: number } | null> {
    const rows = await this.db.select(
      "SELECT x, y FROM map_feature_links WHERE entity_id = ? LIMIT 1",
      [entityId],
    );
    const row = rows[0];
    if (!row) return null;
    const x = num(row.x);
    const y = num(row.y);
    if (x == null || y == null) return null;
    return { x, y };
  }

  async enrichedSegmentsForMap(campaignId: string, mapId: string, filters?: RouteFilters): Promise<EnrichedSegment[]> {
    if (filters?.hideAll) return [];

    const conditions: string[] = ["j.campaign_id = ?"];
    const params: (string | number | boolean | null)[] = [campaignId];
    let needsParticipantJoin = false;

    if (filters?.characterIds && filters.characterIds.length > 0) {
      needsParticipantJoin = true;
      const placeholders = filters.characterIds.map(() => "?").join(", ");
      conditions.push(`sp_filter.entity_id IN (${placeholders})`);
      params.push(...filters.characterIds);
    }

    if (filters?.partyIds && filters.partyIds.length > 0) {
      const placeholders = filters.partyIds.map(() => "?").join(", ");
      conditions.push(`j.party_id IN (${placeholders})`);
      params.push(...filters.partyIds);
    }

    if (filters?.sessionIds && filters.sessionIds.length > 0) {
      const placeholders = filters.sessionIds.map(() => "?").join(", ");
      conditions.push(`j.session_id IN (${placeholders})`);
      params.push(...filters.sessionIds);
    }

    if (filters?.categories && filters.categories.length > 0) {
      const placeholders = filters.categories.map(() => "?").join(", ");
      conditions.push(`j.category IN (${placeholders})`);
      params.push(...filters.categories);
    }

    if (filters?.startDate) {
      // Journey must overlap with or be after startDate
      const sd = filters.startDate;
      if (sd.day != null && sd.month != null) {
        conditions.push(
          `(j.end_year IS NULL OR j.end_year > ? OR (j.end_year = ? AND (j.end_month IS NULL OR j.end_month > ? OR (j.end_month = ? AND (j.end_day IS NULL OR j.end_day >= ?)))))`,
        );
        params.push(sd.year, sd.year, sd.month, sd.month, sd.day);
      } else if (sd.month != null) {
        conditions.push(
          `(j.end_year IS NULL OR j.end_year > ? OR (j.end_year = ? AND (j.end_month IS NULL OR j.end_month >= ?)))`,
        );
        params.push(sd.year, sd.year, sd.month);
      } else {
        conditions.push(`(j.end_year IS NULL OR j.end_year >= ?)`);
        params.push(sd.year);
      }
    }

    if (filters?.endDate) {
      // Journey must overlap with or be before endDate
      const ed = filters.endDate;
      if (ed.day != null && ed.month != null) {
        conditions.push(
          `(j.start_year IS NULL OR j.start_year < ? OR (j.start_year = ? AND (j.start_month IS NULL OR j.start_month < ? OR (j.start_month = ? AND (j.start_day IS NULL OR j.start_day <= ?)))))`,
        );
        params.push(ed.year, ed.year, ed.month, ed.month, ed.day);
      } else if (ed.month != null) {
        conditions.push(
          `(j.start_year IS NULL OR j.start_year < ? OR (j.start_year = ? AND (j.start_month IS NULL OR j.start_month <= ?)))`,
        );
        params.push(ed.year, ed.year, ed.month);
      } else {
        conditions.push(`(j.start_year IS NULL OR j.start_year <= ?)`);
        params.push(ed.year);
      }
    }

    const participantJoin = needsParticipantJoin
      ? "JOIN segment_participants sp_filter ON sp_filter.segment_id = ts.id"
      : "";
    const distinct = needsParticipantJoin ? "DISTINCT" : "";

    const rows = await this.db.select(
      `SELECT ${distinct} ts.*, j.id AS j_id, j.campaign_id AS j_campaign_id, j.party_id AS j_party_id,
              j.session_id AS j_session_id, j.name AS j_name, j.category AS j_category,
              j.description AS j_description, j.dm_notes AS j_dm_notes,
              j.route_certainty AS j_route_certainty,
              j.start_year AS j_start_year, j.start_month AS j_start_month, j.start_day AS j_start_day,
              j.end_year AS j_end_year, j.end_month AS j_end_month, j.end_day AS j_end_day,
              j.sort_order AS j_sort_order, j.created_at AS j_created_at, j.updated_at AS j_updated_at
       FROM travel_segments ts
       JOIN journeys j ON j.id = ts.journey_id
       ${participantJoin}
       WHERE ${conditions.join(" AND ")}
       ORDER BY j.start_year IS NULL, j.start_year, j.sort_order, ts.sort_order`,
      params,
    );

    // Re-map rows to have journey fields at the top level for mapJourney
    const remapped = rows.map((row) => ({
      ...row,
      // Preserve segment fields as-is (they use the original column names)
      // Override journey fields for mapJourney
      j_row: {
        id: row.j_id,
        campaign_id: row.j_campaign_id,
        party_id: row.j_party_id,
        session_id: row.j_session_id,
        name: row.j_name,
        category: row.j_category,
        description: row.j_description,
        dm_notes: row.j_dm_notes,
        route_certainty: row.j_route_certainty,
        start_year: row.j_start_year,
        start_month: row.j_start_month,
        start_day: row.j_start_day,
        end_year: row.j_end_year,
        end_month: row.j_end_month,
        end_day: row.j_end_day,
        sort_order: row.j_sort_order,
        created_at: row.j_created_at,
        updated_at: row.j_updated_at,
      },
    }));

    return this.enrichSegmentsFromAliased(remapped, mapId);
  }

  /** Like enrichSegments but works with aliased rows from the enrichedSegmentsForMap query. */
  private async enrichSegmentsFromAliased(
    rows: (Row & { j_row: Row })[],
    mapId?: string,
  ): Promise<EnrichedSegment[]> {
    if (rows.length === 0) return [];
    const results: EnrichedSegment[] = [];

    for (const row of rows) {
      const segment = mapSegment(row);
      const journey = mapJourney(row.j_row);

      const participantRows = await this.db.select(
        `SELECT sp.*, e.name AS entity_name
         FROM segment_participants sp
         JOIN entities e ON e.id = sp.entity_id
         WHERE sp.segment_id = ?
         ORDER BY sp.created_at`,
        [segment.id],
      );
      const participants = participantRows.map((pr) => ({
        ...mapParticipant(pr),
        entity_name: text(pr.entity_name),
      }));

      const originName = segment.origin_entity_id
        ? str((await this.db.select("SELECT name FROM entities WHERE id = ?", [segment.origin_entity_id]))[0]?.name)
        : null;
      const destinationName = segment.destination_entity_id
        ? str((await this.db.select("SELECT name FROM entities WHERE id = ?", [segment.destination_entity_id]))[0]?.name)
        : null;

      let originCoords: { x: number; y: number } | null = null;
      let destinationCoords: { x: number; y: number } | null = null;
      const waypointCoords: ({ x: number; y: number } | null)[] = [];

      const lookupFn = mapId
        ? (eid: string) => this.lookupCoords(eid, mapId)
        : (eid: string) => this.lookupCoordsAnyMap(eid);

      if (segment.origin_entity_id) {
        originCoords = await lookupFn(segment.origin_entity_id);
      }
      if (segment.destination_entity_id) {
        destinationCoords = await lookupFn(segment.destination_entity_id);
      }
      for (const wp of segment.waypoints) {
        if (wp.x != null && wp.y != null) {
          waypointCoords.push({ x: wp.x, y: wp.y });
        } else if (wp.entity_id) {
          waypointCoords.push(await lookupFn(wp.entity_id));
        } else {
          waypointCoords.push(null);
        }
      }

      results.push({
        ...segment,
        journey,
        participants,
        origin_name: originName,
        destination_name: destinationName,
        origin_coords: originCoords,
        destination_coords: destinationCoords,
        waypoint_coords: waypointCoords,
      });
    }

    return results;
  }

  async characterTravelHistory(entityId: string): Promise<EnrichedSegment[]> {
    const rows = await this.db.select(
      `SELECT ts.*,
              j.id AS j_id, j.campaign_id AS j_campaign_id, j.party_id AS j_party_id,
              j.session_id AS j_session_id, j.name AS j_name, j.category AS j_category,
              j.description AS j_description, j.dm_notes AS j_dm_notes,
              j.route_certainty AS j_route_certainty,
              j.start_year AS j_start_year, j.start_month AS j_start_month, j.start_day AS j_start_day,
              j.end_year AS j_end_year, j.end_month AS j_end_month, j.end_day AS j_end_day,
              j.sort_order AS j_sort_order, j.created_at AS j_created_at, j.updated_at AS j_updated_at
       FROM travel_segments ts
       JOIN journeys j ON j.id = ts.journey_id
       JOIN segment_participants sp ON sp.segment_id = ts.id
       WHERE sp.entity_id = ?
       ORDER BY ts.start_year IS NULL, ts.start_year, ts.start_month IS NULL, ts.start_month,
                ts.start_day IS NULL, ts.start_day, ts.created_at`,
      [entityId],
    );

    const remapped = rows.map((row) => ({
      ...row,
      j_row: {
        id: row.j_id,
        campaign_id: row.j_campaign_id,
        party_id: row.j_party_id,
        session_id: row.j_session_id,
        name: row.j_name,
        category: row.j_category,
        description: row.j_description,
        dm_notes: row.j_dm_notes,
        route_certainty: row.j_route_certainty,
        start_year: row.j_start_year,
        start_month: row.j_start_month,
        start_day: row.j_start_day,
        end_year: row.j_end_year,
        end_month: row.j_end_month,
        end_day: row.j_end_day,
        sort_order: row.j_sort_order,
        created_at: row.j_created_at,
        updated_at: row.j_updated_at,
      },
    }));

    return this.enrichSegmentsFromAliased(remapped);
  }

  async locationVisitHistory(entityId: string): Promise<EnrichedSegment[]> {
    // Segments where this entity is origin, destination, or referenced in waypoints JSON
    const rows = await this.db.select(
      `SELECT ts.*,
              j.id AS j_id, j.campaign_id AS j_campaign_id, j.party_id AS j_party_id,
              j.session_id AS j_session_id, j.name AS j_name, j.category AS j_category,
              j.description AS j_description, j.dm_notes AS j_dm_notes,
              j.route_certainty AS j_route_certainty,
              j.start_year AS j_start_year, j.start_month AS j_start_month, j.start_day AS j_start_day,
              j.end_year AS j_end_year, j.end_month AS j_end_month, j.end_day AS j_end_day,
              j.sort_order AS j_sort_order, j.created_at AS j_created_at, j.updated_at AS j_updated_at
       FROM travel_segments ts
       JOIN journeys j ON j.id = ts.journey_id
       WHERE ts.origin_entity_id = ? OR ts.destination_entity_id = ? OR ts.waypoints LIKE ?
       ORDER BY ts.start_year IS NULL DESC, ts.start_year DESC, ts.start_month IS NULL DESC, ts.start_month DESC,
                ts.start_day IS NULL DESC, ts.start_day DESC, ts.sort_order`,
      [entityId, entityId, `%${entityId}%`],
    );

    const remapped = rows.map((row) => ({
      ...row,
      j_row: {
        id: row.j_id,
        campaign_id: row.j_campaign_id,
        party_id: row.j_party_id,
        session_id: row.j_session_id,
        name: row.j_name,
        category: row.j_category,
        description: row.j_description,
        dm_notes: row.j_dm_notes,
        route_certainty: row.j_route_certainty,
        start_year: row.j_start_year,
        start_month: row.j_start_month,
        start_day: row.j_start_day,
        end_year: row.j_end_year,
        end_month: row.j_end_month,
        end_day: row.j_end_day,
        sort_order: row.j_sort_order,
        created_at: row.j_created_at,
        updated_at: row.j_updated_at,
      },
    }));

    return this.enrichSegmentsFromAliased(remapped);
  }

  async sessionTravelSummary(sessionId: string): Promise<{ journey: Journey; segments: EnrichedSegment[] }[]> {
    // Get all journeys for this session
    const journeys = await this.journeysForSession(sessionId);
    const result: { journey: Journey; segments: EnrichedSegment[] }[] = [];

    for (const journey of journeys) {
      const segRows = await this.db.select(
        `SELECT ts.*,
                j.id AS j_id, j.campaign_id AS j_campaign_id, j.party_id AS j_party_id,
                j.session_id AS j_session_id, j.name AS j_name, j.category AS j_category,
                j.description AS j_description, j.dm_notes AS j_dm_notes,
                j.route_certainty AS j_route_certainty,
                j.start_year AS j_start_year, j.start_month AS j_start_month, j.start_day AS j_start_day,
                j.end_year AS j_end_year, j.end_month AS j_end_month, j.end_day AS j_end_day,
                j.sort_order AS j_sort_order, j.created_at AS j_created_at, j.updated_at AS j_updated_at
         FROM travel_segments ts
         JOIN journeys j ON j.id = ts.journey_id
         WHERE ts.journey_id = ?
         ORDER BY ts.sort_order`,
        [journey.id],
      );

      const remapped = segRows.map((row) => ({
        ...row,
        j_row: {
          id: row.j_id,
          campaign_id: row.j_campaign_id,
          party_id: row.j_party_id,
          session_id: row.j_session_id,
          name: row.j_name,
          category: row.j_category,
          description: row.j_description,
          dm_notes: row.j_dm_notes,
          route_certainty: row.j_route_certainty,
          start_year: row.j_start_year,
          start_month: row.j_start_month,
          start_day: row.j_start_day,
          end_year: row.j_end_year,
          end_month: row.j_end_month,
          end_day: row.j_end_day,
          sort_order: row.j_sort_order,
          created_at: row.j_created_at,
          updated_at: row.j_updated_at,
        },
      }));

      const enrichedSegments = await this.enrichSegmentsFromAliased(remapped);
      result.push({ journey, segments: enrichedSegments });
    }

    return result;
  }

  async dmReferenceData(entityId: string, _campaignId: string): Promise<DmReferenceData> {
    // 1. Character summary and known secrets from entity fields
    const entityRows = await this.db.select("SELECT dm_notes_md, secret_md FROM entities WHERE id = ?", [entityId]);
    const entityRow = entityRows[0];
    const characterSummary = entityRow ? str(entityRow.dm_notes_md) : null;
    const knownSecrets = entityRow ? str(entityRow.secret_md) : null;

    // 2. Origin location: earliest backstory segment where character is participant
    let originLocation: { id: string; name: string } | null = null;
    const originRows = await this.db.select(
      `SELECT e.id, e.name
       FROM travel_segments ts
       JOIN journeys j ON j.id = ts.journey_id
       JOIN segment_participants sp ON sp.segment_id = ts.id
       JOIN entities e ON e.id = ts.origin_entity_id
       WHERE sp.entity_id = ? AND j.category = 'backstory' AND ts.origin_entity_id IS NOT NULL
       ORDER BY ts.start_year IS NULL, ts.start_year, ts.start_month IS NULL, ts.start_month,
                ts.start_day IS NULL, ts.start_day, ts.sort_order, ts.created_at
       LIMIT 1`,
      [entityId],
    );
    if (originRows[0]) {
      originLocation = { id: String(originRows[0].id), name: text(originRows[0].name) };
    }

    // 3. Most recent location: latest segment's destination where character is participant
    let mostRecentLocation: { id: string; name: string } | null = null;
    const recentRows = await this.db.select(
      `SELECT e.id, e.name
       FROM travel_segments ts
       JOIN journeys j ON j.id = ts.journey_id
       JOIN segment_participants sp ON sp.segment_id = ts.id
       JOIN entities e ON e.id = ts.destination_entity_id
       WHERE sp.entity_id = ? AND ts.destination_entity_id IS NOT NULL
       ORDER BY ts.end_year IS NULL DESC, ts.end_year DESC, ts.end_month IS NULL DESC, ts.end_month DESC,
                ts.end_day IS NULL DESC, ts.end_day DESC, ts.created_at DESC
       LIMIT 1`,
      [entityId],
    );
    if (recentRows[0]) {
      mostRecentLocation = { id: String(recentRows[0].id), name: text(recentRows[0].name) };
    }

    // 4. Backstory events: timeline events with category 'backstory' for this character
    const backstoryEventRows = await this.db.select(
      `SELECT DISTINCT te.* FROM timeline_events te
       LEFT JOIN timeline_event_participants tep ON tep.event_id = te.id
       WHERE (te.entity_id = ? OR tep.entity_id = ?) AND te.category = 'backstory'
       ORDER BY te.manual_order ASC, te.year IS NULL, te.year, te.month IS NULL, te.month, te.day IS NULL, te.day, te.created_at`,
      [entityId, entityId],
    );
    const backstoryEvents = backstoryEventRows.map(mapExtendedTimelineEvent);

    // 5. NPC relationships: entity_links where related entity is npc
    const npcRelationships = await this.fetchLinkedEntitiesOfKind(entityId, "npc");

    // 6. Faction affiliations: entity_links with relation 'member_of' where target is faction
    const factionAffiliations = await this.fetchLinkedEntitiesOfKindAndRelation(entityId, "faction", "member_of");

    // 7. Active quests: entity_links where related entity is quest and status is not 'completed'
    const activeQuests = await this.fetchActiveQuests(entityId);

    // 8. Items: item_instances owned by this character
    const itemRows = await this.db.select(
      `SELECT i.id AS i_id, i.campaign_id AS i_campaign_id, i.definition_id, i.quantity, i.owner_type, i.owner_id, i.state,
              i.created_at AS i_created_at, i.updated_at AS i_updated_at, e.*
       FROM item_instances i
       JOIN entities e ON e.id = i.definition_id
       WHERE i.owner_type = 'character' AND i.owner_id = ?
       ORDER BY e.name COLLATE NOCASE`,
      [entityId],
    );
    const items: ItemInstanceWithDefinition[] = itemRows.map((r) => {
      const instance = mapInstance({
        id: r.i_id,
        campaign_id: r.i_campaign_id,
        definition_id: r.definition_id,
        quantity: r.quantity,
        owner_type: r.owner_type,
        owner_id: r.owner_id,
        state: r.state,
        created_at: r.i_created_at,
        updated_at: r.i_updated_at,
      });
      return { ...instance, definition: mapEntity(r) };
    });

    // 9. Unresolved plot hooks: timeline events with category 'plot_hook' not marked resolved
    //    Note: timeline_events has no tags column; we exclude events whose kind is 'resolved'
    const plotHookRows = await this.db.select(
      `SELECT DISTINCT te.* FROM timeline_events te
       LEFT JOIN timeline_event_participants tep ON tep.event_id = te.id
       WHERE (te.entity_id = ? OR tep.entity_id = ?) AND te.category = 'plot_hook'
         AND te.kind != 'resolved'
       ORDER BY te.manual_order ASC, te.year IS NULL, te.year, te.month IS NULL, te.month, te.day IS NULL, te.day, te.created_at`,
      [entityId, entityId],
    );
    const unresolvedPlotHooks = plotHookRows.map(mapExtendedTimelineEvent);

    // 10. Last session appeared: most recent session from journeys where character is participant
    let lastSessionAppeared: { id: string; name: string } | null = null;
    const sessionRows = await this.db.select(
      `SELECT e.id, e.name
       FROM journeys j
       JOIN travel_segments ts ON ts.journey_id = j.id
       JOIN segment_participants sp ON sp.segment_id = ts.id
       JOIN entities e ON e.id = j.session_id
       WHERE sp.entity_id = ? AND j.session_id IS NOT NULL
       ORDER BY e.sort_order DESC, e.created_at DESC
       LIMIT 1`,
      [entityId],
    );
    if (sessionRows[0]) {
      lastSessionAppeared = { id: String(sessionRows[0].id), name: text(sessionRows[0].name) };
    }

    return {
      characterSummary,
      originLocation,
      mostRecentLocation,
      backstoryEvents,
      npcRelationships,
      factionAffiliations,
      activeQuests,
      items,
      knownSecrets,
      unresolvedPlotHooks,
      lastSessionAppeared,
    };
  }

  /** Helper: get linked entities of a specific kind for DM reference. */
  private async fetchLinkedEntitiesOfKind(entityId: string, kind: string): Promise<LinkedEntity[]> {
    const rows = await this.db.select(
      `SELECT l.id AS link_id, l.from_id, l.to_id, l.relation, l.note, l.created_at AS link_created,
              CASE WHEN l.from_id = ? THEN 'out' ELSE 'in' END AS direction,
              e.*
       FROM entity_links l
       JOIN entities e ON e.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
       WHERE (l.from_id = ? OR l.to_id = ?) AND e.kind = ?
       ORDER BY e.name COLLATE NOCASE`,
      [entityId, entityId, entityId, entityId, kind],
    );
    return rows.map((row) => ({
      id: String(row.link_id),
      from_id: String(row.from_id),
      to_id: String(row.to_id),
      relation: text(row.relation),
      note: text(row.note),
      created_at: text(row.link_created),
      direction: row.direction as "out" | "in",
      entity: mapEntity(row),
    }));
  }

  /** Helper: get linked entities of a specific kind and relation for DM reference. */
  private async fetchLinkedEntitiesOfKindAndRelation(entityId: string, kind: string, relation: string): Promise<LinkedEntity[]> {
    const rows = await this.db.select(
      `SELECT l.id AS link_id, l.from_id, l.to_id, l.relation, l.note, l.created_at AS link_created,
              CASE WHEN l.from_id = ? THEN 'out' ELSE 'in' END AS direction,
              e.*
       FROM entity_links l
       JOIN entities e ON e.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
       WHERE (l.from_id = ? OR l.to_id = ?) AND e.kind = ? AND l.relation = ?
       ORDER BY e.name COLLATE NOCASE`,
      [entityId, entityId, entityId, entityId, kind, relation],
    );
    return rows.map((row) => ({
      id: String(row.link_id),
      from_id: String(row.from_id),
      to_id: String(row.to_id),
      relation: text(row.relation),
      note: text(row.note),
      created_at: text(row.link_created),
      direction: row.direction as "out" | "in",
      entity: mapEntity(row),
    }));
  }

  /** Helper: get active quests linked to an entity. */
  private async fetchActiveQuests(entityId: string): Promise<LinkedEntity[]> {
    const rows = await this.db.select(
      `SELECT l.id AS link_id, l.from_id, l.to_id, l.relation, l.note, l.created_at AS link_created,
              CASE WHEN l.from_id = ? THEN 'out' ELSE 'in' END AS direction,
              e.*
       FROM entity_links l
       JOIN entities e ON e.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
       WHERE (l.from_id = ? OR l.to_id = ?) AND e.kind = 'quest' AND (e.status IS NULL OR e.status != 'completed')
       ORDER BY e.name COLLATE NOCASE`,
      [entityId, entityId, entityId, entityId],
    );
    return rows.map((row) => ({
      id: String(row.link_id),
      from_id: String(row.from_id),
      to_id: String(row.to_id),
      relation: text(row.relation),
      note: text(row.note),
      created_at: text(row.link_created),
      direction: row.direction as "out" | "in",
      entity: mapEntity(row),
    }));
  }

  /** Alias for characterTravelHistory, per design interface. */
  async segmentsForCharacter(entityId: string): Promise<EnrichedSegment[]> {
    return this.characterTravelHistory(entityId);
  }

  /** Returns all enriched segments for a specific journey (not filtered by participant). */
  async enrichedSegmentsForJourney(journeyId: string): Promise<EnrichedSegment[]> {
    const journeyRows = await this.db.select("SELECT * FROM journeys WHERE id = ?", [journeyId]);
    if (journeyRows.length === 0) return [];
    const journey = mapJourney(journeyRows[0]);

    const segmentRows = await this.db.select(
      "SELECT * FROM travel_segments WHERE journey_id = ? ORDER BY sort_order, created_at",
      [journeyId],
    );

    const results: EnrichedSegment[] = [];
    for (const row of segmentRows) {
      const segment = mapSegment(row);

      const participantRows = await this.db.select(
        `SELECT sp.*, e.name AS entity_name FROM segment_participants sp JOIN entities e ON e.id = sp.entity_id WHERE sp.segment_id = ? ORDER BY sp.created_at`,
        [segment.id],
      );
      const participants = participantRows.map((pr) => ({ ...mapParticipant(pr), entity_name: text(pr.entity_name) }));

      const originName = segment.origin_entity_id
        ? str((await this.db.select("SELECT name FROM entities WHERE id = ?", [segment.origin_entity_id]))[0]?.name)
        : null;
      const destinationName = segment.destination_entity_id
        ? str((await this.db.select("SELECT name FROM entities WHERE id = ?", [segment.destination_entity_id]))[0]?.name)
        : null;

      let originCoords: { x: number; y: number } | null = null;
      let destinationCoords: { x: number; y: number } | null = null;
      if (segment.origin_entity_id) originCoords = await this.lookupCoordsAnyMap(segment.origin_entity_id);
      if (segment.destination_entity_id) destinationCoords = await this.lookupCoordsAnyMap(segment.destination_entity_id);

      const waypointCoords: ({ x: number; y: number } | null)[] = [];
      for (const wp of segment.waypoints) {
        if (wp.x != null && wp.y != null) waypointCoords.push({ x: wp.x, y: wp.y });
        else if (wp.entity_id) waypointCoords.push(await this.lookupCoordsAnyMap(wp.entity_id));
        else waypointCoords.push(null);
      }

      results.push({
        ...segment,
        journey,
        participants,
        origin_name: originName,
        destination_name: destinationName,
        origin_coords: originCoords,
        destination_coords: destinationCoords,
        waypoint_coords: waypointCoords,
      });
    }
    return results;
  }

  /** Alias for locationVisitHistory, per design interface. */
  async segmentsForLocation(entityId: string): Promise<EnrichedSegment[]> {
    return this.locationVisitHistory(entityId);
  }

  // ── Waypoint Cleanup ──

  /** Removes all waypoint entries referencing the given entityId from travel segment waypoints JSON arrays. */
  async removeWaypointEntity(entityId: string): Promise<void> {
    // Find segments whose waypoints JSON contains this entity ID
    const rows = await this.db.select(
      "SELECT id, waypoints FROM travel_segments WHERE waypoints LIKE ?",
      [`%${entityId}%`],
    );

    for (const row of rows) {
      const waypoints = parseJson<Waypoint[]>(row.waypoints, []);
      const filtered = waypoints.filter((wp) => wp.entity_id !== entityId);
      if (filtered.length !== waypoints.length) {
        await this.db.execute(
          "UPDATE travel_segments SET waypoints = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(filtered), now(), String(row.id)],
        );
      }
    }
  }
}
