/** Journey domain types shared by persistence, domain logic and the UI. Row shapes mirror the SQLite schema. */

import type { Entity, EntityKind, ItemInstanceWithDefinition, LinkedEntity, TimelineEvent } from "./types";

// ── Journey categories ──

export const JOURNEY_CATEGORIES = [
  "backstory",
  "campaign",
  "individual",
  "party",
  "npc",
  "flashback",
  "uncertain",
] as const;
export type JourneyCategory = (typeof JOURNEY_CATEGORIES)[number];

export const JOURNEY_CATEGORY_LABELS: Record<JourneyCategory, string> = {
  backstory: "Backstory",
  campaign: "Campaign",
  individual: "Individual",
  party: "Party",
  npc: "NPC",
  flashback: "Flashback",
  uncertain: "Uncertain",
};

// ── Route certainty (journey-level) ──

export const ROUTE_CERTAINTIES = ["known", "approximate", "unknown"] as const;
export type RouteCertainty = (typeof ROUTE_CERTAINTIES)[number];

export const ROUTE_CERTAINTY_LABELS: Record<RouteCertainty, string> = {
  known: "Known",
  approximate: "Approximate",
  unknown: "Unknown",
};

// ── Route certainty (segment-level) ──

export const SEGMENT_CERTAINTIES = ["confirmed", "estimated", "speculative"] as const;
export type SegmentCertainty = (typeof SEGMENT_CERTAINTIES)[number];

export const SEGMENT_CERTAINTY_LABELS: Record<SegmentCertainty, string> = {
  confirmed: "Confirmed",
  estimated: "Estimated",
  speculative: "Speculative",
};

// ── Timeline event categories ──

export const TIMELINE_EVENT_CATEGORIES = [
  "birth",
  "backstory",
  "travel",
  "meeting",
  "quest",
  "discovery",
  "battle",
  "injury",
  "relationship",
  "faction",
  "secret",
  "plot_hook",
  "milestone",
  "residence",
  "general",
] as const;
export type TimelineEventCategory = (typeof TIMELINE_EVENT_CATEGORIES)[number];

export const TIMELINE_EVENT_CATEGORY_LABELS: Record<TimelineEventCategory, string> = {
  birth: "Birth",
  backstory: "Backstory",
  travel: "Travel",
  meeting: "Meeting",
  quest: "Quest",
  discovery: "Discovery",
  battle: "Battle",
  injury: "Injury",
  relationship: "Relationship",
  faction: "Faction",
  secret: "Secret",
  plot_hook: "Plot Hook",
  milestone: "Milestone",
  residence: "Residence",
  general: "General",
};

// ── Confidence levels ──

export const CONFIDENCE_LEVELS = ["certain", "probable", "uncertain"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  certain: "Certain",
  probable: "Probable",
  uncertain: "Uncertain",
};

// ── Waypoint within a travel segment ──

export interface Waypoint {
  entity_id: string | null;
  x?: number | null;
  y?: number | null;
}

// ── Journey record ──

export interface Journey {
  id: string;
  campaign_id: string;
  party_id: string | null;
  session_id: string | null;
  name: string;
  category: JourneyCategory;
  description: string;
  dm_notes: string;
  route_certainty: RouteCertainty;
  start_year: number | null;
  start_month: number | null;
  start_day: number | null;
  end_year: number | null;
  end_month: number | null;
  end_day: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── Travel segment ──

export interface TravelSegment {
  id: string;
  journey_id: string;
  origin_entity_id: string | null;
  destination_entity_id: string | null;
  waypoints: Waypoint[];
  start_year: number | null;
  start_month: number | null;
  start_day: number | null;
  end_year: number | null;
  end_month: number | null;
  end_day: number | null;
  sort_order: number;
  route_certainty: SegmentCertainty;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Segment participant ──

export interface SegmentParticipant {
  id: string;
  segment_id: string;
  entity_id: string;
  role: string;
  notes: string;
  created_at: string;
}

// ── Party membership ──

export interface PartyMembership {
  id: string;
  party_id: string;
  entity_id: string;
  role: string;
  joined_session_id: string | null;
  left_session_id: string | null;
  joined_year: number | null;
  joined_month: number | null;
  joined_day: number | null;
  left_year: number | null;
  left_month: number | null;
  left_day: number | null;
  notes: string;
  created_at: string;
}

// ── Timeline event participant ──

export interface TimelineEventParticipant {
  id: string;
  event_id: string;
  entity_id: string;
  role: string;
  created_at: string;
}

// ── Extended timeline event (augmented from existing TimelineEvent) ──

export interface ExtendedTimelineEvent {
  id: string;
  campaign_id: string;
  entity_id: string | null;
  title: string;
  body_md: string;
  year: number | null;
  month: number | null;
  day: number | null;
  kind: string;
  secret: boolean;
  category: TimelineEventCategory;
  session_id: string | null;
  journey_id: string | null;
  segment_id: string | null;
  location_id: string | null;
  confidence: ConfidenceLevel;
  manual_order: number;
  created_at: string;
  updated_at: string;
}

// ── Enriched query result types (joined data for UI) ──

export interface EnrichedSegment extends TravelSegment {
  journey: Journey;
  participants: (SegmentParticipant & { entity_name: string })[];
  origin_name: string | null;
  destination_name: string | null;
  origin_coords: { x: number; y: number } | null;
  destination_coords: { x: number; y: number } | null;
  waypoint_coords: ({ x: number; y: number } | null)[];
}

export interface EnrichedMembership extends PartyMembership {
  entity_name: string;
  entity_kind: string;
  joined_session_name: string | null;
  left_session_name: string | null;
}

export interface DmReferenceData {
  characterSummary: string | null;
  originLocation: { id: string; name: string } | null;
  mostRecentLocation: { id: string; name: string } | null;
  backstoryEvents: ExtendedTimelineEvent[];
  npcRelationships: LinkedEntity[];
  factionAffiliations: LinkedEntity[];
  activeQuests: LinkedEntity[];
  items: ItemInstanceWithDefinition[];
  knownSecrets: string | null;
  unresolvedPlotHooks: ExtendedTimelineEvent[];
  lastSessionAppeared: { id: string; name: string } | null;
}

// ── Input types (for creating new records) ──

export type JourneyInput = Omit<Journey, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export type SegmentInput = Omit<TravelSegment, "id" | "created_at" | "updated_at" | "sort_order"> & {
  id?: string;
  sort_order?: number;
};

export type ParticipantInput = Omit<SegmentParticipant, "id" | "created_at"> & {
  id?: string;
};

export type MembershipInput = Omit<PartyMembership, "id" | "created_at"> & {
  id?: string;
};

// ── Patch types (for updating existing records) ──

export type JourneyPatch = Partial<Omit<Journey, "id" | "campaign_id" | "created_at" | "updated_at">>;

export type SegmentPatch = Partial<Omit<TravelSegment, "id" | "journey_id" | "created_at" | "updated_at">>;

export type MembershipPatch = Partial<Omit<PartyMembership, "id" | "party_id" | "entity_id" | "created_at">>;

// ── Filter types ──

export interface JourneyFilters {
  campaignId: string;
  category?: JourneyCategory;
  sessionId?: string;
  partyId?: string;
  characterId?: string;
}

export interface RouteFilters {
  characterIds?: string[];
  partyIds?: string[];
  sessionIds?: string[];
  categories?: JourneyCategory[];
  startDate?: { year: number; month?: number; day?: number };
  endDate?: { year: number; month?: number; day?: number };
  hideAll?: boolean;
}
