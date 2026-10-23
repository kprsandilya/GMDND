//! Managed asset directory: map files, images and other binaries referenced from the database by
//! a relative path. Every path coming from the frontend is validated to stay inside the directory.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub struct Paths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub assets_dir: PathBuf,
    pub backups_dir: PathBuf,
}

impl Paths {
    pub fn new(data_dir: PathBuf) -> Self {
        Paths {
            db_path: data_dir.join("workbench.sqlite"),
            assets_dir: data_dir.join("assets"),
            backups_dir: data_dir.join("backups"),
            data_dir,
        }
    }

    pub fn ensure_dirs(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.assets_dir)?;
        std::fs::create_dir_all(self.backups_dir.join("auto"))?;
        Ok(())
    }

    /// Resolves a relative asset path, rejecting anything that could escape the asset directory.
    pub fn resolve_asset(&self, relative: &str) -> AppResult<PathBuf> {
        let rel = Path::new(relative);
        if relative.is_empty() || rel.is_absolute() || relative.contains('\\') || relative.contains("..") {
            return Err(AppError::invalid(format!("invalid asset path: {relative}")));
        }
        for component in rel.components() {
            match component {
                Component::Normal(_) => {}
                _ => return Err(AppError::invalid(format!("invalid asset path: {relative}"))),
            }
        }
        Ok(self.assets_dir.join(rel))
    }
}

#[derive(Serialize)]
pub struct AssetInfo {
    pub rel_path: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct AppPaths {
    pub data_dir: String,
    pub db_path: String,
    pub assets_dir: String,
    pub backups_dir: String,
}

fn sanitize_extension(ext: &str) -> String {
    let cleaned: String = ext
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>()
        .to_lowercase();
    if cleaned.is_empty() {
        "bin".to_string()
    } else {
        cleaned
    }
}

fn file_info(rel_path: String, abs: &Path) -> AppResult<AssetInfo> {
    let meta = std::fs::metadata(abs)?;
    let file_name = abs.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
    Ok(AssetInfo { rel_path, file_name, size: meta.len() })
}

#[tauri::command]
pub fn app_paths(paths: tauri::State<'_, Paths>) -> AppPaths {
    AppPaths {
        data_dir: paths.data_dir.display().to_string(),
        db_path: paths.db_path.display().to_string(),
        assets_dir: paths.assets_dir.display().to_string(),
        backups_dir: paths.backups_dir.display().to_string(),
    }
}

/// Stores text (for example an Azgaar `.map` file) under `category/<uuid>.<ext>` and returns its path.
#[tauri::command]
pub fn asset_write_text(
    paths: tauri::State<'_, Paths>,
    category: String,
    extension: String,
    text: String,
    rel_path: Option<String>,
) -> AppResult<AssetInfo> {
    let rel = match rel_path {
        Some(existing) => existing,
        None => format!(
            "{}/{}.{}",
            sanitize_extension(&category),
            uuid::Uuid::new_v4(),
            sanitize_extension(&extension)
        ),
    };
    let abs = paths.resolve_asset(&rel)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = abs.with_extension("tmp");
    std::fs::write(&tmp, text.as_bytes())?;
    std::fs::rename(&tmp, &abs)?;
    file_info(rel, &abs)
}

#[tauri::command]
pub fn asset_read_text(paths: tauri::State<'_, Paths>, rel_path: String) -> AppResult<String> {
    let abs = paths.resolve_asset(&rel_path)?;
    Ok(std::fs::read_to_string(abs)?)
}

#[tauri::command]
pub fn asset_exists(paths: tauri::State<'_, Paths>, rel_path: String) -> AppResult<bool> {
    Ok(paths.resolve_asset(&rel_path)?.exists())
}

#[tauri::command]
pub fn asset_abs_path(paths: tauri::State<'_, Paths>, rel_path: String) -> AppResult<String> {
    Ok(paths.resolve_asset(&rel_path)?.display().to_string())
}

/// Copies a user-selected file (from a native dialog) into the managed directory.
#[tauri::command]
pub fn asset_import_file(paths: tauri::State<'_, Paths>, source_path: String, category: String) -> AppResult<AssetInfo> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(AppError::invalid(format!("source file not found: {source_path}")));
    }
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let rel = format!("{}/{}.{}", sanitize_extension(&category), uuid::Uuid::new_v4(), sanitize_extension(ext));
    let abs = paths.resolve_asset(&rel)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&source, &abs)?;
    file_info(rel, &abs)
}

/// Copies a managed asset to a user-selected destination (native save dialog).
#[tauri::command]
pub fn asset_export_file(paths: tauri::State<'_, Paths>, rel_path: String, dest_path: String) -> AppResult<u64> {
    let abs = paths.resolve_asset(&rel_path)?;
    Ok(std::fs::copy(abs, dest_path)?)
}

#[tauri::command]
pub fn asset_delete(paths: tauri::State<'_, Paths>, rel_path: String) -> AppResult<()> {
    let abs = paths.resolve_asset(&rel_path)?;
    if abs.exists() {
        std::fs::remove_file(abs)?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    // Only used with paths returned by the native open dialog.
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
pub fn write_text_file(path: String, text: String) -> AppResult<()> {
    // Only used with paths returned by the native save dialog.
    std::fs::write(path, text.as_bytes())?;
    Ok(())
}
