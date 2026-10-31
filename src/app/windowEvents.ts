/**
 * Messages between the main window and pop-out windows (Tauri events, local to this app).
 * Every helper is a no-op outside the desktop shell so tests and plain browsers keep working.
 */
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri, type NotesTarget } from "./platform";

/** Dungeon or floor notes were saved; other windows showing the same notes should reload them. */
export const NOTES_SAVED = "dm:notes-saved";
/** A pop-out asks the main window to open an app route (e.g. a `[[link]]` was clicked). */
export const NAVIGATE_MAIN = "dm:navigate-main";

export interface NotesSaved extends NotesTarget {
  notes_md: string;
}

export function emitNotesSaved(payload: NotesSaved): void {
  if (isTauri()) void emit(NOTES_SAVED, payload).catch(() => undefined);
}

export function requestMainNavigation(href: string): void {
  if (isTauri()) void emit(NAVIGATE_MAIN, { href }).catch(() => undefined);
}

/** Subscribes and returns a cleanup function suitable for useEffect. */
export function onAppEvent<T>(name: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<T>(name, (e) => handler(e.payload)).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
