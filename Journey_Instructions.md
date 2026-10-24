# Feature: Character Journeys, Party Travel, and Individual Timelines

## Your Role

Act as a senior software engineer working on my existing private D&D Dungeon Master desktop application.

Implement a complete **Character Journey & Timeline System** that integrates with the application's existing world atlas, character database, NPC records, campaign sessions, locations, and worldbuilding system.

This is an addition to the existing application, not a new standalone project. Inspect the current codebase, understand the existing architecture, and reuse its established components, models, persistence layer, and map integration wherever possible.

The application is exclusively for me as the DM. All information is private and local to the desktop application. Do not add player accounts, player access, or public timeline sharing.

Do not stop at a design document or mockup. Implement the feature, persist its data, integrate it into the UI, and test the core workflows.

---

# 1. Product Vision

I want to track the complete journeys of individual characters and groups across the world, both before and during the campaign.

For any player character, NPC, or party, I should be able to answer:

- Where have they traveled?
- What route did they take?
- When did they visit each location?
- Which session did each journey take place in?
- What happened at each stop?
- Who traveled with them?
- When did they join or leave a party?
- What did they do before the campaign began?
- What important events, discoveries, relationships, or backstory details should I remember about them?
- Where were they at a particular point in the campaign?
- Which locations have they visited together, and which have they visited separately?

These details should be accessible through both a chronological timeline and a visual route drawn on the world atlas.

The same underlying journey data must power both views. I should never need to separately maintain a map route and a timeline entry.

## Example

Suppose a character named Arin has the following history:

1. Grew up in a small village in the north.
2. Traveled alone to a nearby city before the campaign began.
3. Joined the adventuring party in that city during Session 1.
4. Traveled with the party to an ancient ruin during Session 2.
5. Left the party temporarily during Session 3 and traveled to a nearby settlement.
6. Rejoined the party during Session 4.
7. Discovered that the ancient ruin was connected to a secret from their backstory.

I should be able to open Arin's profile and see this history chronologically.

I should also be able to open the world atlas, select Arin, and see their complete route, with different visual treatments for backstory travel, individual travel, and party travel.

Clicking a route segment should show when the journey occurred, which session it belongs to, who accompanied Arin, and any associated events or notes.

---

# 2. First: Inspect the Existing Application

Before coding, inspect the current repository.

Determine how the application currently represents:

- Campaigns and worlds.
- World maps and geographic features.
- Locations and settlements.
- Player characters and NPCs.
- Parties or groups, if already supported.
- Sessions and in-game dates.
- Historical events and timeline records.
- Persistent storage and database migrations.
- Navigation and detail panels.
- Map overlays, markers, and selected map entities.

Reuse existing models and services where appropriate.

Do not create duplicate character, location, session, or timeline systems if the application already has them.

If a party entity does not exist, implement a reusable party/group model that can contain both player characters and NPCs.

If a general timeline system already exists, extend it rather than introducing a competing implementation.

Create a concise implementation plan identifying the necessary schema changes, UI components, and integration points. Then proceed with implementation without waiting for further approval.

---

# 3. Core Concept: A Unified Journey Model

Design the feature around a persistent journey model that connects geographic movement with chronological history.

Distinguish between three related concepts:

1. **Journey:** A character's or party's overall route or travel history.
2. **Travel segment:** Movement from one location to another, potentially including intermediate stops.
3. **Timeline event:** Something important that happened at a location or during a journey.

A journey may contain multiple travel segments. A segment may have multiple travelers and associated events. A timeline event may be associated with a location, journey, session, character, party, or several of these simultaneously.

Keep these relationships explicit in the data model.

## Journey types

Support at least:

- Backstory travel.
- Individual character travel.
- Party travel.
- NPC travel.
- Temporary separation from a party.
- Travel with a subset of party members.
- Flashbacks or retrospectively recorded journeys.
- Uncertain or partially known travel history.

A character's backstory journey should not need to belong to a session.

Likewise, a journey that occurred during a session should be linked to the appropriate session whenever known.

Support manually recorded journeys even when exact dates or complete routes are unknown.

---

# 4. Individual Character Journeys

Every player character and NPC should have a dedicated journey view accessible from their existing profile.

The view should show:

- Their complete travel history.
- A chronological list of locations visited.
- Their route on the world atlas.
- The dates or in-world time periods associated with each journey.
- The campaign session associated with each event, if applicable.
- The people who accompanied them.
- Important events that occurred along the way.
- Relevant backstory details and DM-only notes.
- Their current or last known location.
- Their relationships to parties and other travelers.

Support both historical and current journeys.

## Recording a journey

I should be able to manually create a travel record by selecting:

- The traveling character.
- The origin.
- The destination.
- Optional intermediate stops.
- The journey type.
- The associated campaign session, if applicable.
- The in-world start and end times, if known.
- Accompanying characters and NPCs.
- A description and DM-only notes.
- Important events that occurred along the route.

Do not force me to provide every field. In particular, exact dates and precise routes may be unknown for backstory travel.

Allow me to edit, reorder, correct, split, or merge travel records without corrupting the associated timeline.

When the origin or destination is known but the exact path is not, allow me to represent the journey as a connection between those locations without claiming that the characters followed a specific road.

---

# 5. Party and Group Travel

Implement a party/group journey view.

A party is a collection of characters and NPCs whose membership can change over time.

I should be able to track:

- The group's shared route.
- Locations visited together.
- Travel during individual sessions.
- Important events along the route.
- Party membership changes.
- Characters who joined or left.
- Temporary separations.
- NPCs who accompanied the party for only part of a journey.
- Multiple simultaneous or overlapping journeys.

## Dynamic membership

Party membership must be time-aware.

For example:

- Arin joins the party in Session 1.
- Mira joins in Session 2.
- An NPC travels with them between two settlements during Session 3.
- Arin temporarily leaves in Session 4.
- Mira and the remaining members continue traveling.
- Arin rejoins in Session 5.

The system must preserve these differences.

Do not assume that every character in a party participated in every journey associated with that party.

When a group journey is recorded, allow me to specify which characters and NPCs actually traveled on that segment.

Support party creation, renaming, membership changes, and historical membership records.

A character should be able to belong to different groups at different times, and the system should preserve that history.

## Shared and individual route views

Provide these perspectives:

- A party's complete route.
- A specific character's complete route.
- A specific character's route while traveling with a party.
- A party's route during a selected session.
- A comparison of multiple characters' routes.

Where several characters traveled together, represent the shared journey efficiently without duplicating the underlying travel record for every character.

Individual character timelines should still show that character's participation in the shared journey.

---

# 6. World Atlas Route Visualization

This is one of the most important parts of the feature.

Integrate route visualization into the application's existing world atlas.

Do not build an unrelated map viewer or replace the existing world map editor.

## Route rendering

Draw travel routes directly on the world map as lines connecting geographic locations.

Where practical, support intermediate waypoints and curved or road-following paths. Otherwise, use clear straight-line connections between known points.

The system must distinguish between:

- Backstory travel.
- Individual travel during the campaign.
- Shared party travel.
- NPC travel.
- Uncertain or approximate routes.

Use a clear, configurable visual style. For example, use different colors, dash patterns, or line opacity for different journey categories.

Provide a legend explaining the route styles.

Avoid clutter when multiple characters have traveled through the same area.

## Map interaction

When I click a route segment, open a contextual panel containing:

- Origin and destination.
- Intermediate stops.
- Character or party.
- Travelers on that segment.
- Journey type.
- Associated session.
- In-world date or time period.
- Relevant events.
- Notes.
- Links to related character profiles, locations, and sessions.

When I click a location marker along a route, show the relevant visit history for the selected character or party.

If several characters visited the same location at different times, allow me to distinguish their visits.

Support selecting a location from a character's timeline and automatically navigating to that location on the world atlas.

## Route filters

Provide controls to filter displayed routes by:

- Character.
- Party.
- NPC.
- Campaign session.
- In-world date range.
- Backstory versus campaign travel.
- Journey type.
- Selected location.
- Known versus uncertain travel.

Allow multiple characters to be selected simultaneously.

Include a clear way to hide all routes and return to the normal world map.

Route visualization should be an overlay on the existing map, not a modification of the underlying map data.

Persist user preferences for route visibility where appropriate.

---

# 7. Session-Based Travel Tracking

I want to see exactly how the party and its members traveled during each session.

Integrate the journey system with the existing session manager.

Each session should be able to display a travel summary, including:

- Starting location.
- Intermediate locations.
- Final location.
- Travel segments in chronological order.
- Characters and NPCs present on each segment.
- Encounters or events associated with stops.
- Important discoveries and conversations.
- Detours and temporary separations.
- DM notes.

## Session route view

Add a travel section to each session record.

It should show the route taken during that session and a chronological list of stops and events.

For example:

Session 7: The Road to Black Hollow

1. Departed from Stonebridge.
2. Traveled through the Ashen Forest with the full party.
3. Encountered a merchant at a roadside shrine.
4. Split into two groups to investigate separate trails.
5. Reunited at an abandoned watchtower.
6. Reached Black Hollow before nightfall.

Each entry should be clickable and linked to its relevant locations, characters, events, and encounters.

Support multiple routes within the same session when the party splits up.

Allow me to create travel entries directly from a session without leaving the session interface.

## Linking existing sessions

If a session already contains relevant location references, offer a convenient way to associate them with journey records.

Do not silently infer a precise route merely from a list of locations in a session. Let me confirm the order and whether the locations represent actual travel stops.

Support adding a travel record to an existing session retroactively.

---

# 8. Individual Character Timelines

Every player character and NPC should have a chronological timeline.

The timeline should contain both travel and other significant events, not just a list of visited locations.

Support event categories such as:

- Birth and upbringing.
- Backstory milestones.
- Past residences.
- Travel and migration.
- Meeting important characters.
- Joining or leaving a party.
- Important conversations.
- Quests accepted or completed.
- Discoveries and revelations.
- Acquiring or losing important items.
- Battles and significant encounters.
- Injuries, curses, or lasting consequences.
- Relationship changes.
- Faction membership.
- Character goals and unresolved personal plotlines.
- Major campaign events.
- Personal secrets and future story hooks.

Each timeline entry should support:

- Title.
- Description.
- Event category.
- Character or characters involved.
- Location, if applicable.
- In-world date or approximate time period.
- Associated session, if applicable.
- Associated journey or travel segment, if applicable.
- Related NPCs, factions, items, quests, and lore.
- DM-only notes.
- Confidence or certainty, if the event is based on incomplete information.
- Tags.

Allow timeline events that have no geographic location.

For example, a secret revelation may be important to the character's history even if no specific map location is associated with it.

## Chronological organization

Provide a chronological timeline with:

- Newest-first and oldest-first ordering.
- Grouping by session or in-world time period.
- Filters for event type.
- Filters for backstory and campaign events.
- Search.
- Expandable event details.
- Links to related entities.

Support approximate and unknown dates without forcing artificial timestamps.

If events have known ordering but uncertain dates, allow me to order them manually or mark their relative sequence.

Distinguish between the real-world session date and the fictional in-world date. They are not interchangeable.

---

# 9. Backstory Management

Backstory tracking deserves special attention.

Before a character joins the campaign, they may have lived in multiple settlements, traveled extensively, met NPCs, joined factions, completed quests, or experienced important events.

I want to build that history in advance, even when the campaign has not started.

Provide a convenient workflow for creating a character's backstory through either:

1. A chronological timeline editor.
2. A visual map-based route editor.

These views must use the same underlying records.

## Backstory route editor

Allow me to:

- Select a character.
- Select a starting location.
- Add destinations and intermediate stops.
- Reorder those stops.
- Record important events at each stop.
- Associate NPCs and factions.
- Enter approximate dates or periods.
- Write private notes explaining what happened.
- Mark the route as uncertain where appropriate.

When I add a backstory location, allow me to associate it with an existing world location or create a new one.

When a character's backstory contains a location that has not been created yet, make it easy to create the location without losing my current editing context.

Backstory travel should be visually distinguishable from travel during the campaign.

Allow backstory details to be updated as I develop the campaign without breaking established references.

---

# 10. A Character's Story and DM Reference View

In addition to the chronological timeline, provide a character-focused overview that helps me quickly understand who the character is and how their history affects the campaign.

This is a private DM reference page.

It should include:

- A concise character summary.
- Their origins and significant past locations.
- Their journey across the world.
- Important backstory events.
- Significant NPCs and relationships.
- Factions and affiliations.
- Personal quests and goals.
- Important items.
- Known secrets.
- Unresolved plot hooks.
- Major events since joining the campaign.
- Their current party and recent whereabouts.
- The last session in which they appeared.

Allow me to pin especially important information to the top.

Provide an editable DM summary that can be maintained separately from the detailed timeline.

Do not attempt to automatically invent character backstories. This is a management and reference tool for information I create.

---

# 11. Timeline and Route Editing

The journey and timeline system must be editable after the fact.

I should be able to:

- Add a new event between two existing events.
- Correct a location.
- Change a travel segment's participants.
- Reorder events.
- Change the associated session.
- Add missing intermediate stops.
- Mark a journey as approximate.
- Merge duplicate events.
- Correct the date or sequence of an event.
- Link an event to an existing NPC, quest, or item.
- Remove a relationship without accidentally deleting the underlying entity.

Use stable IDs and explicit relationships.

If a route is changed, all related character timelines, party timelines, and session summaries should reflect the updated data.

Avoid storing separate, manually maintained copies of the same information in each view.

Where a journey is shared by multiple characters, use a canonical shared travel record with explicit participation relationships.

If a timeline event belongs to multiple characters, support that association without creating unnecessary duplicate event records.

---

# 12. Data Model and Persistence

Adapt the existing database and models rather than replacing them.

The exact schema should be based on the current application, but the system will likely require concepts equivalent to:

## Journey

- Stable ID.
- Campaign ID.
- Name or summary.
- Journey category.
- Optional party ID.
- Optional session ID.
- Start and end dates or time periods.
- Description.
- DM notes.
- Route certainty.
- Creation and modification timestamps.

## Travel segment

- Stable ID.
- Journey ID.
- Origin location ID, when known.
- Destination location ID, when known.
- Ordered waypoints.
- Start and end times, when known.
- Sequence within the journey.
- Optional associated session.
- Route geometry or geographic reference, where appropriate.
- Segment-specific notes.
- Certainty and route precision.

## Journey participant

- Journey or segment ID.
- Character or NPC ID.
- Participation role.
- Participation start and end, if relevant.
- Optional party membership reference.

Use a polymorphic participant model only if it fits the existing architecture safely. Otherwise, use explicit relationships or a suitable shared character/NPC abstraction.

## Timeline event

- Stable ID.
- Campaign ID.
- Title and description.
- Event category.
- In-world date or approximate time.
- Known sequence or ordering information.
- Optional location.
- Optional session.
- Optional journey or travel segment.
- Notes.
- Certainty.
- Tags.
- Creation and modification timestamps.

## Event participants and relationships

Represent relationships to characters, NPCs, parties, quests, factions, items, and other relevant entities explicitly.

Do not depend on display names as foreign keys.

## Important data invariants

- Every record must belong to the appropriate campaign.
- A journey can exist without a session.
- A timeline event can exist without a location.
- A character can have individual journeys and participate in shared journeys.
- Party membership can change over time.
- A party travel segment must record which members actually participated.
- Dates can be unknown or approximate.
- Route geometry must be separate from native world map data.
- Deleting a route or timeline entry must not accidentally delete the character, location, or session it references.
- Changes must persist across application restarts.

Use appropriate database migrations, indexes, transactions, and referential integrity.

# 13. Route Geometry and Geographic Accuracy

The world atlas should render routes using the actual coordinates of linked geographic locations whenever available.

Inspect the existing map model to determine how geographic coordinates and feature references should be represented.

Avoid hardcoding screen pixel positions as permanent geographic coordinates.

If the map supports projection or viewport transformations, convert between geographic or map coordinates and screen coordinates appropriately.

If the map is zoomed or panned, route overlays must remain aligned with the relevant locations.

If the world map is regenerated or a linked feature disappears, handle the missing reference gracefully.

Where exact geographic routing is not available, use a direct connection between known locations and label it as schematic rather than implying that it follows actual roads.

If route paths are manually drawn, store their geometry in a stable map coordinate system.

Support multiple map scales where practical, ensuring that a journey can be represented consistently on the world map and on a more detailed regional map if both exist.

---

# 14. User Interface Integration

Integrate this feature into the existing desktop application rather than creating an isolated tool.

Add or extend the following interfaces as appropriate:

### Character profile

Add a Journey & Timeline section to every character and NPC profile.

Provide a route preview, a chronological timeline, and quick access to backstory, recent travel, and important events.

### Party profile

Show the party's route, membership history, shared travel, and session-by-session history.

Allow me to select an individual member to inspect their route separately.

### World atlas

Add a journey overlay toolbar or side panel.

Allow character selection, party selection, session filtering, route visibility controls, and clickable route segments.

### Session manager

Add a travel section to each session, with ordered stops, participants, associated events, and a route preview.

### Global navigation

Make the character journey and timeline system easy to find through existing navigation and global search.

Use contextual panels and dialogs where appropriate so I can create or edit journeys without losing the current map or session context.

Keep the UI consistent with the existing desktop application's design system.

---

# 15. Optional Enhancements

Implement these after the core data model and workflows are complete.

## Journey playback

Allow me to replay a character's or party's journey chronologically.

A timeline slider or step controls should highlight the route traveled up to a selected point in time.

As I advance through the timeline, the application should:

- Highlight the locations visited so far.
- Reveal the next travel segment.
- Display important events.
- Show the characters who were traveling together at that point.
- Indicate party membership changes.

Support playing, pausing, stepping forward, stepping backward, and jumping to a session.

The playback must use recorded journey data, not invent intermediate travel or event details.

## Compare characters

Allow me to select two or more characters and compare their journeys.

Highlight locations they shared, periods when they traveled together, and important differences in their histories.

## Geographic history

Selecting a location should show which characters and parties visited it, the relevant sessions, and important events that occurred there.

## Session recap

Provide a structured travel recap for a selected session, showing the route and important events.

Generate this from stored data and allow me to edit the resulting notes before saving them.

Do not introduce external AI services or require internet connectivity.

---

# 16. Implementation Phases

## Phase 1: Data model and individual timelines

- Inspect the existing application and data model.
- Implement necessary migrations and relationships.
- Add timeline events to character profiles.
- Support backstory and campaign events.
- Implement chronological ordering, editing, and persistence.

Acceptance criterion: I can create a character's backstory, add significant events, associate them with locations, and reopen the character profile after restarting the application without losing anything.

## Phase 2: Journey recording and party history

- Implement journeys and travel segments.
- Support individual and shared travel.
- Implement party membership history.
- Associate journeys with sessions.
- Support intermediate stops and uncertain routes.

Acceptance criterion: I can record a journey, specify its participants, associate it with a session, and see the correct journey reflected in each participating character's timeline.

## Phase 3: World atlas integration

- Draw routes on the existing world atlas.
- Add character and party filters.
- Add route styling and a legend.
- Implement clickable route segments and location visits.
- Ensure routes remain aligned during zooming and panning.

Acceptance criterion: I can select a character, see their travel route on the world atlas, click a segment, and inspect the relevant journey and events.

## Phase 4: Session integration and editing workflows

- Integrate travel into session records.
- Support multiple routes during one session.
- Add and edit travel records directly from the session interface.
- Synchronize changes across session views, character timelines, party timelines, and maps.

Acceptance criterion: I can reconstruct a session's travel history, including party splits, and see the appropriate history reflected in each participant's profile.

## Phase 5: Playback and advanced views

- Implement chronological route playback.
- Add character route comparison.
- Add location-based travel history.
- Improve filters, search, and visual clarity.
- Add tests for complex historical changes.

Acceptance criterion: I can replay a character's or party's route across multiple sessions and inspect the locations and events associated with each stage.

Each phase must leave the application usable.

---

# 17. Testing Requirements

Test the actual workflows and persistent data relationships.

Include tests for:

- Creating and editing backstory events.
- Creating a journey without a session.
- Linking a journey to a session.
- Creating a shared party journey.
- Tracking individual participation in shared travel.
- Characters joining and leaving a party.
- Temporary character separation.
- Multiple travel segments in one session.
- Unknown and approximate dates.
- Reordering timeline events.
- Editing a location associated with a journey.
- Synchronizing map routes with underlying records.
- Route alignment during map zooming and panning.
- Handling deleted or missing map features.
- Correctly reflecting edits across character, party, session, and location views.
- Database migration and application restart persistence.

Ensure that deleting a journey does not accidentally delete its associated characters, sessions, or locations.

Test that shared travel appears in each participating character's timeline without duplicating the underlying shared journey.

---

# 18. Development Instructions

Start by inspecting the existing repository and identifying the actual models, persistence layer, map APIs, and UI components.

Then:

1. Document the implementation plan.
2. Implement the necessary data model and database migrations.
3. Build the individual timeline workflow.
4. Add journey recording and party participation.
5. Integrate routes into the existing world atlas.
6. Connect journeys to the session manager.
7. Add tests and verify persistence.
8. Implement the optional enhancements only after the core workflows work.

Follow the project's existing conventions and avoid unnecessary dependencies.

Do not rebuild the world map editor.

Do not introduce a second timeline system if one already exists.

Do not use hardcoded example routes as a substitute for database-backed behavior.

Do not leave nonfunctional buttons or placeholder interactions.

If an existing subsystem does not yet support a required integration, implement the smallest maintainable extension and document the limitation.

At the end, provide a summary of implemented features, database changes, tests performed, and remaining limitations.

**Begin by inspecting the existing application and implementing Phase 1, then continue through the remaining phases. Do not stop after planning.**

# Definition of Success

I should be able to open any character's profile and understand their journey through the world, from their backstory to the latest session.

I should be able to open the world atlas, select a character or party, see their route, and click any segment to understand where they traveled, when they traveled, who accompanied them, and what happened.

I should be able to reconstruct the history of a session, track party membership changes, and understand how each character's personal history connects to the campaign.

All views must use the same persistent underlying data.

The result should feel like a unified world atlas and character-history system built directly into my existing private DM desktop application.