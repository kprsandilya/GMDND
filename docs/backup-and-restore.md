# Data storage, backups, export and recovery

## Where data lives

Everything is stored under the per-user application data directory (shown in **Settings & Data → Storage**,
with a *Reveal data folder* button):

```
%APPDATA%\com.dmworkbench.app\
├── workbench.sqlite          the campaign database (SQLite, WAL mode; -wal/-shm side files while open)
├── assets\                   files referenced by records
│   ├── maps\<id>.map         world maps saved from the atlas (Fantasy Map Generator format)
│   └── images\…              imported images
└── backups\
    ├── auto\auto-<stamp>.sqlite      rolling startup snapshots (database only)
    ├── pre-restore-<stamp>.sqlite    the database that was live before a restore
    └── pre-restore-<stamp>-assets\   the asset folder that was live before a restore
```

Nothing is written to the installation directory or to temporary folders, and the application never sends
data over the network. Files are not encrypted; rely on operating-system disk encryption if your machine
needs it.

The UI preferences (theme, panel widths, last campaign, grid defaults) are kept in the WebView's local
storage; they are not part of the campaign data and are not included in backups.

## Automatic startup snapshots

When *Snapshot database on startup* is enabled (default), the app runs `VACUUM INTO` on the live database
during boot and stores the result in `backups\auto\`. Only the last *N* snapshots are kept (default 7).
Snapshots contain the whole database but not the assets folder; they are a quick "yesterday's state" safety
net. To use one, close the app, copy the snapshot over `workbench.sqlite` (delete the `-wal`/`-shm` side
files first) and start the app again.

## Full backups

**Settings & Data → Backups → Create backup…** writes a single zip file to a location you choose in the
native save dialog:

```
dm-workbench-backup.zip
├── manifest.json      { format: "dm-workbench-backup", version: 1, app_version, created_at, asset_count }
├── database.sqlite    consistent snapshot taken with VACUUM INTO (safe while the app is running)
└── assets/…           every file in the assets folder
```

Backups include **all campaigns**. Keep them anywhere – external disk, cloud folder, USB stick.

### Restore

**Restore from backup…** asks for a zip, shows its manifest (date, app version, asset count) and asks for
confirmation because the restore replaces *all* current data. The Rust core then:

1. extracts `database.sqlite` to a staging file and validates it (`PRAGMA integrity_check`, expected tables);
2. extracts the assets to a staging folder, rejecting any entry whose name escapes the folder;
3. closes the live connection, renames the current database and assets to
   `backups\pre-restore-<stamp>…` (never deleted), moves the staged files into place and reopens.

If any step fails before the swap, nothing live is touched. After a successful restore the window reloads.
Because the previous database and assets are kept next to the backups, a restore can itself be undone by
swapping the files back while the app is closed.

Backups made by a newer app version may contain a newer schema; the app refuses to open a database whose
schema version is higher than it knows. Backups from older versions are migrated forward on the next start.

## Campaign export and import

Export is per campaign and is meant for moving or archiving a single campaign, or for sharing it between
your own machines. **Settings & Data → Campaign export / import → Export "<campaign>"** writes:

```
<campaign>.zip
├── campaign.json      { format: "dm-workbench-campaign", version: 1, schema_version, app_version,
│                        exported_at, campaign: { entities, links, world_maps, feature_links,
│                        annotations, floors, rooms, doors, objects, tokens, markers, item_instances,
│                        participants, runs, combatants, objectives, timeline, session_notes, log } }
└── assets/…           only the assets referenced by this campaign (maps, images)
```

`campaign.json` is validated with a Zod schema (`src/persistence/exportImport.ts`) on import.

**Import campaign…** always creates a **new** campaign: every id in the archive is remapped to a fresh UUID
(including cross-references between tables), the campaign can be renamed on the way in, and nothing that
already exists is modified or overwritten. Assets are extracted under new names into `assets/`. After
import, `findMissingReferences` scans the new campaign for dangling references (for example a token whose
creature record was absent from the export) and reports them as notes; the import still succeeds.

Archives whose `version` is higher than the app understands are rejected with a clear message; older
versions are accepted (the format is versioned so future readers can upgrade them).

## Seed campaign reset

*Embers of Hollowmere* can be recreated at any time from **Campaigns → Reset demo campaign**. The reset
deletes only the campaign flagged `is_demo` and re-creates it; other campaigns, backups and assets
are untouched.

## Recovery checklist

| Situation | What to do |
| --- | --- |
| Accidentally deleted records today | Close the app; copy the newest `backups\auto\auto-*.sqlite` over `workbench.sqlite` (remove `-wal`/`-shm`), restart. |
| Machine replaced / reinstall | Install the app, then **Restore from backup…** with your last full backup zip. |
| Share one campaign with another machine | **Export** on the source, **Import** on the destination. |
| Restore went wrong | Close the app and swap `backups\pre-restore-<stamp>.sqlite` / `…-assets` back into place. |
| Database refuses to open after an update | Check Settings for the schema version message; restore the pre-update auto snapshot if the migration failed. |
