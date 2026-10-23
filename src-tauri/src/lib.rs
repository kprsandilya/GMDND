mod archive;
mod assets;
mod db;
mod error;

use tauri::Manager;

use assets::Paths;
use db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Production data lives in the per-user application data directory, never in the
            // install directory or a temporary folder.
            let data_dir = app.path().app_data_dir()?;
            let paths = Paths::new(data_dir);
            paths.ensure_dirs()?;
            let db = Db::open(paths.db_path.clone())?;
            app.manage(paths);
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_execute,
            db::db_batch,
            db::db_execute_script,
            assets::app_paths,
            assets::asset_write_text,
            assets::asset_read_text,
            assets::asset_exists,
            assets::asset_abs_path,
            assets::asset_import_file,
            assets::asset_export_file,
            assets::asset_delete,
            assets::read_text_file,
            assets::write_text_file,
            archive::backup_create,
            archive::backup_inspect,
            archive::backup_restore,
            archive::backup_auto,
            archive::campaign_archive_write,
            archive::archive_read_text,
            archive::archive_extract_assets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DM Workbench");
}
