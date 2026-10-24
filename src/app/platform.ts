/**
 * Typed wrappers around the desktop shell: Rust commands (files, assets, backups) and the
 * native dialog plugin. Everything that touches the filesystem goes through here.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { ask, confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface AppPaths {
  data_dir: string;
  db_path: string;
  assets_dir: string;
  backups_dir: string;
}

export interface AssetInfo {
  rel_path: string;
  file_name: string;
  size: number;
}

export interface BackupInfo {
  path: string;
  size: number;
  asset_count: number;
  created_at: string;
}

export interface BackupManifest {
  format: string;
  version: number;
  app_version: string;
  created_at: string;
  asset_count: number;
}

export interface RestoreInfo {
  restored_assets: number;
  previous_database: string;
  manifest: BackupManifest;
}

export const platform = {
  appVersion: async (): Promise<string> => (isTauri() ? getVersion() : "dev"),
  paths: (): Promise<AppPaths> => invoke<AppPaths>("app_paths"),

  // assets
  writeTextAsset: (category: string, extension: string, text: string, relPath?: string | null): Promise<AssetInfo> =>
    invoke<AssetInfo>("asset_write_text", { category, extension, text, relPath: relPath ?? null }),
  readTextAsset: (relPath: string): Promise<string> => invoke<string>("asset_read_text", { relPath }),
  assetExists: (relPath: string): Promise<boolean> => invoke<boolean>("asset_exists", { relPath }),
  assetAbsPath: (relPath: string): Promise<string> => invoke<string>("asset_abs_path", { relPath }),
  importFileAsset: (sourcePath: string, category: string): Promise<AssetInfo> => invoke<AssetInfo>("asset_import_file", { sourcePath, category }),
  exportAsset: (relPath: string, destPath: string): Promise<number> => invoke<number>("asset_export_file", { relPath, destPath }),
  deleteAsset: (relPath: string): Promise<void> => invoke("asset_delete", { relPath }),
  assetUrl: async (relPath: string): Promise<string> => convertFileSrc(await invoke<string>("asset_abs_path", { relPath })),
  readTextFile: (path: string): Promise<string> => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, text: string): Promise<void> => invoke("write_text_file", { path, text }),

  // backups & archives
  createBackup: (destPath: string): Promise<BackupInfo> => invoke<BackupInfo>("backup_create", { destPath }),
  inspectBackup: (srcPath: string): Promise<BackupManifest> => invoke<BackupManifest>("backup_inspect", { srcPath }),
  restoreBackup: (srcPath: string): Promise<RestoreInfo> => invoke<RestoreInfo>("backup_restore", { srcPath }),
  autoBackup: (keep: number): Promise<string> => invoke<string>("backup_auto", { keep }),
  writeCampaignArchive: (destPath: string, campaignJson: string, assets: { rel_path: string }[]): Promise<number> =>
    invoke<number>("campaign_archive_write", { destPath, campaignJson, assets }),
  readArchiveText: (srcPath: string, entryName: string): Promise<string> => invoke<string>("archive_read_text", { srcPath, entryName }),
  extractArchiveAssets: (srcPath: string, mappings: { from: string; to: string }[]): Promise<number> =>
    invoke<number>("archive_extract_assets", { srcPath, mappings }),

  // dialogs
  pickFile: async (options: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> => {
    const result = await open({ multiple: false, directory: false, title: options.title, filters: options.filters });
    return typeof result === "string" ? result : null;
  },
  pickSavePath: async (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> => {
    const result = await save({ title: options.title, defaultPath: options.defaultPath, filters: options.filters });
    return result ?? null;
  },
  pickDirectory: async (title?: string): Promise<string | null> => {
    const result = await open({ directory: true, multiple: false, title });
    return typeof result === "string" ? result : null;
  },
  confirm: (text: string, title = "Confirm"): Promise<boolean> => (isTauri() ? confirm(text, { title, kind: "warning" }) : Promise.resolve(window.confirm(text))),
  ask: (text: string, title = "Question"): Promise<boolean> => (isTauri() ? ask(text, { title }) : Promise.resolve(window.confirm(text))),
  message: (text: string, title = "DM Workbench"): Promise<void> => (isTauri() ? message(text, { title }).then(() => undefined) : Promise.resolve(window.alert(text))),
  revealInFolder: (path: string): Promise<void> => revealItemInDir(path),
  openExternal: (url: string): Promise<void> => (isTauri() ? openUrl(url) : Promise.resolve(void window.open(url, "_blank"))),
};

export const MAP_FILTER = [{ name: "Azgaar map", extensions: ["map"] }];
export const ARCHIVE_FILTER = [{ name: "DM Workbench archive", extensions: ["zip"] }];
export const IMAGE_FILTER = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }];
