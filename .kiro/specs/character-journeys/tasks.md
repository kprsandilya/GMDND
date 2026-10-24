# Implementation Plan: Character Journeys, Party Travel, and Individual Timelines

## Overview

This plan implements the unified journey model in five incremental phases matching the Journey Instructions: data model and individual timelines, journey recording and party history, world atlas integration, session integration and editing workflows, and playback with advanced views. Each task builds on previous tasks and ends with wiring into the existing application. The implementation language is TypeScript throughout, matching the existing codebase.

## Tasks

- [x] 1. Phase 1 — Data Model, Domain Types, and Individual Timelines
  - [x] 1.1 Create `src/domain/journeyTypes.ts` with all journey-related TypeScript interfaces and type constants
    - Define `JOURNEY_CATEGORIES`, `ROUTE_CERTAINTIES`, `SEGMENT_CERTAINTIES`, `TIMELINE_EVENT_CATEGORIES`, `CONFIDENCE_LEVELS` const arrays and their derived union types
    - Define interfaces: `Waypoint`, `Journey`, `TravelSegment`, `SegmentParticipant`, `PartyMembership`, `TimelineEventParticipant`, `ExtendedTimelineEvent`
    - Define enriched query result types: `EnrichedSegment`, `EnrichedMembership`, `DmReferenceData`
    - Define input/patch types: `JourneyInput`, `JourneyPatch`, `SegmentInput`, `SegmentPatch`, `ParticipantInput`, `MembershipInput`, `MembershipPatch`, `JourneyFilters`, `RouteFilters`
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 6.2_

  - [x] 1.2 Register `party` entity kind in the existing domain and routing infrastructure
    - Add `"party"` to `ENTITY_KINDS` array in `src/domain/types.ts`
    - Add `party: "Party"` to `KIND_LABELS` in `src/domain/types.ts`
    - Add `party: "parties"` to `MODULE_FOR_KIND` in `src/app/routes.ts`
    - Add `{ to: "/parties", label: "Parties", icon: "UsersRound" }` nav item to `NAV_ITEMS` in `src/app/routes.ts` (after Characters)
    - _Requirements: 1.1, 1.4, 18.6_

  - [x] 1.3 Append migration version 3 to `src/persistence/migrations.ts`
    - Add a new entry to the `MIGRATIONS` array with version 3, name `"character journeys"`
    - Include CREATE TABLE statements for `party_memberships`, `journeys`, `travel_segments`, `segment_participants`, `timeline_event_participants`
    - Include CREATE INDEX statements for all foreign key columns specified in the design
    - Include ALTER TABLE statements adding `category`, `session_id`, `journey_id`, `segment_id`, `location_id`, `confidence`, `manual_order` columns to `timeline_events`
    - Follow the existing migration pattern: no BEGIN/COMMIT wrapping, rely on `isIgnorableMigrationError` for idempotence
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [x] 1.4 Write property test for journey name validation (Property 13)
    - **Property 13: Journey name validation**
    - **Validates: Requirements 3.2**
    - Use fast-check to generate arbitrary strings; verify trimming, 1–200 character range enforcement, rejection of empty/whitespace-only/over-length strings

  - [x] 1.5 Implement `JourneyRepository` class in `src/persistence/repositories/journeys.ts` — Journey CRUD
    - Create the repository class following the `WorldMapRepository` / `TimelineRepository` constructor pattern with `SqlDriver`
    - Implement `createJourney`, `getJourney`, `updateJourney`, `deleteJourney`, `listJourneys`
    - Implement `journeysForSession`, `journeysForParty`, `journeysForCharacter`
    - Validate journey name (trimmed, 1–200 chars), category, and route_certainty on create/update
    - Throw `NotFoundError` on update/delete of missing journeys
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 1.6 Implement `JourneyRepository` — Travel Segment CRUD
    - Implement `createSegment`, `getSegment`, `updateSegment`, `deleteSegment`, `listSegments`, `reorderSegments`
    - Auto-assign sort_order on create (max + 1 or 0)
    - Validate journey_id references an existing journey before INSERT
    - Validate waypoints array length ≤ 50
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8_

  - [x] 1.7 Implement `JourneyRepository` — Segment Participants
    - Implement `addParticipant`, `removeParticipant`, `participantsForSegment`
    - Validate entity exists and kind is `pc` or `npc` before INSERT
    - Handle UNIQUE constraint violation with descriptive error message
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8_

  - [x] 1.8 Implement `JourneyRepository` — Party Memberships
    - Implement `addMembership`, `updateMembership`, `removeMembership`
    - Implement `membershipsForParty`, `membershipsForCharacter`, `activeMemberships`
    - Implement `membershipAtSession`, `membershipAtDate`, `hasActiveMembership`
    - Check for overlapping active memberships before INSERT; throw validation error on duplicate
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 1.9 Implement `JourneyRepository` — Timeline Event Participants and Extended Queries
    - Implement `addEventParticipant`, `removeEventParticipant`, `eventParticipants`, `eventsForCharacter`
    - Validate segment-journey reference integrity: reject non-null segment_id with null journey_id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9_

  - [x] 1.10 Implement `JourneyRepository` — Enriched Queries and Waypoint Cleanup
    - Implement `enrichedSegmentsForMap`, `characterTravelHistory`, `locationVisitHistory`, `sessionTravelSummary`, `dmReferenceData`
    - Implement `segmentsForCharacter`, `segmentsForLocation`
    - Implement `removeWaypointEntity` for JSON array cleanup on entity deletion
    - _Requirements: 5.4, 7.1, 7.6, 12.1, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 21.1_

  - [x] 1.11 Export `JourneyRepository` from `src/persistence/repositories/index.ts`
    - Add `journeys: JourneyRepository` to the `Repositories` interface
    - Instantiate and return `JourneyRepository` in `createRepositories`
    - Add to the export list
    - _Requirements: 16.1_

  - [x] 1.12 Extend `TimelineRepository` in `src/persistence/repositories/misc.ts` for enriched timeline queries
    - Update the `mapTimeline` function to include the new columns (`category`, `session_id`, `journey_id`, `segment_id`, `location_id`, `confidence`, `manual_order`) with safe fallback defaults for rows from older schema
    - Update sorting in the `list` method to use `manual_order ASC, year IS NULL, year, month IS NULL, month, day IS NULL, day, created_at`
    - Update `create` and `update` methods to accept the new fields
    - _Requirements: 6.1, 6.6, 6.7_

- [x] 2. Checkpoint — Data model complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Phase 1 continued — Property Tests for Data Model
  - [x] 3.1 Write property test for party membership non-overlap invariant (Property 1)
    - **Property 1: Party membership non-overlap invariant**
    - **Validates: Requirements 2.4**
    - Generate random membership periods; verify overlapping periods are rejected

  - [x] 3.2 Write property test for segment participant uniqueness (Property 2)
    - **Property 2: Segment participant uniqueness**
    - **Validates: Requirements 5.3**
    - Generate random (segment_id, entity_id) pairs; verify duplicates are rejected and list size equals distinct count

  - [x] 3.3 Write property test for journey cascade delete (Property 3)
    - **Property 3: Journey cascade delete preserves entities**
    - **Validates: Requirements 3.7, 14.10**
    - Create journeys with segments, participants, and timeline events; delete journey; verify cascades and entity preservation

  - [x] 3.4 Write property test for segment cascade delete (Property 4)
    - **Property 4: Segment cascade delete preserves journey and entities**
    - **Validates: Requirements 4.7, 14.11**

  - [x] 3.5 Write property test for timeline event sorting determinism (Property 5)
    - **Property 5: Timeline event sorting is deterministic**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 3.6 Write property test for segment-journey reference integrity (Property 6)
    - **Property 6: Segment-journey reference integrity**
    - **Validates: Requirements 6.9**

  - [x] 3.7 Write property test for travel history round-trip (Property 7)
    - **Property 7: Travel history round-trip through character view**
    - **Validates: Requirements 5.4, 7.1**

  - [x] 3.8 Write property test for membership at-session query correctness (Property 8)
    - **Property 8: Party membership at-session query correctness**
    - **Validates: Requirements 2.10**

  - [x] 3.9 Write property test for filter combination conjunction (Property 10)
    - **Property 10: Filter combination is conjunctive**
    - **Validates: Requirements 11.7, 11.10**

  - [x] 3.10 Write property test for active membership derivation (Property 11)
    - **Property 11: Active membership derivation**
    - **Validates: Requirements 2.6**

  - [x] 3.11 Write property test for entity deletion cascades (Property 12)
    - **Property 12: Entity deletion cascades correctly through journey system**
    - **Validates: Requirements 5.5, 2.8**

  - [x] 3.12 Write property test for waypoint entity cleanup (Property 14)
    - **Property 14: Waypoint entity cleanup on entity deletion**
    - **Validates: Requirements 4.6**

- [x] 4. Phase 2 — Individual Character Journey View and Party Pages
  - [x] 4.1 Create `src/features/characters/JourneyTimelineTab.tsx` — Journey & Timeline tab for PC/NPC detail
    - Fetch character's travel history via `characterTravelHistory` and timeline events via `eventsForCharacter`
    - Display travel segments ordered by in-world start date ascending, undated segments after dated ones
    - Show each segment with origin/destination names, journey category, session name, date range, route certainty, co-travelers
    - Display chronological timeline grouped by session (or "No session" heading)
    - Derive and display current/last known location from latest segment destination
    - Show empty state with action to create first journey when no data exists
    - Wire navigation: clicking location navigates to location detail, clicking session navigates to session detail
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 18.1_

  - [x] 4.2 Create `src/features/characters/DmReferenceTab.tsx` — DM Reference tab for PC/NPC detail
    - Fetch `dmReferenceData` from `JourneyRepository`
    - Display: character summary (dm_notes_md), origin location (earliest backstory segment), most recent location, backstory events, NPC relationships, faction affiliations, active quests, items, known secrets, unresolved plot hooks, last session appeared
    - Derive each field per the design specifications; show "No data" labels for missing fields
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 4.3 Integrate new tabs into `src/features/characters/CharactersPage.tsx`
    - Add `JourneyTimelineTab` as `{ value: "journey", label: "Journey & Timeline", render: (e) => <JourneyTimelineTab entity={e} /> }` to the extras.tabs array
    - Add `DmReferenceTab` as `{ value: "dmref", label: "DM Reference", render: (e) => <DmReferenceTab entity={e} /> }` to the extras.tabs array
    - _Requirements: 18.1_

  - [x] 4.4 Create `src/features/parties/PartiesPage.tsx` — Party entity workspace
    - Use `EntityWorkspace` with `kinds={["party"]}` and `basePath="/parties"`
    - Display membership history (current + past members ordered by join date), shared journeys, travel segments per journey
    - Support member filter and session filter with reset
    - Show empty state when no journeys or members exist
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 18.4_

  - [x] 4.5 Add party routes to `src/app/router.tsx`
    - Import `PartiesPage` and add routes: `<Route path="parties" element={<PartiesPage />} />` and `<Route path="parties/:id" element={<PartiesPage />} />`
    - _Requirements: 18.6_

  - [x] 4.6 Write unit tests for JourneyTimelineTab and PartiesPage
    - Test rendering with mock data, empty states, navigation links
    - _Requirements: 7.7, 8.6_

- [x] 5. Checkpoint — Individual timelines and party view functional
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Phase 3 — World Atlas Route Overlay
  - [x] 6.1 Create `src/features/atlas/RouteOverlay.tsx` — SVG route polyline rendering
    - Define `ROUTE_STYLES` mapping `JourneyCategory` → `{ color, dashArray }` per the design
    - Implement `renderRouteOverlay` function that renders into the `dm-workbench-overlay` SVG group
    - Render each segment as two `<polyline>` elements: transparent hit-area (stroke-width 8, pointer-events stroke) + visible styled line (stroke-width 2.5, pointer-events none)
    - Build polyline points from origin → waypoints → destination coordinates
    - Render legend panel as a React component listing visible categories with color/dash samples
    - Handle unmapped segments: skip points with no coordinates, show warning labels per requirements
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 6.2 Create `src/features/atlas/JourneyFilterToolbar.tsx` — Filter controls
    - Implement multi-select controls for character, party, session, and journey category
    - Implement date range (start/end) inputs using the campaign calendar format
    - Implement "hide all routes" toggle
    - Store filter state in zustand appStore overlay preferences
    - Apply AND logic across all active filters
    - Show "no routes match" message when filter combination returns empty
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 6.3 Create `src/features/atlas/SegmentDetailPanel.tsx` — Contextual side panel for route clicks
    - Display segment origin, destination, journey name, journey category, travelers, session, date range, events, notes
    - Omit fields that have no data
    - Wire navigation: clicking traveler/location/session names navigates to entity detail
    - Render missing entities as plain text without navigation link
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 6.4 Integrate journey overlay into `src/features/atlas/AtlasPage.tsx`
    - Add journey overlay toggle button to the atlas toolbar (overlay inactive by default)
    - When overlay is active, fetch enriched segments via `enrichedSegmentsForMap` with current filters
    - Embed `RouteOverlay`, `JourneyFilterToolbar`, and `SegmentDetailPanel` components
    - Wire polyline click handler to open `SegmentDetailPanel` with segment data
    - Add periodic re-render interval (like existing overlay) to survive generator redraws
    - _Requirements: 9.1, 9.10, 18.3_

  - [x] 6.5 Write unit tests for route overlay rendering and filter logic
    - Test category style mapping, polyline coordinate generation, filter AND logic
    - _Requirements: 9.4, 11.7_

- [x] 7. Checkpoint — Atlas route overlay functional
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Phase 4 — Session Integration, Backstory Workflow, and Journey Editor
  - [x] 8.1 Create `src/features/sessions/SessionTravelTab.tsx` — Travel tab for session detail
    - Fetch `sessionTravelSummary` from `JourneyRepository`
    - Display journeys and segments for the session, grouped by journey name, ordered by segment sort_order
    - Show segment origin/destination, participant names, timeline event titles
    - Show placeholder labels for null origin/destination ("Unknown location"), not clickable
    - Show empty state when no travel recorded for the session
    - Wire navigation: location names → location detail, session context for new journey creation
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 8.2 Integrate `SessionTravelTab` into `src/features/sessions/SessionsPage.tsx`
    - Add `{ value: "travel", label: "Travel", render: (e) => <SessionTravelTab session={e} /> }` to the extras.tabs array
    - _Requirements: 18.2_

  - [x] 8.3 Create `src/features/journeys/JourneyEditor.tsx` — Shared journey/segment/participant editor dialog
    - Implement journey create/edit form with fields: name, category, route_certainty, description, dm_notes, session_id, party_id, date fields
    - Implement segment create/edit within the journey: origin/destination entity pickers, waypoints list (add/remove/reorder, max 50), date fields, route_certainty, notes
    - Implement participant add/remove per segment with entity picker (pc/npc kinds) and role field
    - Implement inline location creation for backstory workflows: minimum name + geographic kind, duplicate name detection with "link existing" option
    - Support reordering segments via drag or up/down controls
    - Use `useAction` pattern with toast notifications and react-query invalidation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [x] 8.4 Create `src/features/locations/VisitHistorySection.tsx` — Visit history for location detail
    - Fetch `locationVisitHistory` from `JourneyRepository`
    - Display visits sorted by segment start date descending, then sort_order for equal/null dates
    - Show each visit with participants, role (origin/destination/waypoint), journey name, category, session, date range
    - Show empty state when no visits recorded
    - _Requirements: 21.1, 21.2, 21.4_

  - [x] 8.5 Integrate `VisitHistorySection` into `src/features/locations/LocationsPage.tsx`
    - Add `{ value: "visits", label: "Visit History", render: (e) => <VisitHistorySection entity={e} /> }` to the extras.tabs array
    - _Requirements: 18.5 (implied), 21.3_

  - [x] 8.6 Add "Show on atlas" action to character journey view
    - When a location in the JourneyTimelineTab has linked map coordinates, show a "Show on atlas" button
    - Clicking navigates to `/atlas/{mapId}?entity={locationId}` with journey overlay activated and map centered
    - If no map coordinates exist, show a message indicating the location cannot be shown and stay on current page
    - _Requirements: 18.5, 18.7_

  - [x] 8.7 Wire entity deletion to journey system cleanup
    - When a character entity is deleted, cascade removes segment_participants and party_memberships (handled by FK CASCADE)
    - When an entity is deleted, call `removeWaypointEntity(entityId)` to scrub waypoint JSON arrays
    - Integrate this call into the existing entity deletion workflow
    - _Requirements: 4.6, 5.5, 2.8, 2.9_

  - [x] 8.8 Write unit tests for SessionTravelTab, JourneyEditor, and VisitHistorySection
    - Test rendering with mock data, empty states, form validation, inline location creation
    - _Requirements: 12.6, 14.1, 21.4_

- [x] 9. Checkpoint — Session integration and editing workflows complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Phase 5 — Playback and Advanced Views
  - [x] 10.1 Create `src/features/atlas/JourneyPlayback.tsx` — Timeline slider with playback controls
    - Implement zustand `PlaybackState` store with `active`, `segments`, `position`, `stepForward`, `stepBackward`, `jumpToSession`, `setPosition`, `activate`, `deactivate`
    - Derive playback ordering: journey start date → journey sort_order → segment sort_order → manual_order
    - Render slider with one discrete position per filtered segment + initial "before first" position
    - Progressive reveal: show segments up to current position, distinct marker at current destination
    - Hide segments beyond current position when moving backward
    - Render step-forward, step-backward, and jump-to-session controls
    - Display side panel with current segment details, travelers, and associated timeline events
    - Show disabled slider with message when no segments match active filters
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

  - [x] 10.2 Create `src/features/atlas/RouteComparison.tsx` — Character route comparison panel
    - When 2–6 characters are selected in the filter, assign each a unique stroke color
    - Render shared markers at locations appearing in multiple selected characters' segments
    - Display comparison panel listing: shared locations, subset-only locations, overlapping sessions
    - Hide comparison panel and shared markers when fewer than 2 characters are selected
    - Show "no route data" indicator for selected characters with no travel segments
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 10.3 Integrate playback and comparison into `AtlasPage.tsx`
    - Embed `JourneyPlayback` component, activated via a playback toggle when overlay is active
    - Embed `RouteComparison` component, activated automatically when 2+ characters are selected in the filter
    - Wire playback state to `RouteOverlay` for progressive segment reveal and current-position marker
    - _Requirements: 19.1, 20.1_

  - [x] 10.4 Wire location visit history into atlas overlay
    - When the journey overlay is active and a DM clicks a location marker on the atlas, display the visit history for that location in the segment detail panel
    - _Requirements: 21.3_

  - [x] 10.5 Write unit tests for JourneyPlayback and RouteComparison
    - Test playback ordering derivation, step controls, progressive reveal logic, comparison marker placement
    - _Requirements: 19.6, 20.3_

- [x] 11. Final checkpoint — All features integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `party` entity kind reuses the existing `entities` table — no new table needed for party CRUD itself
- All UI components use the existing Radix UI + Tailwind design system and the `EntityWorkspace` / `EntityDetail` extension points
- Route overlay renders into the existing `dm-workbench-overlay` SVG group — no iframe modification needed
- Migration v3 must follow the existing pattern: no transaction wrapping, `isIgnorableMigrationError` for idempotence

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["1.6", "1.8"] },
    { "id": 4, "tasks": ["1.7", "1.9"] },
    { "id": 5, "tasks": ["1.10", "1.11", "1.12"] },
    { "id": 6, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12"] },
    { "id": 7, "tasks": ["4.1", "4.2", "4.4"] },
    { "id": 8, "tasks": ["4.3", "4.5", "4.6"] },
    { "id": 9, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 10, "tasks": ["6.4", "6.5"] },
    { "id": 11, "tasks": ["8.1", "8.3", "8.4"] },
    { "id": 12, "tasks": ["8.2", "8.5", "8.6", "8.7", "8.8"] },
    { "id": 13, "tasks": ["10.1", "10.2"] },
    { "id": 14, "tasks": ["10.3", "10.4", "10.5"] }
  ]
}
```
