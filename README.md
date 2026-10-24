# DM Workbench

A private, offline desktop workbench for running Dungeons & Dragons 5e campaigns as the Dungeon Master.
One application, one campaign database: worldbuilding records, a world atlas powered by a bundled copy of
[Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator), a grid-based dungeon and
battle-map editor, persistent rooms, objects and inventories, creatures and encounters with a combat tracker,
quests, a configurable calendar and timeline, and a session manager whose quick notes turn into permanent
campaign updates.

There is no player-facing functionality, no accounts, no telemetry and no network access. Everything lives in
a SQLite database and an assets folder inside your user profile.

## Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) with the system WebView2 on Windows |
| UI | React 19, TypeScript, Vite 8, Tailwind CSS 4, Radix UI, TanStack Query, Zustand |
| Persistence | SQLite via `rusqlite` (bundled), versioned migrations, Zod-validated JSON fields |
| World maps | Azgaar's Fantasy Map Generator 1.155 (MIT), built from the git submodule and bundled locally |
| Tests | Vitest (domain + persistence against `node:sqlite`), CDP-driven desktop smoke test |

## Prerequisites (Windows)

- Node.js 22.5 or newer (the test suite uses the built-in `node:sqlite` module) and npm 10+
- Rust stable toolchain with the MSVC target (`rustup default stable-x86_64-pc-windows-msvc`)
- Microsoft Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 Runtime (preinstalled on Windows 10/11; the installer also bootstraps it)
- Git (the map generator is a submodule)

## Install

```powershell
git clone <this repository> dm-workbench
cd dm-workbench
git submodule update --init --recursive
npm run setup
```

`npm run setup` runs three steps that can also be run individually:

| Command | What it does |
| --- | --- |
| `npm install` | installs the workbench dependencies |
| `npm run fmg:install` | installs the map generator's own dependencies inside the submodule (`npm ci --ignore-scripts`) |
| `npm run fmg:build` | builds the generator with its upstream Vite config into `public/fmg/` (gitignored, ~35 MB) |

Re-run `npm run fmg:build` whenever the submodule is updated.

## Development

```powershell
npm run desktop:dev
```

Compiles the Rust shell, starts Vite on `http://localhost:1420` and opens the DM Workbench window with hot
reload. Data is stored in `%APPDATA%\com.dmworkbench.app\` (see **Settings & Data → Storage** inside the app).
On first launch the original seed campaign *Embers of Hollowmere* is created automatically.

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | strict TypeScript check of the frontend |
| `npm test` | unit and integration tests (domain rules, repositories, workflows) |
| `npm run smoke` | end-to-end smoke test against a running desktop window (see below) |
| `npm run build` | typecheck + production frontend bundle into `dist/` |

## Tests

```powershell
npm test
```

Runs the Vitest suites in `src/domain` and `src/persistence`. The persistence tests execute the real
migrations and repositories against an in-memory SQLite database through `node:sqlite`, so the same SQL that
runs in the desktop app is exercised.

### Desktop smoke test

The smoke test drives the *real* Tauri window through the Chrome DevTools Protocol: it visits every module,
opens the demo dungeon, waits for the embedded map generator and fails on any uncaught exception.

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
npm run desktop:dev          # or launch an installed build with the variable set
# in a second terminal
npm run smoke
```

Screenshots are written to `smoke-artifacts/`.

## Building the Windows installer

```powershell
npm run desktop:build          # NSIS installer + MSI
npm run desktop:build:nsis     # NSIS installer only
```

Output lands in `src-tauri\target\release\bundle\nsis\DM Workbench_<version>_x64-setup.exe` (and
`...\msi\` for the MSI). The build runs `npm run build` first, so `public/fmg/` must exist (`npm run fmg:build`).
The installer is per-user (`installMode: currentUser`), needs no administrator rights and includes the
WebView2 bootstrapper.

To install, run the generated `-setup.exe`. The app appears in the Start menu as **DM Workbench**.

## Using the workbench

- **Dashboard** – campaign clock, party location, status counters, active quests, log, "continue session".
- **Campaigns** – create, open, delete campaigns; configure the calendar; reset the seed campaign.
- **World Atlas** – the embedded Fantasy Map Generator. Generate from a seed or import a `.map`, link towns,
  states, provinces and markers to location records, add DM annotations, and *Save to campaign* so the map is
  stored with the campaign (and travels with backups and exports).
- **Locations** – the geographic hierarchy (world → continent → kingdom → region → settlement → district →
  building/location → dungeon). Each record carries summary, body, read-aloud text, DM notes and secrets.
- **Dungeons & Maps** – grid editor with rooms, walls, doors, objects, tokens, markers and layers; undo/redo;
  *Play* mode with rule-checked movement, object interactions, door actions and marker triggers.
- **Encounters** – templates with participants; runs create combatants (and tokens when bound to a room);
  combat tracker with initiative, HP, conditions and outcome commit.
- **Characters & NPCs, Creatures, Items & Equipment, Lore & Documents, Quests & Events, Timeline** –
  interconnected records with `[[wiki links]]`, relations, inventories and objectives.
- **Standard rules library (SRD 2024)** – the full SRD-2024 bestiary and item/magic-item lists are
  bundled and available in *every* campaign. On the Creatures and Items & Equipment pages the source
  filter switches between **All**, **Custom** (your own records) and **Standard (SRD)**. Standard
  records are shared across campaigns (not copied into each one); duplicate one to make an editable,
  campaign-owned copy. The data comes from
  [open5e](https://github.com/open5e/open5e-api); regenerate the bundle with `npm run srd:build`.
- **Session Manager** – plan, run and recap sessions; quick notes are promoted into permanent records.
- **Global Search** (Ctrl+Shift+F) and the **command palette** (Ctrl+K) reach any record.
- **Settings & Data** – defaults, backups, campaign export/import, storage locations.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) – desktop architecture, map generator integration, security posture
- [`docs/data-model.md`](docs/data-model.md) – entities, tables and relationships
- [`docs/implementation-plan.md`](docs/implementation-plan.md) – phases, acceptance criteria and status
- [`docs/backup-and-restore.md`](docs/backup-and-restore.md) – storage layout, backups, exports and recovery
- [`docs/known-limitations.md`](docs/known-limitations.md) – unfinished features and constraints

## Licensing

DM Workbench's own code is provided as-is for private use. Azgaar's Fantasy Map Generator is included unmodified
as a git submodule and bundled build under the MIT License (© Max Haniyeu); its license text ships in
`Fantasy-Map-Generator/LICENSE`. All campaign content in the seed campaign is original.
