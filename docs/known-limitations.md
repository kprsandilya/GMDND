# Known limitations

An honest list of what is unfinished, simplified or constrained. See `docs/implementation-plan.md` for the
feature status matrix.

## Platform and packaging

- **Windows is the only tested target.** The code is portable (Tauri supports macOS and Linux), but the
  installer configuration, the smoke test (WebView2 flag) and all verification were done on Windows 11.
- **No auto-update.** Install a newer `-setup.exe` over the old one; data in `%APPDATA%` is preserved.
- **No code signing.** SmartScreen may warn when running the installer from a download; this is expected
  for an unsigned private build.
- **Single window, single instance assumptions.** Running two instances against the same database is not
  supported (SQLite will serialise writes, but the second window's caches will be stale).

## World atlas (Fantasy Map Generator)

- The generator is a ~30 MB web application; the atlas page takes 1–3 seconds to appear and generating a
  map takes another 1–3 seconds. It is unloaded when you leave the page and reloaded on return (the saved
  map is restored from the asset, unsaved edits inside the frame are lost – the toolbar shows an "unsaved
  changes" badge after regeneration).
- Feature links are keyed by the generator's numeric ids plus name and coordinates. Regenerating the map or
  deleting/merging burgs and states inside the generator can make a link point at a different feature; the
  link list shows the stored feature name so this is visible, and links can be removed and re-made.
- The generator's dialogs (burg editor, style editor, …) are upstream jQuery UI widgets and are not themed
  like the rest of the workbench. Its Dropbox/sharing menu items are inert in this offline app.
- Only the host's "Save to campaign" stores a map in the campaign database; the generator's own
  "Save → to machine" produces a file download handled by the webview, which is not linked to a record.
- Overlay highlights (linked features, annotations) are drawn as simple rings/labels and do not scale with
  the generator's own label styling.
- On the very first launch of the atlas the generator may briefly show its "updated to version …" dialog
  before the bridge dismisses it.

## Dungeon editor and simulation

- Rooms are **axis-aligned rectangles**; irregular caves can be approximated with multiple rooms and free
  walls, but there is no polygon room tool.
- There is **no fog of war or line-of-sight rendering**; discovery is tracked per room/door/object and the
  "hidden" layer toggle hides undiscovered things, which is sufficient for a DM-only screen.
- Movement uses grid rules (Chebyshev or 5-10-5 diagonals) with wall/door collision and a per-token budget.
  Difficult terrain, climbing, swimming and opportunity attacks are not modelled.
- Dice are entered manually by design (the brief asks for manual entry); the quick-roll button in the roll
  dialog is a convenience, not a rules engine.
- Object interactions are data-driven JSON; the inspector provides defaults per object kind and a JSON
  editor, not a form builder for custom interactions.
- Per-floor background images are stored in the schema but there is no picker in the UI yet.
- Right-click context menus are not implemented; every action is available in the inspector and via
  keyboard shortcuts.
- Markers drawn on top of an object take hit priority when clicking; hide the markers layer or select the
  object from the room list in the inspector.

## Encounters and combat

- The combat tracker covers initiative, turn order, HP/temp HP, conditions, defeat and a log. It does not
  model spell slots, legendary resistance counters or concentration beyond free-text resources.
- XP is summed from creature templates; encounter difficulty is the DM's label, not a computed budget.

## Worldbuilding and records

- Entity field forms are generated from the Zod schemas: good coverage, but long stat blocks are free text
  (traits, actions, attacks) rather than structured sub-tables.
- Backlinks from `[[wiki links]]` are resolved at render time by name; renaming a record does not rewrite
  existing Markdown.
- Search is SQLite `LIKE`-based over names, summaries and bodies; it is fast for personal campaigns but has
  no stemming or ranking.
- Images can be attached to records as assets but there is no image gallery or map-pin image picker.

## Data management

- Backups and exports are plain zip files; nothing is encrypted (stated in the UI).
- Import always creates a new campaign; there is no merge into an existing campaign.
- Auto snapshots contain the database only (assets are only in full backups).
- Schema migrations are forward-only; a database from a newer app version is refused with a message rather
  than downgraded.

## Testing

- Unit and integration tests cover the domain rules, workflows and repositories (29 tests on `node:sqlite`).
- The end-to-end smoke test drives the real desktop window through the DevTools protocol and checks every
  route plus the editor and the atlas; it does not yet script full combat or interaction scenarios (those
  are covered at the workflow level).
- No Rust unit tests; the Rust core is small and is exercised by the smoke test and manual backup/restore.

## Cosmetic

- The "slate" theme option exists in Settings but only the default Ember theme is styled.
- The dungeon editor's object labels can overlap in dense rooms; use the labels layer toggle.
- A harmless upstream exception may be logged in the DevTools console when leaving the atlas while the
  generator still has a pending timer.
