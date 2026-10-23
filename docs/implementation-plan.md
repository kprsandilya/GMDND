# Implementation plan and status

The plan follows the five phases from the project brief. Each phase lists its acceptance criterion, what was
built, and how it is verified. Status legend: **done**, **partial**, **planned**.

## Phase 1 – Desktop foundation — done

Acceptance: *launch as a desktop program, create a campaign, create and link a location, save, close, reopen,
find the data intact.*

| Item | Status | Where |
| --- | --- | --- |
| Inspect Azgaar's generator, decide integration | done | `docs/architecture.md`, `scripts/fmg*.mjs`, `scripts/fmg.vite.config.ts` |
| Tauri 2 desktop shell, per-user data dir, restrictive capabilities | done | `src-tauri/` |
| React/TypeScript/Vite frontend, dark DM theme, keyboard shortcuts | done | `src/app`, `src/index.css` |
| SQLite schema + forward-only migrations | done | `src/persistence/migrations.ts` |
| Repositories over an `SqlDriver` abstraction (Tauri IPC / `node:sqlite`) | done | `src/persistence/` |
| Navigation shell with all 15 modules, command palette (Ctrl+K), global search (Ctrl+Shift+F) | done | `src/app/Shell.tsx`, `CommandPalette.tsx`, `features/search` |
| Campaigns, worlds, geographic hierarchy, lore records, typed links, `[[wiki links]]` | done | `features/campaigns`, `features/locations`, `features/lore`, `components/` |
| Connected seed campaign, resettable | done | `src/seed/demoCampaign.ts` |
| Offline verification: window launches, no network | done | `npm run smoke` |

## Phase 2 – Map and dungeon editing — done

Acceptance: *edit a world map, create a dungeon, add rooms and objects, save everything, reopen without losing
map data or links.*

| Item | Status | Where |
| --- | --- | --- |
| Bundled Fantasy Map Generator in the World Atlas (generate by seed, import/export `.map`, save to campaign) | done | `features/atlas` |
| Feature → entity links (burgs, states, provinces, markers, rivers, cultures, religions), annotations, deep links from records | done | `features/atlas`, `components/EntityDetail` map refs |
| Grid editor: rooms, walls, doors, objects, tokens, markers, layers, zoom/pan, marquee + multi-select, resize, nudge, duplicate | done | `features/dungeons/MapCanvas.tsx` |
| Undo/redo across all edits (repository-level commands) | done | `features/dungeons/editorStore.ts`, `domain/undo.ts` |
| Rooms as persistent entities with read-aloud/notes/secrets/state/inventory | done | `rooms` table + `EntityDetail` |
| Multiple floors per dungeon, per-floor size and scale | done | `DungeonsPage.tsx` |
| Background images per floor | partial | column exists (`background_asset`), no picker in the UI yet |

## Phase 3 – Character simulation and inventories — done

Acceptance: *move a character, interact with a locked chest, satisfy a prerequisite, obtain an item, observe
the persistent changes.*

| Item | Status | Where |
| --- | --- | --- |
| PCs, NPCs, creatures with 5e stat fields generated from Zod schemas | done | `domain/schemas.ts`, `components/FieldsEditor.tsx` |
| Tokens linked to records; HP, speed, conditions, movement budget | done | `tokens` table, `Inspector.tsx` |
| Movement rules: wall/door collision, diagonal rules, budget, reachable-cell overlay | done | `domain/movement.ts` |
| Data-driven interactions with preconditions, manual dice entry, effects | done | `domain/interactions.ts`, `workflows/interactionWorkflow.ts`, `dialogs.tsx` |
| Door actions (open/close/lock/unlock/pick/force/break/discover) | done | `performDoorAction` |
| Item definitions vs instances, transactional transfers, inventory log | done | `persistence/repositories/inventory.ts`, `components/InventoryPanel.tsx` |
| Discovery/visibility states for rooms, doors, objects, tokens | done | `hidden`/`discovered` flags, room `state` |
| Marker triggers (enter room/area, open door, interact, discover, trap, defeat) | done | `fireMarkers` |

## Phase 4 – Encounters and sessions — done

Acceptance: *prepare an encounter, activate it from a dungeon room, run it, finish it, preserve the selected
consequences.*

| Item | Status | Where |
| --- | --- | --- |
| Encounter templates with participants, difficulty and XP | done | `features/encounters` |
| Execution instances (runs) with combatants; tokens placed when bound to a room | done | `workflows/encounterWorkflow.ts` |
| Combat tracker: initiative, turns/rounds, damage/heal/temp HP, conditions, defeat, log | done | `CombatTracker.tsx` |
| Finish dialog committing outcomes (defeated creatures, remove tokens, room cleared, treasure) | done | `finishEncounter` |
| Sessions: plan, live bar, quick notes → promote to records, log, recap | done | `features/sessions` |
| Campaign log of consequences across modules | done | `campaign_log` |

## Phase 5 – Advanced worldbuilding and polish — partial

| Item | Status | Notes |
| --- | --- | --- |
| Quests with objectives, timeline with configurable calendar | done | `features/quests`, `features/timeline`, `CalendarEditor.tsx` |
| Backups (full zip), auto snapshots, safe restore with pre-restore copies | done | `src-tauri/src/archive.rs`, `SettingsPage.tsx` |
| Versioned campaign export/import with id remapping and integrity notes | done | `persistence/exportImport.ts` |
| Windows installer (NSIS per-user + MSI) | done | `npm run desktop:build` |
| Automated tests: domain, workflows, persistence (29 tests) + CDP smoke test | done | `npm test`, `npm run smoke` |
| Context menus on the canvas, keyboard-only editing of every field | partial | inspector covers all fields; right-click menus not implemented |
| Second theme ("slate") | planned | setting exists; only the Ember theme is styled |
| Richer timeline (drag to reschedule, multi-calendar) | planned | |

## Verification matrix

| Check | Command | Expected |
| --- | --- | --- |
| Type safety | `npm run typecheck` | no errors |
| Unit/integration tests | `npm test` | 3 files, 29 tests passing |
| Production bundle | `npm run build` | `dist/` produced |
| Desktop smoke | `npm run smoke` (with CDP port) | all checks pass, screenshots in `smoke-artifacts/` |
| Installer | `npm run desktop:build:nsis` | `src-tauri/target/release/bundle/nsis/*-setup.exe` |

## Manual acceptance walkthrough (seed campaign)

1. Launch; the dashboard shows *Embers of Hollowmere*, the clock and the party at The Drowned Lantern.
2. World Atlas → the Varnlands map generates from seed `734215890`; press **Link feature**, click a town,
   link it to *Hollowmere*; **Save to campaign**. Open *Hollowmere* → *Map refs* → *Show on map*.
3. Dungeons → *Cistern of the Drowned Saint*: five rooms, doors, objects, markers and party tokens. Edit a
   wall, undo, redo. Switch to **Play**, select Kaelen, click a cell to move (budget decreases), open the
   Guard Post door – the *Guard Post Ambush* marker fires.
4. Run the encounter from the room; the tracker opens with the party and four cultists; roll initiative,
   begin, deal damage, finish with "mark room cleared" and "remove defeated tokens".
5. Back in the reliquary, search the offering niche (Investigation DC 12 → manual roll), pick up the
   Verdigris Key, unlock the chest with the key and take the signet; the quest objective can be ticked.
6. Session Manager → *Session 1* → add a quick note, promote it to an NPC record.
7. Settings → create a backup; close and reopen – everything persists.
