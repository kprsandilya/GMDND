# Requirements Document

## Introduction

Character Journeys, Party Travel, and Individual Timelines is a feature for the DM Workbench desktop application. It adds a unified journey model that tracks the complete travel histories of individual characters and parties across the world atlas, both before and during the campaign. A single canonical data layer powers chronological timelines, visual atlas route overlays, session travel summaries, backstory management, and character reference views. The feature extends the existing entity, timeline, world atlas, and session systems rather than replacing them.

## Glossary

- **Journey_System**: The overall subsystem responsible for recording, persisting, querying, and displaying travel histories, party membership, and character timelines within DM Workbench.
- **DM_Workbench**: The Tauri 2 desktop application that hosts the journey system and all existing campaign management features.
- **Journey**: A named, campaign-scoped record representing a coherent period of travel with a category, optional session, optional date range, description, and DM notes.
- **Travel_Segment**: An ordered leg within a journey connecting an origin location to a destination location, with optional intermediate waypoints and per-segment notes.
- **Segment_Participant**: A record associating a character (PC or NPC entity) with a specific travel segment, indicating that the character traveled on that leg.
- **Party**: An entity of kind `party` representing a named group of characters whose membership can change over time.
- **Party_Membership**: A time-aware record linking a character to a party, capturing the session or in-world date when the character joined and when (if ever) the character left.
- **Route_Overlay**: An SVG layer rendered on top of the Azgaar Fantasy Map Generator iframe that draws travel routes as polylines between location coordinates.
- **Timeline_View**: A chronological list of enriched timeline events displayed on a character, party, or session page.
- **Calendar_Date**: A composite of year, month, and day as defined by the campaign's custom calendar system. Any component may be null to represent an approximate or unknown date.
- **Map_Coordinate**: A pair of (x, y) values in the Azgaar map coordinate system, as stored in `map_feature_links`.
- **Entity**: A row in the existing `entities` table, identified by kind (campaign, pc, npc, location, session, etc.) and scoped to a campaign.
- **Feature_Link**: An existing `map_feature_links` row that ties a map feature (burg, state, marker, etc.) to an entity with x/y coordinates.
- **Journey_Category**: One of `backstory`, `campaign`, `individual`, `party`, `npc`, `flashback`, or `uncertain`, indicating the nature of the travel.
- **Route_Certainty**: One of `known`, `approximate`, or `unknown`, indicating how confident the DM is in the recorded route.
- **Timeline_Event_Category**: A classification for timeline entries such as `birth`, `backstory`, `travel`, `meeting`, `quest`, `discovery`, `battle`, `injury`, `relationship`, `faction`, `secret`, `plot_hook`, `milestone`, `residence`, or `general`.

## Requirements

### Requirement 1: Party Entity Kind

**User Story:** As a DM, I want to create and manage named party groups, so that I can track which characters travel together and how membership changes over time.

#### Acceptance Criteria

1. THE Journey_System SHALL support a `party` entity kind in the existing `entities` table with the same columns as other entity kinds (id, campaign_id, name, summary, body_md, dm_notes_md, tags, fields, status, sort_order).
2. WHEN a DM creates a party entity, THE Journey_System SHALL store a new entity row with kind `party` scoped to the active campaign.
3. WHEN a DM views a party entity, THE Journey_System SHALL display the party name, summary, description, and a membership list consisting of all character entities (kind `pc` or `npc`) linked to the party via `entity_links` with a `member_of` relation.
4. THE Journey_System SHALL allow a party entity to be renamed, edited, and deleted using the same entity CRUD operations as other entity kinds.
5. IF a party entity is deleted, THEN THE Journey_System SHALL remove the party entity row and all `entity_links` entries referencing that party while preserving all character entities that were members.
6. IF a DM views a party entity that has zero character entities linked as members, THEN THE Journey_System SHALL display an empty-state indicator in place of the membership list.

### Requirement 2: Time-Aware Party Membership

**User Story:** As a DM, I want to record when characters join and leave a party, so that I can reconstruct the party's composition at any point in the campaign.

#### Acceptance Criteria

1. THE Journey_System SHALL persist party membership records in a `party_memberships` table with columns: id, party_id, entity_id, role, joined_session_id, left_session_id, joined_year, joined_month, joined_day, left_year, left_month, left_day, notes, created_at, where role is a free-text field with a maximum length of 100 characters.
2. WHEN a DM adds a character to a party, THE Journey_System SHALL create a membership record linking the character entity to the party entity, requiring party_id and entity_id, and setting joined_session_id to the current session when a session context is active.
3. WHEN a DM records a character leaving a party, THE Journey_System SHALL set the left_session_id and left date fields on the corresponding active membership record for that character in that party without deleting the record.
4. THE Journey_System SHALL allow a character to have multiple membership periods in the same party, provided no two periods for the same character and party overlap, where two periods overlap if one's joined_session_id is at or before the other's left_session_id and vice versa, and a period with no left_session_id is treated as extending indefinitely.
5. THE Journey_System SHALL allow a character to belong to multiple different parties during overlapping or non-overlapping time periods, with no restriction on simultaneous membership across different parties.
6. WHILE a membership record has no left_session_id and no left date, THE Journey_System SHALL treat that character as a current member of the party.
7. WHEN a DM queries the party membership at a given date, THE Journey_System SHALL return only the characters whose joined date is at or before the query date and whose left date is null or after the query date, where a partial date (year-only or year-and-month) is treated as spanning the entire calendar period it represents for comparison purposes.
8. IF a character entity is deleted, THEN THE Journey_System SHALL remove that character's membership records from all parties using ON DELETE CASCADE.
9. IF a party entity is deleted, THEN THE Journey_System SHALL remove all membership records for that party using ON DELETE CASCADE.
10. WHEN a DM queries the party membership at a given session, THE Journey_System SHALL return only the characters whose joined_session_id is at or before the queried session and whose left_session_id is null or at or after the queried session.
11. IF a DM attempts to add a character to a party while that character already has an active membership with no left_session_id in the same party, THEN THE Journey_System SHALL reject the addition and display an error message indicating the character is already an active member of that party.

### Requirement 3: Journey Persistence

**User Story:** As a DM, I want to record named journeys with a category, optional session link, and optional date range, so that I can organize travel history into coherent units.

#### Acceptance Criteria

1. THE Journey_System SHALL persist journeys in a `journeys` table with columns: id, campaign_id, party_id (nullable), session_id (nullable), name, category (Journey_Category), description, dm_notes, route_certainty (Route_Certainty), start_year, start_month, start_day, end_year, end_month, end_day, sort_order, created_at, updated_at.
2. WHEN a DM creates a journey, THE Journey_System SHALL require name (1 to 200 characters, trimmed of leading and trailing whitespace), category, and route_certainty, treat description (max 5000 characters), dm_notes (max 5000 characters), sort_order, date fields, session_id, and party_id as optional, and store a new row in the `journeys` table scoped to the active campaign with created_at and updated_at set to the current timestamp.
3. THE Journey_System SHALL allow each date component (start_year, start_month, start_day, end_year, end_month, end_day) to be null individually, and SHALL validate that provided month values are between 1 and 12 and provided day values are between 1 and 31.
4. THE Journey_System SHALL allow the session_id field to be null so that backstory and pre-campaign journeys exist without a session reference.
5. THE Journey_System SHALL allow the party_id field to be null so that individual character journeys and NPC journeys exist without a party reference.
6. WHEN a DM updates a journey, THE Journey_System SHALL persist the changes to the `journeys` table and update the `updated_at` timestamp.
7. WHEN a DM deletes a journey, THE Journey_System SHALL delete the journey row and cascade-delete all associated travel segments and segment participants without deleting any referenced entity (character, location, session, or party).
8. IF a DM attempts to update or delete a journey that does not exist, THEN THE Journey_System SHALL reject the operation and return an error indicating the journey was not found.

### Requirement 4: Travel Segment Persistence

**User Story:** As a DM, I want to record ordered travel legs within a journey, connecting origin and destination locations with optional waypoints, so that I can represent detailed routes.

#### Acceptance Criteria

1. THE Journey_System SHALL persist travel segments in a `travel_segments` table with columns: id, journey_id, origin_entity_id (nullable), destination_entity_id (nullable), waypoints (JSON array of objects with entity_id and optional x/y, maximum 50 waypoint entries per segment), start_year, start_month, start_day, end_year, end_month, end_day, sort_order (non-negative integer), route_certainty (one of: 'confirmed', 'estimated', 'speculative'), notes (maximum 5000 characters, nullable), created_at, updated_at.
2. WHEN a DM creates a travel segment, THE Journey_System SHALL store a new row in `travel_segments` linked to the parent journey by journey_id, assigning sort_order to one greater than the current maximum sort_order for that journey (or 0 if the journey has no existing segments).
3. THE Journey_System SHALL allow origin_entity_id and destination_entity_id to be null to represent partially known routes.
4. THE Journey_System SHALL allow all date fields on a segment to be null individually.
5. WHEN a DM reorders travel segments within a journey, THE Journey_System SHALL update the sort_order values of the affected segments.
6. IF an origin or destination entity is deleted, THEN THE Journey_System SHALL set the corresponding foreign key to null (ON DELETE SET NULL) rather than deleting the segment. IF a waypoint entity is deleted, THEN THE Journey_System SHALL remove that waypoint's entry from the waypoints JSON array of any segment referencing it.
7. WHEN a DM deletes a travel segment, THE Journey_System SHALL delete the segment and its associated records in the segment_participants table without deleting any referenced entities.
8. IF a DM attempts to create a travel segment with a journey_id that does not reference an existing journey, THEN THE Journey_System SHALL reject the creation and return an error indicating the journey was not found.

### Requirement 5: Segment Participant Tracking

**User Story:** As a DM, I want to specify which characters actually traveled on each segment, so that I can accurately represent party splits, temporary separations, and NPC accompaniment.

#### Acceptance Criteria

1. THE Journey_System SHALL persist segment participants in a `segment_participants` table with columns: id, segment_id, entity_id, role (text with a maximum length of 64 characters, e.g. "traveler", "guide", "escort"), notes (text with a maximum length of 2000 characters), created_at.
2. WHEN a DM adds a participant to a travel segment, THE Journey_System SHALL create a row linking the entity of kind pc or npc to that segment with the specified role, defaulting role to "traveler" when no role is provided.
3. THE Journey_System SHALL enforce a unique constraint on (segment_id, entity_id) to prevent duplicate participant entries on the same segment.
4. WHEN a DM queries a character's travel history, THE Journey_System SHALL return all travel segments where that character appears as a segment participant, joined with the parent journey name, journey category, and session reference, ordered by the segment's chronological sequence within each journey.
5. IF a character entity is deleted, THEN THE Journey_System SHALL remove that character's participant records using ON DELETE CASCADE.
6. IF a travel segment is deleted, THEN THE Journey_System SHALL remove all participant records for that segment using ON DELETE CASCADE.
7. IF a DM attempts to add a participant with an entity_id that does not reference an existing entity of kind pc or npc, or with a segment_id that does not reference an existing travel segment, THEN THE Journey_System SHALL reject the operation and return an error message indicating the invalid reference.
8. WHEN a DM removes a participant from a travel segment, THE Journey_System SHALL delete the corresponding segment_participants row and preserve all other participant records and the travel segment itself.

### Requirement 6: Extended Timeline Events

**User Story:** As a DM, I want to record rich timeline events with categories, multiple character associations, location links, journey links, confidence levels, and manual ordering, so that I can build detailed character histories beyond simple dated entries.

#### Acceptance Criteria

1. THE Journey_System SHALL add the following columns to the existing `timeline_events` table: category (Timeline_Event_Category, default 'general'), session_id (nullable), journey_id (nullable), segment_id (nullable), location_id (nullable), confidence (text: 'certain', 'probable', 'uncertain', default 'certain'), manual_order (integer, default 0).
2. THE Journey_System SHALL persist timeline event participant associations in a `timeline_event_participants` table with columns: id, event_id (REFERENCES timeline_events ON DELETE CASCADE), entity_id (REFERENCES entities ON DELETE CASCADE), role (text, maximum 100 characters), created_at, with a unique constraint on (event_id, entity_id, role).
3. WHEN a DM creates a timeline event, THE Journey_System SHALL store the event in `timeline_events` with the enriched fields and create participant rows for each associated character.
4. THE Journey_System SHALL allow a timeline event to exist without a location (location_id null) and without a session (session_id null).
5. THE Journey_System SHALL allow a timeline event to exist without a journey reference (journey_id null and segment_id null) for events unrelated to travel.
6. WHEN a DM assigns a manual_order to timeline events, THE Journey_System SHALL use manual_order as the primary sort key in ascending order (lower values first), falling back to year ascending, month ascending, day ascending for events with equal manual_order.
7. WHEN a timeline event has year null, THE Journey_System SHALL sort that event after all dated events that share the same manual_order value, using created_at as the final tiebreaker among null-year events.
8. IF a journey is deleted, THEN THE Journey_System SHALL set the journey_id and segment_id to null on associated timeline events (ON DELETE SET NULL) rather than deleting the events.
9. IF a timeline event specifies a segment_id, THEN THE Journey_System SHALL require a non-null journey_id on that event, rejecting the operation with an error indicating that a segment cannot exist without its parent journey reference.

### Requirement 7: Individual Character Journey View

**User Story:** As a DM, I want to see a character's complete travel history, chronological location list, companions, and associated events from their profile page, so that I can understand their story at a glance.

#### Acceptance Criteria

1. WHEN a DM opens a PC or NPC entity detail page, THE Journey_System SHALL display a "Journey & Timeline" tab showing all travel segments where that character is a participant, ordered by in-world start date ascending (oldest first), with segments that lack in-world dates placed after dated segments and sorted by creation timestamp ascending.
2. THE Journey_System SHALL display each travel segment with its origin name (or "Unknown origin" when no origin location is linked), destination name (or "Unknown destination" when no destination location is linked), journey category, associated session name (if a session is linked), date range in campaign calendar format (if in-world dates are recorded), route certainty indicator, and the names of all co-travelers on that segment.
3. THE Journey_System SHALL display a chronological timeline alongside the travel list, showing all timeline events associated with that character, grouped by linked session (using the session name as the group heading) when a session is associated and grouped under a "No session" heading when no session is associated, with events within each group ordered by in-world date ascending and undated events sorted by creation timestamp ascending.
4. WHEN a DM clicks a location name in the journey view, THE Journey_System SHALL navigate to that location's entity detail page.
5. WHEN a DM clicks a session reference in the journey view, THE Journey_System SHALL navigate to that session's entity detail page.
6. THE Journey_System SHALL display the character's current or last known location, derived from the destination of the travel segment with the latest in-world end date where the character is a participant, falling back to the latest creation timestamp when in-world dates are unavailable. IF no travel segments exist for the character, THEN THE Journey_System SHALL display "No known location" in place of the current location.
7. IF no travel segments and no timeline events exist for the character, THEN THE Journey_System SHALL display an empty state message within the "Journey & Timeline" tab indicating that no journey history has been recorded, along with an action to create the character's first journey or timeline event.

### Requirement 8: Party Journey View

**User Story:** As a DM, I want to see a party's shared route, membership history, and session-by-session travel, so that I can track the group's collective story.

#### Acceptance Criteria

1. WHEN a DM opens a party entity detail page, THE Journey_System SHALL display the party's membership history showing all current and past members ordered by join date ascending, with current members distinguished from past members by showing past members' leave dates or sessions.
2. WHEN a DM opens a party entity detail page, THE Journey_System SHALL display all journeys associated with the party, ordered by sort_order when set, otherwise by start date ascending.
3. WHEN a DM opens a party entity detail page, THE Journey_System SHALL display travel segments for each party journey in sequence order, showing which members participated on each segment.
4. WHEN a DM selects a specific member from the party view, THE Journey_System SHALL filter the display to show only the journeys, segments, and timeline events where that member participated.
5. WHEN a DM selects a specific session from the party view, THE Journey_System SHALL filter the display to show only journeys and segments linked to that session.
6. IF a party has no journeys and no members, THEN THE Journey_System SHALL display an empty-state message indicating no journeys or members have been recorded.
7. WHEN a DM clears member or session filters, THE Journey_System SHALL reset the display to show all journeys, segments, and events for the party.

### Requirement 9: World Atlas Route Overlay

**User Story:** As a DM, I want to see travel routes drawn as lines on the world atlas map, so that I can visually trace where characters and parties have traveled.

#### Acceptance Criteria

1. WHEN a DM activates the journey overlay on the atlas page, THE Route_Overlay SHALL render travel segments as SVG polylines inside the existing `dm-workbench-overlay` group in the Azgaar map iframe.
2. THE Route_Overlay SHALL position each polyline endpoint at the Map_Coordinate (x, y) of the corresponding origin or destination entity as recorded in the `map_feature_links` table.
3. WHEN a travel segment includes waypoints with x/y coordinates, THE Route_Overlay SHALL draw the polyline through each waypoint in sequence from origin to destination.
4. THE Route_Overlay SHALL assign each Journey_Category a unique combination of stroke color and dash pattern: solid lines for `campaign` and `party` travel each in a different color, dashed lines for `backstory` travel, dotted lines for `uncertain` travel, dash-dot lines for `flashback` travel, and solid lines in separate colors for `individual` and `npc` travel, such that no two categories share both the same color and the same dash pattern.
5. WHILE the journey overlay is active, THE Route_Overlay SHALL display a legend panel listing each Journey_Category that has at least one visible segment on the map, showing that category's name alongside a sample of its stroke color and dash pattern.
6. WHILE the DM pans or zooms the Azgaar map, THE Route_Overlay SHALL remain aligned with the underlying map features.
7. IF exactly one of a travel segment's origin or destination entity has no map_feature_link, THEN THE Route_Overlay SHALL draw the polyline only to the mapped endpoint and display an "unmapped" label at that endpoint.
8. IF the world map is regenerated and a linked map feature disappears, THEN THE Route_Overlay SHALL skip the affected segment and show a "(missing location)" label next to that route's entry in the legend.
9. IF both the origin and destination of a travel segment lack a map_feature_link, THEN THE Route_Overlay SHALL omit that segment from the map and append an "unmapped segment" indicator for that segment in the legend panel.
10. WHEN the DM deactivates the journey overlay, THE Route_Overlay SHALL remove all route polylines and the legend panel from the map.
11. IF the journey overlay is activated and no travel segments with mapped coordinates exist for the current filter selection, THEN THE Route_Overlay SHALL display an empty-state message in the legend panel indicating that no routes are available to display.

### Requirement 10: Route Segment Interaction

**User Story:** As a DM, I want to click a route segment on the atlas to see journey details, travelers, events, and linked entities, so that I can explore travel history from the map.

#### Acceptance Criteria

1. WHEN a DM clicks a rendered route polyline on the atlas, THE Journey_System SHALL open a contextual side panel displaying the segment's origin, destination, journey name, journey category, travelers, associated session, date range, events, and notes, replacing any previously displayed segment panel content and omitting fields that have no data.
2. THE Journey_System SHALL render each route polyline with a transparent hit-area wide enough (at least 8 pixels at the current zoom level) to be clickable.
3. WHEN a DM clicks a traveler name in the segment panel, THE Journey_System SHALL navigate to that character's entity detail page.
4. WHEN a DM clicks a location name in the segment panel, THE Journey_System SHALL navigate to that location's entity detail page.
5. WHEN a DM clicks a session reference in the segment panel, THE Journey_System SHALL navigate to that session's entity detail page.
6. IF a referenced entity in the segment panel no longer exists, THEN THE Journey_System SHALL render the entity name as plain text without a navigation link.

### Requirement 11: Route Filtering

**User Story:** As a DM, I want to filter displayed routes by character, party, session, date range, and journey category, so that I can focus on specific travel without visual clutter.

#### Acceptance Criteria

1. WHEN the journey overlay is active, THE Journey_System SHALL display a filter toolbar on the atlas page with controls for: character selection (multi-select), party selection (multi-select), session selection (multi-select), journey category selection (multi-select), date range selection (start date and end date), and a toggle to show or hide all routes, with all filters initially unset and all routes visible.
2. WHEN a DM selects one or more characters in the filter, THE Route_Overlay SHALL display only segments where at least one selected character is a participant.
3. WHEN a DM selects one or more parties in the filter, THE Route_Overlay SHALL display only segments belonging to journeys associated with at least one of the selected parties.
4. WHEN a DM selects one or more sessions in the filter, THE Route_Overlay SHALL display only segments belonging to journeys associated with at least one of the selected sessions.
5. WHEN a DM selects one or more journey categories in the filter, THE Route_Overlay SHALL display only segments from journeys matching at least one of the selected categories.
6. WHEN a DM toggles "hide all routes," THE Route_Overlay SHALL remove all route polylines from the map, leaving the atlas page with no journey routes or route legend displayed.
7. THE Journey_System SHALL allow multiple filter criteria to be combined, applying all active filters with AND logic so that a segment is displayed only when it satisfies every active filter.
8. WHEN a DM sets a date range in the filter, THE Route_Overlay SHALL display only segments belonging to journeys whose in-world travel dates overlap with the specified start and end dates.
9. IF the active filter combination matches no segments, THEN THE Route_Overlay SHALL display no route polylines and THE Journey_System SHALL display a message indicating that no routes match the current filters.
10. WHEN a DM clears all filters, THE Journey_System SHALL reset every filter control to its unset state and THE Route_Overlay SHALL display all route segments from all journeys.

### Requirement 12: Session Travel Summary

**User Story:** As a DM, I want each session to display a travel summary with ordered stops, participants, and events, so that I can reconstruct what happened geographically during that session.

#### Acceptance Criteria

1. WHEN a DM opens a session entity detail page, THE Journey_System SHALL display a "Travel" section listing all journeys and their travel segments associated with that session, ordered by segment sort_order.
2. THE Journey_System SHALL display each segment's origin location name, destination location name, participant names, and associated timeline event titles within each segment's entry in the travel section.
3. IF multiple journeys exist for the same session (e.g., party splits), THEN THE Journey_System SHALL display each journey as a separate group within the travel section, identified by the journey's name.
4. WHEN a DM creates a new journey or travel segment from the session page, THE Journey_System SHALL automatically set the session_id to the current session.
5. WHEN a DM clicks a location name in the session travel summary, THE Journey_System SHALL navigate to that location's entity detail page.
6. IF no journeys or travel segments are associated with the current session, THEN THE Journey_System SHALL display an empty-state message in the Travel section indicating that no travel has been recorded for this session.
7. IF a travel segment's origin or destination location is null, THEN THE Journey_System SHALL display a placeholder label indicating an unknown location in place of the missing location name, and that placeholder SHALL NOT be clickable.

### Requirement 13: Backstory Journey Workflow

**User Story:** As a DM, I want to build a character's pre-campaign travel history and milestones through a timeline editor, so that I can develop backstories before the campaign begins.

#### Acceptance Criteria

1. WHEN a DM creates a journey with category `backstory`, THE Journey_System SHALL allow the session_id to remain null.
2. WHEN a DM creates a backstory journey, THE Journey_System SHALL allow the journey-level start date, journey-level end date, and each travel segment's start and end dates to remain null independently of one another to represent uncertain historical periods.
3. WHEN a DM adds a travel segment to a backstory journey and the selected origin or destination location does not yet exist as an entity, THE Journey_System SHALL provide an inline creation control requiring at minimum a name and a geographic kind, and SHALL automatically assign the newly created entity as the segment's origin or destination respectively.
4. THE Route_Overlay SHALL render backstory travel segments with a visually distinct style (dashed lines) that is clearly different from campaign travel segments (solid lines).
5. WHEN a DM edits a backstory journey after at least one session in the campaign has reached status `done`, THE Journey_System SHALL preserve all existing entity links, map feature links, and participant references, and SHALL NOT allow deletion of a travel segment that is referenced by other entities without first displaying a confirmation listing the affected references.
6. IF the name entered during inline location creation matches an existing entity of a geographic kind in the same campaign, THEN THE Journey_System SHALL offer the option to link to that existing entity instead of creating a duplicate.

### Requirement 14: Journey and Timeline Editing

**User Story:** As a DM, I want full CRUD operations on journeys, segments, participants, and timeline events with support for reordering, relinking, and safe deletion, so that I can correct and evolve travel records over time.

#### Acceptance Criteria

1. THE Journey_System SHALL allow a DM to create, read, update, and delete journeys through a dedicated journey editor accessible from character, party, session, and atlas pages.
2. THE Journey_System SHALL allow a DM to add, remove, and reorder travel segments within a journey.
3. THE Journey_System SHALL allow a DM to add and remove participants on any travel segment.
4. THE Journey_System SHALL allow a DM to change a travel segment's origin, destination, or waypoints without deleting the segment.
5. THE Journey_System SHALL allow a DM to change the session associated with a journey without recreating the journey.
6. WHEN a DM changes a shared journey (one with multiple participants), THE Journey_System SHALL persist the change to the canonical journey record so that every participant's individual journey view and the session travel summary display the updated data on next load without requiring separate edits per participant.
7. THE Journey_System SHALL allow a DM to link and unlink timeline events to journeys or segments without deleting the timeline event.
8. THE Journey_System SHALL allow a DM to create and edit timeline events with the following fields from any timeline view: category, location, session, journey, confidence (one of: certain, probable, uncertain, or unknown), manual_order (integer sort position), and participant associations.
9. IF a DM removes a participant from a segment, THEN THE Journey_System SHALL delete only the participant record without affecting the segment, the journey, or the character entity.
10. WHEN a DM deletes a journey, THE Journey_System SHALL cascade-delete all travel segments and segment participant records belonging to that journey, unlink any associated timeline events without deleting them, and leave all referenced character, location, and session entities unchanged.
11. WHEN a DM removes a travel segment from a journey, THE Journey_System SHALL delete the segment's participant records, unlink any timeline events associated with that segment without deleting them, and leave the parent journey and all referenced entities unchanged.

### Requirement 15: Character DM Reference View

**User Story:** As a DM, I want a character-focused overview summarizing origins, journey highlights, key relationships, secrets, and plot hooks, so that I can quickly recall important information during play.

#### Acceptance Criteria

1. WHEN a DM opens a PC or NPC entity detail page, THE Journey_System SHALL display a "DM Reference" section containing: character summary (derived from the entity's dm_notes_md field), origin location, most recent location, backstory events (derived from all timeline events associated with backstory journeys where the character is a participant), NPC relationships (derived from entity_links where the linked entity has kind `npc`), faction affiliations, active quests, items (derived from item_instances where the character is the owner), known secrets (derived from the entity's secret_md field), unresolved plot hooks (derived from timeline events associated with the character with event category `plot_hook` that are not tagged as `resolved`), and last session appeared.
2. THE Journey_System SHALL derive the origin location from the earliest backstory travel segment where the character is a participant.
3. THE Journey_System SHALL derive the most recent location from the latest travel segment's destination where the character is a participant.
4. THE Journey_System SHALL derive the last session appeared from the most recent journey with a non-null session_id where the character is a participant.
5. THE Journey_System SHALL derive faction affiliations from existing entity_links with relation `member_of` where the target entity has kind `faction`.
6. THE Journey_System SHALL derive active quests from existing entity_links with relation `related` where the target entity has kind `quest` and the quest entity's status is not `completed`.
7. IF any derived field in the DM Reference section has no matching data, THEN THE Journey_System SHALL display that field with a label indicating no data is available.

### Requirement 16: Database Migration and Schema Integrity

**User Story:** As a DM, I want all journey data to persist across application restarts and upgrades, so that I do not lose travel history.

#### Acceptance Criteria

1. THE Journey_System SHALL implement all schema changes as a forward-only migration appended to the existing `MIGRATIONS` array in `src/persistence/migrations.ts`, incrementing the schema version.
2. THE Journey_System SHALL create foreign keys with ON DELETE CASCADE for ownership relationships (journey → segments, segment → participants, party → memberships) and ON DELETE SET NULL for reference relationships (segment → origin/destination entity, journey → session, timeline_event → journey).
3. THE Journey_System SHALL create indexes on the following foreign key columns: `journeys.campaign_id`, `journeys.party_id`, `journeys.session_id`, `travel_segments.journey_id`, `segment_participants.segment_id`, `segment_participants.entity_id`, `party_memberships.party_id`, `party_memberships.entity_id`.
4. WHEN the application starts with an older schema version, THE Journey_System SHALL apply pending migrations automatically before rendering the UI, consistent with the existing migration runner.
5. IF a migration fails with an ignorable error (e.g. duplicate column from a partial previous run), THEN THE Journey_System SHALL skip that error and record the migration as applied, consistent with the existing `isIgnorableMigrationError` pattern.
6. IF a migration fails with a non-ignorable error, THEN THE Journey_System SHALL halt the migration sequence, not record the failed migration in `schema_migrations`, and propagate the error to prevent the application from rendering the UI with an incomplete schema.

### Requirement 17: Route Geometry Coordinate Handling

**User Story:** As a DM, I want route overlays to use actual map coordinates from linked locations, so that routes align correctly with the world atlas at all zoom levels.

#### Acceptance Criteria

1. WHEN resolving coordinates for a route segment point, THE Route_Overlay SHALL use explicit x/y values stored on the waypoint record if present; otherwise, it SHALL look up the referenced entity's x/y coordinates from the `map_feature_links` table for the active world map.
2. WHEN a travel segment's waypoint includes explicit x/y coordinates, THE Route_Overlay SHALL use those stored coordinates directly.
3. WHEN a travel segment's waypoint references an entity_id without explicit x/y values on the waypoint record, THE Route_Overlay SHALL look up that entity's coordinates from `map_feature_links`.
4. IF an entity referenced by a segment has no `map_feature_links` entry for the active map, or the matching entry contains null x or y coordinates, THEN THE Route_Overlay SHALL skip that point in the polyline rendering, connect the remaining adjacent points directly, and display a warning in the journey overlay panel identifying the unresolvable entity by name.
5. THE Route_Overlay SHALL store all route geometry in the Azgaar map coordinate system, not in screen pixel coordinates, so that routes remain stable across zoom and pan operations.

### Requirement 18: Navigation and Discoverability

**User Story:** As a DM, I want to access journey and timeline features from character profiles, party pages, sessions, and the atlas, so that I can find travel history from any relevant context.

#### Acceptance Criteria

1. WHEN a DM views a PC or NPC entity detail page, THE Journey_System SHALL display a "Journey & Timeline" tab and a "DM Reference" tab within the entity detail tab bar, alongside the existing entity tabs (Overview, Details, Read-aloud, DM notes, Secrets, Links, and Inventory where applicable).
2. WHEN a DM views a session entity detail page, THE Journey_System SHALL display a "Travel" tab within the session entity detail tab bar showing travel segments associated with that session in chronological order.
3. WHEN a DM views the atlas page, THE Journey_System SHALL provide a toggle control to activate the journey route overlay, with the overlay inactive by default.
4. WHEN a DM views a party entity detail page, THE Journey_System SHALL display the party's membership history, shared journeys, and travel segments, each as a scrollable list within the party detail view.
5. WHEN a DM clicks a location in a character's journey view and that location has linked map coordinates, THE Journey_System SHALL provide a "Show on atlas" action that navigates to the atlas page with the journey overlay active and the map centered on that location's coordinates.
6. THE Journey_System SHALL register the `party` entity kind in the existing ENTITY_KINDS array, KIND_LABELS map, and MODULE_FOR_KIND mapping, and include a routeForEntity rule, so that parties appear in global search, entity pickers, and navigation routing.
7. IF a DM clicks "Show on atlas" for a location that has no linked map coordinates, THEN THE Journey_System SHALL display a message indicating the location cannot be shown on the atlas and SHALL remain on the current page.
8. IF a character, party, or session has no associated journey or travel segment data, THEN THE Journey_System SHALL display an empty state message within the respective journey tab indicating no travel history exists and offering an action to create a new journey record.

### Requirement 19: Journey Playback

**User Story:** As a DM, I want to replay a character's or party's journey chronologically with a timeline slider, so that I can visualize how travel unfolded over time.

#### Acceptance Criteria

1. WHEN a DM activates playback mode on the atlas journey overlay, THE Journey_System SHALL display a timeline slider control with one discrete position per filtered travel segment, arranged in playback order (as defined by criterion 6), plus an initial position before the first segment.
2. WHEN the DM moves the slider forward, THE Route_Overlay SHALL progressively reveal route segments up to the selected position and SHALL render a visually distinct marker (different in shape or size from route endpoints) at the destination of the currently selected segment to indicate the current location.
3. WHEN the DM moves the slider backward, THE Route_Overlay SHALL hide route segments beyond the selected point in time.
4. WHILE playback mode is active, THE Journey_System SHALL display a side panel showing: the currently selected segment's origin, destination, and journey name; the segment's participants (travelers); and all timeline events associated with that segment. IF no timeline events are associated with the currently selected segment, THEN the side panel SHALL omit the events list and display only the segment details and travelers.
5. THE Journey_System SHALL provide step-forward, step-backward, and jump-to-session controls alongside the slider. Step-forward SHALL advance the slider by one segment in playback order; step-backward SHALL move it back by one segment. Jump-to-session SHALL move the slider to the first segment whose parent journey is linked to the selected session.
6. THE Journey_System SHALL derive playback ordering from segment sort_order within each journey and from journey start dates, falling back to manual_order when dates are unavailable.
7. IF no travel segments match the active filters when playback mode is activated, THEN THE Journey_System SHALL display the slider in a disabled state and show a message indicating that no segments are available for playback.

### Requirement 20: Character Route Comparison

**User Story:** As a DM, I want to compare the travel routes of two or more characters side by side on the atlas, so that I can see where their paths overlapped and diverged.

#### Acceptance Criteria

1. WHEN a DM selects 2 to 6 characters in the atlas journey filter, THE Route_Overlay SHALL render each character's travel segments with a stroke color unique to that character within the current selection.
2. WHEN 2 or more characters are selected in the atlas journey filter, THE Route_Overlay SHALL render a shared marker at each location that appears as origin, destination, or waypoint in the travel segments of more than one selected character.
3. WHEN 2 or more characters are selected in the atlas journey filter, THE Journey_System SHALL display a comparison panel listing locations visited by all selected characters, locations visited by only a subset of the selected characters, and the sessions linked to travel segments where 2 or more of the selected characters appear as segment participants.
4. IF fewer than 2 characters are selected in the atlas journey filter, THEN THE Journey_System SHALL hide the comparison panel and the shared-location markers.
5. IF a selected character has no travel segments, THEN THE Journey_System SHALL indicate in the comparison panel that no route data is available for that character.

### Requirement 21: Location Visit History

**User Story:** As a DM, I want to see which characters and parties visited a location, when they visited, and what events occurred there, so that I can understand a location's narrative significance.

#### Acceptance Criteria

1. WHEN a DM views a location entity detail page, THE Journey_System SHALL display a "Visit History" section listing all travel segments where that location appears as origin_entity_id, destination_entity_id, or in the waypoints array, sorted by segment start date in reverse chronological order (most recent first), then by sort_order for segments with equal or null dates.
2. THE Journey_System SHALL display each visit entry with the segment participants, the location's role in the segment (origin, destination, or waypoint), journey name, journey category, session reference (if linked), and date range (if known).
3. WHILE the journey overlay is active, WHEN a DM clicks a location marker on the atlas, THE Journey_System SHALL display the visit history for that location in the segment detail panel.
4. IF no travel segments reference the viewed location as origin, destination, or waypoint, THEN THE Journey_System SHALL display an empty-state message in the Visit History section indicating that no visits have been recorded for that location.
