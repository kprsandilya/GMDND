# Project: Private D&D Dungeon Master Desktop Workbench

## Your Role

Act as a senior desktop application engineer, full-stack architect, and product designer. Build a polished, reliable, extensible **native desktop application** that serves as my private Dungeon Master (DM) workbench for Dungeons & Dragons 5e.

This is not a website, hosted service, or web application that requires me to open a browser. It must be a standalone desktop application that I can install and launch from my computer like any other desktop program.

The application should be optimized for Windows initially, while keeping the architecture portable to macOS and Linux where practical.

I want to prepare campaigns, construct a detailed fantasy world, edit maps, create dungeons and rooms, manage encounters, interact with items and NPCs, move characters around maps, run sessions, and preserve the consequences of player decisions.

Use the following existing repository as the foundation for world-scale map generation and editing:

https://github.com/Azgaar/Fantasy-Map-Generator

I also want worldbuilding capabilities inspired by World Anvil, including interconnected lore articles, locations, characters, factions, timelines, secrets, quests, and campaign notes.

**This application is exclusively for me as the DM.** Players will never access the application. Do not implement player accounts, player portals, public campaigns, multiplayer collaboration, or player-facing publishing features.

Make reasonable technical and product decisions independently. Inspect the existing repository before committing to an integration strategy. Implement working functionality rather than stopping at a plan, mockup, or collection of placeholder pages.

---

# 1. Core Product Requirements

The application should bring five systems together:

1. Worldbuilding and interconnected campaign knowledge.
2. World maps, regional maps, city maps, and dungeon maps.
3. Room preparation, encounters, tokens, and object interactions.
4. Items, inventories, NPCs, creatures, quests, and campaign state.
5. Session preparation, live session management, and historical records.

These must share a coherent data model.

For example, a chest placed in a dungeon room should reference actual item instances. A character opening that chest should update its state and inventory. An encounter associated with the room should use the same creature records as the rest of the campaign. Changes should persist after closing and reopening the application.

The core workflow is:

**World map → Location → Dungeon → Room → Encounter → Character interaction → Persistent campaign update.**

Every major feature should support this workflow rather than functioning as a disconnected module.

# 2. Desktop Application Architecture

## Required architecture

Use the following as the preferred starting point:

- **Desktop shell:** Tauri 2.
- **Frontend:** React and TypeScript.
- **Frontend build system:** Vite, unless the map generator requires a compatible alternative.
- **UI:** A consistent desktop-oriented component system, potentially shadcn/ui.
- **Persistence:** SQLite through a Rust-side data access layer or another well-supported Tauri-compatible implementation.
- **Validation:** A schema validation library such as Zod on the frontend, supplemented by appropriate backend validation.
- **Testing:** Unit, integration, and desktop end-to-end tests where practical.

These are recommendations, not reasons to break the existing map generator. Inspect its actual framework, dependencies, licensing, and integration requirements before choosing the final implementation.

If another desktop architecture offers a substantially more reliable way to reuse Azgaar, document the trade-offs and use the better solution.

## Desktop behavior

The application must:

- Launch in its own native desktop window.
- Work without requiring a browser to be opened manually.
- Store campaign data on the local computer.
- Work offline after installation.
- Avoid requiring an external database, cloud account, or paid API.
- Preserve campaign data when the application closes or crashes.
- Provide a native application icon, window title, and appropriate application metadata.
- Support ordinary desktop window resizing and maximize/restore behavior.
- Use native file dialogs for importing maps, opening backups, and exporting campaign data where appropriate.
- Support keyboard shortcuts for common actions.
- Provide clear feedback when saving, importing, exporting, or encountering an error.
- Avoid opening unnecessary browser windows.
- Keep long-running operations from freezing the UI.

Use the operating system's application data directory for the primary database and managed assets. Do not store the production database in a temporary directory or rely on the application's installation directory being writable.

## Native application packaging

Create a reproducible desktop build process.

For Windows, provide:

- A development mode that launches the desktop application.
- A production build command.
- A packaged installer or other suitable distributable artifact.
- Clear installation and launch instructions.
- A documented method for updating the application without losing campaign data.

Where practical, preserve compatibility with macOS and Linux.

Do not consider the application complete simply because its React frontend runs in a browser. The actual desktop shell must build and launch successfully.

## Desktop application versus browser-only UI

React is the frontend rendering technology, not the product deployment model.

Do not build a hosted web service as the primary deliverable. Do not require a separately launched local web server as part of ordinary use unless there is a compelling technical reason and the desktop application starts and manages it automatically.

The user should be able to launch the installed application directly.

A development server may be used during development, but the packaged application must load its bundled frontend and local resources correctly.

# 3. Inspect and Integrate Azgaar's Fantasy Map Generator

Repository:

https://github.com/Azgaar/Fantasy-Map-Generator

Before implementation, inspect:

- Its framework, build tooling, dependencies, and repository structure.
- Its map state and serialization model.
- Its map generation and editing functionality.
- How its map files are imported, saved, and exported.
- Whether it can be integrated into a desktop webview.
- Its filesystem, browser API, and networking assumptions.
- Its license and attribution requirements.
- Any limitations of embedding it within Tauri.

Do not assume it is a standard npm component or has a stable embeddable API.

Select an integration approach based on actual code inspection. Prefer a bundled local integration over an iframe or a dependency on the hosted website.

Preserve the generator's existing map generation, editing, and save/load functionality as much as possible.

Keep custom integration code isolated. Avoid unnecessary modifications to upstream source code.

If the generator requires browser APIs or other environment-specific functionality, determine whether those APIs work in Tauri's webview and implement compatible alternatives only where necessary.

Create `docs/architecture.md` documenting the integration strategy, licensing considerations, and limitations.

If the integration is blocked, build the rest of the application around a clean map integration adapter and a usable fallback. Do not silently replace Azgaar with an unrelated map generator.

# 4. Desktop User Interface

Design a desktop-first interface for a large monitor, with efficient keyboard and mouse interactions.

Use a persistent navigation sidebar and a main workspace. Where useful, provide contextual side panels and dockable or resizable regions.

The primary navigation should include:

- Dashboard
- Campaigns
- World Atlas
- Locations
- Dungeons & Maps
- Encounters
- Characters & NPCs
- Items & Equipment
- Creatures
- Quests & Events
- Lore & Documents
- Timeline
- Session Manager
- Global Search
- Settings & Data Management

The UI should feel like a professional creative application for managing a complex campaign, not a generic website dashboard.

Use restrained fantasy-inspired styling, strong typography, clear hierarchy, subtle borders, and a layout suitable for long working sessions.

Prioritize desktop usability:

- Resizable panels where useful.
- Persistent selection and contextual details.
- Efficient keyboard navigation.
- Searchable lists and property panels.
- Context menus for map objects and entities.
- Drag-and-drop for tokens and appropriate editor operations.
- Multi-selection for map editing.
- Undo and redo for important editing operations.
- Keyboard shortcuts for frequent actions.
- Clear selection, hover, and focus states.
- Confirmation dialogs for destructive operations.
- Nonblocking save feedback.

Do not create a separate page for every small action if a contextual panel or dialog would be more efficient.

Keep navigation state and unsaved editor state predictable when switching between modules.

# 5. Local Data Storage and Persistence

Use SQLite as the preferred source of truth for structured campaign data.

The database should live in the appropriate per-user application data directory.

Keep database access behind a well-defined persistence layer. Do not scatter SQL or filesystem operations across React components.

Use appropriate migrations, foreign keys, transactions, and indexes.

The application should save changes reliably and recover gracefully from ordinary errors.

Support:

- Multiple campaigns.
- Multiple worlds and maps.
- Persistent map annotations.
- Persistent room geometry.
- Persistent token positions.
- Persistent inventories and item ownership.
- Persistent encounter and campaign state.
- Persistent session notes.
- Searchable entity relationships.
- Backups and restores.
- Versioned campaign exports.
- Import validation.
- Clear handling of missing or deleted references.

Store large files, images, map files, and other binary assets in a managed asset directory when appropriate. Keep references to those assets in the database.

Do not assume that an absolute filesystem path will remain valid when a campaign is moved or restored.

Design a versioned campaign export format that can include the necessary database records, map files, annotations, and assets.

Support a full backup and restore workflow.

Avoid cloud synchronization, telemetry that sends campaign content externally, and third-party storage requirements.

# 6. Worldbuilding Knowledge Base

Build an interconnected worldbuilding system inspired by World Anvil.

Support the following entity types:

- Campaigns and worlds.
- Continents, regions, countries, and kingdoms.
- Settlements, districts, buildings, and locations.
- Dungeons, floors, and rooms.
- NPCs and player characters.
- Creatures and monsters.
- Items, weapons, armor, and spells.
- Factions, organizations, religions, and deities.
- Quests and objectives.
- Historical events and timelines.
- Traps and hazards.
- Shops and inventories.
- Secrets and revelations.
- Lore articles and campaign documents.

Every entity should have a stable ID, a name, a type, timestamps, and appropriate structured fields.

Allow cross-references between entities, backlinks, tags, custom fields where useful, and a global search experience.

Support Markdown or a reliable rich-text editor for descriptions, read-aloud text, notes, and lore.

Allow internal links to other entities and the creation of linked entities directly from an article.

All content is DM-only by default. Support clearly marked secret sections, hidden motives, reveal conditions, and links between clues and secrets.

# 7. World Atlas and Geographic Hierarchy

Integrate Azgaar for world-scale map creation and editing.

Preserve its existing map capabilities and native file compatibility.

Allow me to:

- Create and manage multiple world maps.
- Import and export Azgaar map files.
- Associate maps with worlds and campaigns.
- Select map features and link them to database entities.
- Create location records from selected map features.
- Open linked records directly from the map.
- Search for a location and highlight it.
- Add DM-only annotations and points of interest.
- Navigate from world maps into more detailed maps.

Support a geographic hierarchy such as:

World → Continent → Region → Kingdom → Settlement → District → Building → Dungeon → Floor → Room.

The hierarchy should be flexible, with optional levels.

Keep native map data separate from application-specific metadata. Use stable feature references when available and handle missing or regenerated features gracefully.

# 8. Dungeon and Battle Map Editor

Build a separate, integrated 2D grid-based editor for dungeon maps and encounter maps.

Use SVG, canvas, or an appropriate existing library based on performance and maintainability.

Support:

- Arbitrary practical map dimensions.
- Square grids and configurable grid scale.
- Grid snapping.
- Drawing and erasing walls.
- Rooms, corridors, doors, windows, and passages.
- Multiple floors and vertical connections.
- Furniture, objects, containers, traps, and hazards.
- Tokens for characters, creatures, and NPCs.
- Dragging, selection, rotation where applicable, deletion, and multi-selection.
- Zooming and panning.
- Layers for terrain, walls, objects, tokens, and DM annotations.
- Undo and redo.
- Copying and duplicating rooms or map sections.
- Room labels.
- Save/load and export/import.

The editor must be interactive in the packaged desktop application, not merely a static map viewer.

## Rooms as persistent entities

Rooms must have their own records linked to map geometry.

Support:

- Room name and number.
- Description and read-aloud text.
- DM-only notes.
- Dimensions and terrain.
- Lighting and visibility.
- Doors, entrances, and exits.
- Locks, keys, and access requirements.
- Traps and hazards.
- Furniture and interactable objects.
- Creatures and NPCs.
- Encounter associations.
- Loot and hidden treasure.
- Investigation and Perception checks.
- Discovery conditions.
- Neighboring room connections.
- Relevant quests, clues, and lore.
- State such as explored, locked, trapped, cleared, or modified.

Selecting a room should open its property panel without requiring me to leave the map.

# 9. Map Markers and Event Triggers

Allow me to mark specific map coordinates or areas with events, encounters, traps, treasure, clues, NPCs, and secrets.

Each marker should support:

- A stable ID.
- Position and optional footprint.
- An associated entity or event.
- A trigger condition.
- Optional encounter association.
- A DM-facing visibility setting.
- Persistent activation state.
- Notes and related links.

Support triggers such as entering a room, entering an area, opening a door, interacting with an object, discovering a secret, stepping on a trap, defeating a creature, or manually activating an event.

Start with reliable manual triggers and add straightforward automatic triggers where practical.

Provide filters and toggles to show or hide individual marker types.

# 10. Character Movement and Object Interaction

Implement a private DM simulation, not a full virtual tabletop.

Allow me to place and move player characters, NPCs, and monsters on dungeon maps.

Support grid snapping, configurable movement budgets, optional movement constraints, persistent positions, and basic collision checks.

Allow me to select a character and click an object to inspect available actions.

Example actions include:

- Search a chest.
- Open or lock a door.
- Attempt to pick a lock.
- Search a room.
- Investigate a statue or bookshelf.
- Discover a hidden passage.
- Trigger or disarm a trap.
- Loot a container.
- Speak to an NPC.
- Activate a mechanism.
- Pick up, drop, equip, or use an item.
- Read a document.

Interactions must be data-driven, with preconditions, optional checks, success and failure outcomes, state changes, item transfers, and triggered events.

Allow manual entry of dice results so the DM remains in control.

Represent visibility and discovery states independently from object existence.

# 11. Items, Inventories, and Ownership

Build a searchable item database with support for weapons, armor, equipment, consumables, potions, scrolls, magical items, artifacts, quest items, keys, currency, treasure, crafting materials, and custom homebrew items.

Support relevant properties such as rarity, weight, value, damage, armor class, charges, attunement, effects, restrictions, tags, and rule edition.

Separate item definitions from physical item instances.

An inventory entry should identify the item instance or definition, quantity, owner or container, and relevant mutable state.

Implement transactional transfers between characters, containers, shops, rooms, and treasure hoards.

Opening a chest and taking a potion must update the chest and character inventories without duplication.

Do not reproduce copyrighted sourcebook text wholesale. Use original seed content and appropriately licensed resources.

# 12. Characters, Creatures, and Encounters

Implement detailed NPC, character, and creature records with relevant statistics, relationships, secrets, inventory, abilities, notes, and encounter associations.

Separate reusable creature definitions from mutable combat instances.

Build an encounter preparation interface and combat tracker with initiative, turns, rounds, HP, temporary HP, damage, healing, conditions, durations, resources, and an event log.

Support combat and noncombat encounters, environmental effects, conditional events, reinforcements, treasure, and alternative outcomes.

An encounter should move through Prepared, Active, Completed, or Aborted states.

Running an encounter should create a separate execution instance, preserving the original reusable template.

Allow the DM to choose which outcomes persist to the campaign.

Support configurable D&D 5e rules and edition differences where practical, without requiring complete automated rules adjudication.

# 13. Quests, Timeline, and Session Manager

Implement interconnected quests, objectives, historical events, scheduled events, and campaign timelines.

Support a configurable fictional calendar.

Track current campaign state, party location, discovered locations, quest status, NPC relationships, item ownership, defeated creatures, room changes, and unresolved clues.

Provide a session preparation and live-running interface with session outlines, planned encounters, relevant locations, read-aloud text, secrets, rewards, notes, and post-session recaps.

Make it easy to switch between the active map, room notes, NPC details, inventory, and encounter tracker without losing context.

Provide quick notes associated with the active session and a workflow for turning them into permanent campaign updates.

# 14. Desktop Files, Backups, and Application Settings

Use native file dialogs where appropriate for:

- Importing Azgaar maps.
- Opening campaign archives.
- Exporting campaign archives.
- Backing up and restoring campaign data.
- Importing images or map assets.

Validate files before modifying existing data.

Use safe filesystem APIs and restrict file access to explicitly selected files and managed application directories.

Provide settings for application appearance, default map scale, grid configuration, autosave behavior, backup location, and other relevant preferences.

Ensure that settings persist across restarts.

Do not introduce unnecessary operating-system integrations or background services.

# 15. Privacy and Security

The application is intended for a single trusted user and stores campaign content locally.

Do not implement player accounts, public publishing, or remote collaboration.

Do not transmit campaign data to third-party services.

If a local backend is required, prefer Tauri commands and a direct SQLite integration over exposing a general-purpose local HTTP server.

Follow Tauri's security guidance:

- Use a restrictive capability and permission configuration.
- Avoid granting unrestricted filesystem access to the frontend.
- Validate all frontend-to-backend inputs.
- Avoid unsafe shell execution.
- Keep dependencies minimal and current.
- Document the limitations of local storage and any assumptions about operating-system account security.

Do not claim that local storage automatically encrypts the database.

# 16. Seed Campaign

Create a small, coherent original fantasy campaign demonstrating the complete application.

Include a world map, a settlement, a dungeon with connected rooms, NPCs with secrets, a quest, a locked chest, actual item instances, a trap, and an encounter linked to a specific room.

Make the example interactive. I should be able to move a character into the room, interact with the chest, obtain an item, and see the campaign state update.

Provide a way to reset the demonstration campaign without deleting other campaigns.

# 17. Testing and Quality

Write tests for domain logic, persistence, map integration, interactions, and campaign workflows.

At minimum, verify:

- Entity creation, editing, and reload.
- Map annotations and feature references.
- Dungeon geometry persistence.
- Room and encounter associations.
- Token movement.
- Object interaction state changes.
- Inventory transfers without duplication.
- Encounter execution without modifying its template.
- Persistent campaign consequences.
- Export/import and backup/restore.
- Database migrations.
- Missing-reference handling.

Provide an end-to-end smoke test for launching the desktop application and exercising its main workflow where practical.

The application must compile and launch in desktop development mode, and the production packaging process must be documented and tested.

# 18. Implementation Phases

## Phase 1: Desktop foundation

- Inspect Azgaar and document integration decisions.
- Create the Tauri desktop application.
- Establish the React/TypeScript frontend and local persistence layer.
- Implement SQLite schema and migrations.
- Create the navigation shell.
- Implement campaigns, worlds, locations, and basic lore records.
- Establish map integration.
- Implement save/reload, search, and a connected sample campaign.
- Verify that the desktop window launches and works offline.

**Acceptance criterion:** I can launch the application as a desktop program, create a campaign, create and link a location, save my work, close the application, reopen it, and find my data intact.

## Phase 2: Map and dungeon editing

- Integrate Azgaar.
- Build the grid-based dungeon editor.
- Implement persistent rooms, doors, objects, and map markers.
- Add selection, contextual editing, zoom, pan, and undo/redo.
- Verify that all editor state persists.

**Acceptance criterion:** I can edit a world map, create a dungeon, add rooms and objects, save everything, and reopen the application without losing map data or links.

## Phase 3: Character simulation and inventories

- Implement characters, creatures, and tokens.
- Add movement and basic movement constraints.
- Implement interactable objects.
- Implement state changes and inventory transactions.
- Add discovery and visibility states.

**Acceptance criterion:** I can move a character, interact with a locked chest, satisfy a prerequisite, obtain an item, and observe the correct persistent changes.

## Phase 4: Encounters and sessions

- Implement encounter definitions and execution instances.
- Build the combat tracker.
- Link encounters to map locations.
- Implement sessions, quick notes, and persistent outcomes.
- Test the end-to-end DM workflow.

**Acceptance criterion:** I can prepare an encounter, activate it from a dungeon room, run it, finish it, and preserve the selected campaign consequences.

## Phase 5: Advanced worldbuilding and polish

- Expand quests, timelines, lore, and backlinks.
- Improve global search and the command palette.
- Add comprehensive backup and restore.
- Improve desktop shortcuts and editor ergonomics.
- Package and validate the Windows installer.
- Expand test coverage and documentation.

Each phase must leave the application usable.

# 19. Documentation and Deliverables

Create:

- `README.md` with installation, development, build, and testing instructions.
- `docs/architecture.md` describing the desktop architecture and map integration.
- `docs/data-model.md` describing the domain entities and relationships.
- `docs/implementation-plan.md` documenting phases and acceptance criteria.
- `docs/backup-and-restore.md` describing data storage, exports, and recovery.
- `docs/known-limitations.md` documenting unfinished features and technical constraints.

Provide reproducible commands for installing dependencies, launching desktop development mode, running tests, and producing the Windows installer.

Do not stop after producing documentation. Implement the application and verify it runs.

# 20. Definition of Done

The deliverable is a functioning, locally installed desktop application that I can use as my private DM command center.

I should be able to create a world, edit its map, navigate into locations and dungeons, prepare rooms, place encounters and items, move characters, interact with objects, run combat, and preserve campaign changes between sessions.

The application must launch in its own window, work offline, persist data locally, and have a reproducible packaging workflow.

The central design principle is:

**One desktop application. One coherent campaign database. Connected maps, rooms, objects, characters, and encounters. Persistent consequences. No player-facing functionality.**

Start by inspecting the repository and implementing Phase 1. Do not stop at a plan or mockup.