# Architecture

DM Workbench is a single-window Tauri 2 desktop application. A small Rust core owns the database file, the
assets folder, backups and archives; the whole user interface is a React/TypeScript application rendered in
the system WebView2. Azgaar's Fantasy Map Generator is bundled as a local, unmodified web application and
embedded in the World Atlas module.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Tauri window (WebView2)                                                   │
│                                                                           │
│  React app (src/)                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │ features/*   │→ │ domain/*     │→ │ persistence/* (repositories)     │ │
│  │ pages, editor│  │ rules, Zod,  │  │ SqlDriver → invoke("db_*")       │ │
│  │ combat, etc. │  │ workflows    │  └──────────────┬───────────────────┘ │
│  └──────────────┘  └──────────────┘                 │ IPC (tauri invoke)  │
│  ┌──────────────────────────────┐                   │                     │
│  │ <iframe src="/fmg/">         │ same-origin       │                     │
│  │ Fantasy Map Generator (as-is)│ bridge (features/atlas/fmgBridge.ts)    │
│  └──────────────────────────────┘                   │                     │
├─────────────────────────────────────────────────────┼─────────────────────┤
│ Rust core (src-tauri/src)                           ▼                     │
│  db.rs       rusqlite connection (WAL), db_select/db_execute/db_batch     │
│  assets.rs   validated paths under <app-data>/assets, text/file I/O       │
│  archive.rs  backups (zip), auto snapshots, campaign archives             │
│  plugins     dialog (open/save/message), opener (reveal in folder)        │
└───────────────────────────────────────────────────────────────────────────┘
      %APPDATA%\com.dmworkbench.app\  workbench.sqlite · assets\ · backups\
```

## Why Tauri rather than Electron or a browser tab

- A real desktop window with native dialogs and a per-user installer, while reusing the system WebView2
  (an NSIS installer of a few MB plus the bundled generator instead of a 150 MB Chromium).
- The Rust core is the only code that touches the filesystem. The WebView never gets raw `fs` or `shell`
  permissions; it can only call the commands listed in `src-tauri/src/lib.rs`.
- The database lives in the OS application-data folder, independent of the install location, which keeps
  upgrades and uninstall/reinstall safe.

## Frontend layering

| Folder | Responsibility |
| --- | --- |
| `src/app` | shell, routing (`HashRouter`), command palette, TanStack Query keys/hooks, Zustand UI store, Tauri `platform` facade |
| `src/domain` | pure TypeScript: types, Zod schemas for entity `fields`, calendar maths, dice, grid geometry, movement rules, the data-driven object-interaction engine, the undo stack, and **workflows** (multi-repository use cases such as `activateEncounter`, `performInteraction`, `promoteNote`) |
| `src/persistence` | `SqlDriver` interface with two implementations (`TauriSqlDriver` over IPC, `NodeSqlDriver` over `node:sqlite` for tests), forward-only migrations, repositories, versioned campaign export/import |
| `src/components` | reusable UI: entity workspace/detail/form, field editor generated from the Zod schemas, inventory panel, markdown with `[[wiki links]]`, pickers |
| `src/features` | one folder per module (dashboard, campaigns, atlas, locations, dungeons, encounters, characters, items, creatures, quests, lore, timeline, sessions, search, settings) |
| `src/seed` | the original seed campaign *Embers of Hollowmere* and its reset routine |

The UI never writes SQL. Pages call repositories or workflows; workflows combine repositories and domain
rules and run in a single transaction where consequences must be atomic (inventory transfers, encounter
activation, outcome commits). The query cache is invalidated by coarse keys (`["entities"]`, `["dungeon"]`,
`["inventory"]`, …) so screens stay consistent after cross-module changes.

### Dungeon editor

The editor is an SVG canvas (`MapCanvas.tsx`) over a Zustand store (`editorStore.ts`). Every edit is a
command object with `do`/`undo` closures that call repository methods, so undo/redo survive across tools and
the database is always the source of truth (the store re-reads the floor after each command). World
coordinates are grid cells; walls are segments between vertices; doors sit on cell edges; rooms are
rectangles whose records are also `room` entities (so they carry read-aloud text, notes, secrets, links and
inventory like any other record).

Play mode reuses the same canvas: movement goes through `domain/movement.ts` (wall and door collision,
Chebyshev or 5-10-5 diagonals, speed budget), interactions through `domain/interactions.ts` (preconditions →
effects, with manual dice entry when a check is needed), and marker triggers through
`workflows/interactionWorkflow.ts`. Everything that changes state is logged to the campaign log.

## Fantasy Map Generator integration

### What was inspected

The upstream repository (`Fantasy-Map-Generator`, pinned as a git submodule at the commit recorded in
`public/fmg/fmg-build.json`) is a **TypeScript + Vite single-page application** – not a library. Key facts
from the code inspection:

- `src/main.ts` bootstraps a large amount of global state: `window.pack` / `window.grid` (the map graph),
  `options`, `seed`, d3 selections (`svg`, `viewbox`, layer groups), and `window.Services`
  (`Services.Save`, `Services.Load`, `Services.Export`, …). Modules assume these globals exist.
- Map serialisation is a line-based text format (`.map`) produced by `Services.Save.prepareMapData()` and
  parsed by `Services.Load.uploadMap(blob)`; it carries a version and is auto-upgraded on load.
- URL parameters are supported on boot: `?seed=`, `?burg=`, `?x=&y=&scale=`. A `map:generated` DOM event
  fires on `window` after each generation.
- It uses `localStorage`/IndexedDB for preferences and "last saved map", `FileReader`/download links for
  files, and optional network features (Dropbox, hosted help, analytics). In **"electron" mode**
  (`vite build --mode electron`) the bundle is relative-base, has no service worker and no analytics;
  `window.electron?.isElectron` switches off the "leave page" prompt and download hints.
- License: MIT with attribution (`Fantasy-Map-Generator/LICENSE`).

### Chosen approach: bundled local build in a same-origin iframe

Because the generator is a whole application with global state, document-wide event handlers and its own
jQuery UI dialogs, mounting it inside the React tree would require invasive forks. Instead:

1. `scripts/fmg.vite.config.ts` **wraps** the upstream Vite config (no edits inside the submodule), builds in
   upstream's electron mode and injects a one-line `window.electron = { isElectron: true, platform: "tauri" }`
   flag into `index.html`. Output goes to `public/fmg/`, which Vite/Tauri ship as static assets.
2. The World Atlas page loads `/fmg/index.html` in an `<iframe>`. It is served by the same origin as the app
   (`http://localhost:1420` in dev, `tauri://localhost` / `http://tauri.localhost` in production), so the
   host can read the generator's globals directly through `iframe.contentWindow`.
3. `src/features/atlas/fmgBridge.ts` is the **only** place that knows about generator internals:
   - waits until `pack` exists (`waitForMap`), enumerates burgs/states/provinces/markers/rivers/cultures/
     religions (`listFeatures`), resolves a click to the nearest feature or the state/province of the cell
     (`featureAt`, `clientToMap` using the `#viewbox` CTM), zooms with the upstream `window.zoomTo`;
   - saves with `Services.Save.prepareMapData(false)` → `asset_write_text` (`assets/maps/<id>.map`) and
     loads with `Services.Load.uploadMap(new Blob([...]))`;
   - draws host-owned highlight rings in an extra `<g id="dm-workbench-overlay">` inside the viewbox so they
     follow pan/zoom without touching upstream layers;
   - closes the generator's one-time "updated to version X" dialog.
4. Persistence: `world_maps` (seed, asset path, generator version, size), `map_feature_links`
   (feature type + id + name + coordinates → entity) and `map_annotations`. Entity detail pages show their
   map references and deep-link back to the atlas (`/atlas/:mapId?entity=:id` zooms to the feature).

The generator's own editing UI (heightmap, states, burgs, labels, styles, export) remains fully available
inside the frame; nothing was removed. Prefer the frame's own Save menu only for exporting files – the
workbench's **Save to campaign** button is what stores the map in the campaign.

### Limitations of the embedding

- The generator is heavy (~30 MB of JS/assets, 1–3 s per generation). It is loaded only on the atlas page
  and re-created when switching maps.
- Feature links are keyed by generator ids (`burg.i`, `state.i`, …) plus a name and coordinates. If the DM
  regenerates or heavily edits the map inside the generator, ids can change; links keep working by position
  and name but may point at a different feature. The atlas shows the stored feature name so this is visible.
- Upstream dialogs are jQuery UI widgets inside the frame; they are not themed like the host.
- The generator still writes its preferences to the WebView's `localStorage`/IndexedDB (same profile as the
  app). This is local only; nothing is sent anywhere. Dropbox/sharing menu items exist in the frame but have
  no network access path in this app and are not used.
- A harmless upstream exception can be logged when the frame is torn down while a timer is pending.

## Security and privacy posture

- **Capabilities** (`src-tauri/capabilities/default.json`): core window functions, `dialog` open/save/
  message/ask/confirm, `opener:reveal-item-in-dir`, and `opener:open-url` restricted to the generator's GitHub
  page. No `fs`, no `shell`, no `http` plugin.
- **Own commands only**: all file access goes through Rust commands that validate paths. Asset paths are
  relative, must not contain `..`, backslashes or absolute roots, and resolve under `<app-data>/assets`.
  Arbitrary-path reads/writes (`read_text_file`, `write_text_file`, backups, archives) only act on paths the
  user chose in a native dialog.
- **CSP** allows only `self`, `data:`/`blob:` and the asset protocol; `unsafe-eval` is required by the
  generator's bundled libraries and is confined to the same origin.
- **No telemetry, no accounts, no network features.** The build has no analytics and the app never performs
  HTTP requests.
- **No encryption claim.** Data is stored unencrypted in the user profile; use OS disk encryption if needed.

## Build pipeline

```
git submodule ─▶ npm run fmg:install ─▶ npm run fmg:build ─▶ public/fmg/ ─┐
                                                                           ├─▶ npm run build (tsc + vite) ─▶ dist/ ─▶ tauri build ─▶ NSIS/MSI
src/ ──────────────────────────────────────────────────────────────────────┘
```

`src-tauri/tauri.conf.json` sets `beforeBuildCommand: npm run build`, bundles `dist/`, enables the asset
protocol scoped to `$APPDATA/assets/**`, and configures a per-user NSIS installer.
