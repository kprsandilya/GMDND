//! Zip archives: full backups (database snapshot + every asset) and campaign exports
//! (a JSON document prepared by the frontend + the assets it references).

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::assets::Paths;
use crate::db::{validate_database_file, Db};
use crate::error::{AppError, AppResult};

pub const BACKUP_FORMAT: &str = "dm-workbench-backup";
pub const BACKUP_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: String,
    pub asset_count: usize,
}

#[derive(Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub size: u64,
    pub asset_count: usize,
    pub created_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn deflate() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk_files(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

fn rel_string(base: &Path, path: &Path) -> AppResult<String> {
    let rel = path.strip_prefix(base).map_err(|_| AppError::invalid("asset outside of asset directory"))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn add_file(zip: &mut ZipWriter<File>, name: &str, source: &Path) -> AppResult<()> {
    zip.start_file(name, deflate())?;
    let mut file = File::open(source)?;
    std::io::copy(&mut file, zip)?;
    Ok(())
}

fn add_text(zip: &mut ZipWriter<File>, name: &str, text: &str) -> AppResult<()> {
    zip.start_file(name, deflate())?;
    zip.write_all(text.as_bytes())?;
    Ok(())
}

/// Entry names are validated so a crafted archive cannot write outside the target directory.
fn safe_entry_name(name: &str) -> AppResult<&str> {
    if name.is_empty() || name.contains("..") || name.starts_with('/') || name.contains('\\') || name.contains(':') {
        return Err(AppError::invalid(format!("unsafe archive entry: {name}")));
    }
    Ok(name)
}

pub fn create_backup(db: &Db, paths: &Paths, dest: &Path, app_version: &str) -> AppResult<BackupInfo> {
    let snapshot = paths.backups_dir.join(format!("snapshot-{}.sqlite", uuid::Uuid::new_v4()));
    db.snapshot_to(&snapshot)?;

    let result = (|| -> AppResult<BackupInfo> {
        let mut assets = Vec::new();
        walk_files(&paths.assets_dir, &mut assets)?;
        let created_at = now();
        let manifest = BackupManifest {
            format: BACKUP_FORMAT.into(),
            version: BACKUP_VERSION,
            app_version: app_version.into(),
            created_at: created_at.clone(),
            asset_count: assets.len(),
        };

        let tmp = dest.with_extension("zip.tmp");
        {
            let file = File::create(&tmp)?;
            let mut zip = ZipWriter::new(file);
            add_text(&mut zip, "manifest.json", &serde_json::to_string_pretty(&manifest)?)?;
            add_file(&mut zip, "database.sqlite", &snapshot)?;
            for asset in &assets {
                let name = format!("assets/{}", rel_string(&paths.assets_dir, asset)?);
                add_file(&mut zip, &name, asset)?;
            }
            zip.finish()?;
        }
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        std::fs::rename(&tmp, dest)?;
        let size = std::fs::metadata(dest)?.len();
        Ok(BackupInfo { path: dest.display().to_string(), size, asset_count: assets.len(), created_at })
    })();

    let _ = std::fs::remove_file(&snapshot);
    result
}

pub fn read_manifest(src: &Path) -> AppResult<BackupManifest> {
    let mut archive = ZipArchive::new(File::open(src)?)?;
    let mut entry = archive.by_name("manifest.json").map_err(|_| AppError::invalid("archive has no manifest.json"))?;
    let mut text = String::new();
    entry.read_to_string(&mut text)?;
    let manifest: BackupManifest = serde_json::from_str(&text)?;
    if manifest.format != BACKUP_FORMAT {
        return Err(AppError::invalid(format!("not a DM Workbench backup (format: {})", manifest.format)));
    }
    if manifest.version > BACKUP_VERSION {
        return Err(AppError::invalid(format!(
            "backup version {} is newer than this application supports ({BACKUP_VERSION})",
            manifest.version
        )));
    }
    Ok(manifest)
}

#[derive(Serialize)]
pub struct RestoreInfo {
    pub restored_assets: usize,
    pub previous_database: String,
    pub manifest: BackupManifest,
}

/// Replaces the live database and assets with the archive's content. The previous database and
/// asset directory are kept beside the backups so a bad restore can be undone by hand.
pub fn restore_backup(db: &Db, paths: &Paths, src: &Path) -> AppResult<RestoreInfo> {
    let manifest = read_manifest(src)?;
    let mut archive = ZipArchive::new(File::open(src)?)?;

    // 1. Extract and validate the database before touching anything live.
    let staged_db = paths.backups_dir.join(format!("restore-{}.sqlite", uuid::Uuid::new_v4()));
    {
        let mut entry = archive.by_name("database.sqlite").map_err(|_| AppError::invalid("archive has no database.sqlite"))?;
        let mut out = File::create(&staged_db)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    if let Err(error) = validate_database_file(&staged_db) {
        let _ = std::fs::remove_file(&staged_db);
        return Err(error);
    }

    // 2. Extract assets to a staging directory.
    let staged_assets = paths.data_dir.join(format!("assets.restore-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staged_assets)?;
    let mut restored_assets = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name: String = match entry.name() {
            Ok(name) => name.to_string(),
            Err(_) => continue, // an entry with an undecodable name is not one of ours
        };
        let Some(rel) = name.strip_prefix("assets/") else { continue };
        if rel.is_empty() || entry.is_dir() {
            continue;
        }
        let rel = safe_entry_name(rel)?;
        let target = staged_assets.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
        restored_assets += 1;
    }

    // 3. Swap: close the live connection, keep the old files, move the staged ones into place.
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let previous_db = paths.backups_dir.join(format!("pre-restore-{stamp}.sqlite"));
    db.close()?;
    let swap = (|| -> AppResult<()> {
        if paths.db_path.exists() {
            std::fs::rename(&paths.db_path, &previous_db)?;
        }
        for suffix in ["-wal", "-shm"] {
            let side = PathBuf::from(format!("{}{suffix}", paths.db_path.display()));
            if side.exists() {
                std::fs::remove_file(side)?;
            }
        }
        std::fs::rename(&staged_db, &paths.db_path)?;
        if paths.assets_dir.exists() {
            let previous_assets = paths.backups_dir.join(format!("pre-restore-{stamp}-assets"));
            std::fs::rename(&paths.assets_dir, previous_assets)?;
        }
        std::fs::rename(&staged_assets, &paths.assets_dir)?;
        Ok(())
    })();
    let reopen = db.reopen();
    swap?;
    reopen?;

    Ok(RestoreInfo { restored_assets, previous_database: previous_db.display().to_string(), manifest })
}

/// Keeps a rolling set of automatic database snapshots in `backups/auto`.
pub fn auto_snapshot(db: &Db, paths: &Paths, keep: usize) -> AppResult<String> {
    let dir = paths.backups_dir.join("auto");
    std::fs::create_dir_all(&dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let dest = dir.join(format!("auto-{stamp}.sqlite"));
    db.snapshot_to(&dest)?;

    let mut existing: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|e| e == "sqlite").unwrap_or(false))
        .collect();
    existing.sort();
    while existing.len() > keep.max(1) {
        let oldest = existing.remove(0);
        let _ = std::fs::remove_file(oldest);
    }
    Ok(dest.display().to_string())
}

#[derive(Deserialize)]
pub struct AssetCopy {
    pub rel_path: String,
}

/// Writes a campaign export: `campaign.json` prepared by the frontend plus the referenced assets.
pub fn write_campaign_archive(paths: &Paths, dest: &Path, campaign_json: &str, assets: &[AssetCopy]) -> AppResult<u64> {
    let tmp = dest.with_extension("zip.tmp");
    {
        let file = File::create(&tmp)?;
        let mut zip = ZipWriter::new(file);
        add_text(&mut zip, "campaign.json", campaign_json)?;
        for asset in assets {
            let abs = paths.resolve_asset(&asset.rel_path)?;
            if abs.is_file() {
                add_file(&mut zip, &format!("assets/{}", asset.rel_path), &abs)?;
            }
        }
        zip.finish()?;
    }
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    std::fs::rename(&tmp, dest)?;
    Ok(std::fs::metadata(dest)?.len())
}

pub fn read_archive_text(src: &Path, entry_name: &str) -> AppResult<String> {
    let mut archive = ZipArchive::new(File::open(src)?)?;
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|_| AppError::invalid(format!("archive has no {entry_name}")))?;
    let mut text = String::new();
    entry.read_to_string(&mut text)?;
    Ok(text)
}

#[derive(Deserialize)]
pub struct AssetMapping {
    pub from: String,
    pub to: String,
}

/// Extracts `assets/<from>` entries into the managed directory under `<to>`.
pub fn extract_archive_assets(paths: &Paths, src: &Path, mappings: &[AssetMapping]) -> AppResult<usize> {
    let mut archive = ZipArchive::new(File::open(src)?)?;
    let mut count = 0usize;
    for mapping in mappings {
        let target = paths.resolve_asset(&mapping.to)?;
        let Ok(mut entry) = archive.by_name(&format!("assets/{}", mapping.from)) else { continue };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
        count += 1;
    }
    Ok(count)
}

// ---- commands ----

#[tauri::command]
pub fn backup_create(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    paths: tauri::State<'_, Paths>,
    dest_path: String,
) -> AppResult<BackupInfo> {
    let version = app.package_info().version.to_string();
    create_backup(&db, &paths, Path::new(&dest_path), &version)
}

#[tauri::command]
pub fn backup_inspect(src_path: String) -> AppResult<BackupManifest> {
    read_manifest(Path::new(&src_path))
}

#[tauri::command]
pub fn backup_restore(db: tauri::State<'_, Db>, paths: tauri::State<'_, Paths>, src_path: String) -> AppResult<RestoreInfo> {
    restore_backup(&db, &paths, Path::new(&src_path))
}

#[tauri::command]
pub fn backup_auto(db: tauri::State<'_, Db>, paths: tauri::State<'_, Paths>, keep: usize) -> AppResult<String> {
    auto_snapshot(&db, &paths, keep)
}

#[tauri::command]
pub fn campaign_archive_write(
    paths: tauri::State<'_, Paths>,
    dest_path: String,
    campaign_json: String,
    assets: Vec<AssetCopy>,
) -> AppResult<u64> {
    write_campaign_archive(&paths, Path::new(&dest_path), &campaign_json, &assets)
}

#[tauri::command]
pub fn archive_read_text(src_path: String, entry_name: String) -> AppResult<String> {
    read_archive_text(Path::new(&src_path), &entry_name)
}

#[tauri::command]
pub fn archive_extract_assets(
    paths: tauri::State<'_, Paths>,
    src_path: String,
    mappings: Vec<AssetMapping>,
) -> AppResult<usize> {
    extract_archive_assets(&paths, Path::new(&src_path), &mappings)
}
