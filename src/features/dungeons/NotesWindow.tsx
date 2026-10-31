import { useQuery } from "@tanstack/react-query";
import { Columns2, Eye, PencilLine, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { platform, type NotesTarget } from "@/app/platform";
import { emitNotesSaved, NOTES_SAVED, onAppEvent, requestMainNavigation, type NotesSaved } from "@/app/windowEvents";
import { MarkdownView } from "@/components/Markdown";
import { Button } from "@/components/ui";
import type { Repositories } from "@/persistence/repositories";
import { cn, errorMessage } from "@/lib/utils";

type Layout = "split" | "write" | "preview";

interface LoadedNotes {
  title: string;
  subtitle: string;
  notes: string;
}

/** Reads the notes a target points at: a dungeon's DM notes, or one floor's notes. */
export async function loadNotes(repos: Repositories, target: NotesTarget): Promise<LoadedNotes> {
  if (target.scope === "dungeon") {
    const dungeon = await repos.entities.get(target.id);
    return { title: dungeon.name, subtitle: "Dungeon notes", notes: dungeon.dm_notes_md };
  }
  const floor = await repos.dungeons.getFloor(target.id);
  const dungeon = await repos.entities.find(floor.dungeon_id);
  return { title: floor.name, subtitle: `${dungeon?.name ?? "Dungeon"} · floor notes`, notes: floor.notes_md };
}

/** Writes notes for a target and returns the stored text. */
export async function saveNotes(repos: Repositories, target: NotesTarget, notes: string): Promise<string> {
  if (target.scope === "dungeon") return (await repos.entities.update(target.id, { dm_notes_md: notes })).dm_notes_md;
  return (await repos.dungeons.updateFloor(target.id, { notes_md: notes })).notes_md;
}

/**
 * Pop-out window for a dungeon's or floor's DM notes: a large editor with a live preview. Saves write to
 * the database and tell the main window to refresh; `[[links]]` open in the main window.
 */
export function NotesWindow({ target }: { target: NotesTarget }) {
  const repos = useRepos();
  const loaded = useQuery({ queryKey: ["notesWindow", target.scope, target.id], queryFn: () => loadNotes(repos, target), retry: false });
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [layout, setLayout] = useState<Layout>("split");
  const [busy, setBusy] = useState(false);
  const dirty = saved !== null && draft !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // first load
  useEffect(() => {
    if (loaded.data && saved === null) {
      setSaved(loaded.data.notes);
      setDraft(loaded.data.notes);
    }
  }, [loaded.data, saved]);

  // saved elsewhere (main window): take it over unless there is unsaved text here
  useEffect(
    () =>
      onAppEvent<NotesSaved>(NOTES_SAVED, (p) => {
        if (p.scope !== target.scope || p.id !== target.id || p.notes_md === saved) return;
        if (dirtyRef.current) {
          toast.warning("These notes were changed in the main window. Saving here will replace that version.");
          return;
        }
        setSaved(p.notes_md);
        setDraft(p.notes_md);
      }),
    [target.scope, target.id, saved],
  );

  // warn before closing with unsaved text
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void platform.guardClose(() => dirtyRef.current, "Close without saving these notes?").then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  // window title shows what is being edited and an unsaved marker
  useEffect(() => {
    if (loaded.data) document.title = `${dirty ? "• " : ""}${loaded.data.subtitle} — ${loaded.data.title}`;
  }, [loaded.data, dirty]);

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const stored = await saveNotes(repos, target, draft);
      setSaved(stored);
      emitNotesSaved({ ...target, notes_md: stored });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loaded.isError) return <Centered text={`This ${target.scope} no longer exists. You can close this window.`} />;
  if (!loaded.data || saved === null) return <Centered text="Loading notes…" />;

  const openInMain = (href: string) => {
    requestMainNavigation(href);
    void platform.focusMainWindow();
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] text-ember-soft">{loaded.data.title}</div>
          <div className="truncate text-[11px] text-ink-faint">{loaded.data.subtitle} · Markdown, [[Name]] links open in the main window</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded border border-border">
            {(
              [
                ["write", PencilLine, "Write"],
                ["split", Columns2, "Split"],
                ["preview", Eye, "Preview"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button key={value} className={cn("flex items-center gap-1 px-2 py-1 text-[12px]", layout === value ? "bg-bg-active text-ember-soft" : "text-ink-muted hover:text-ink")} onClick={() => setLayout(value)}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
              Discard
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={() => void save()} title="Save (Ctrl+S)">
            <Save size={12} /> {dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>
      <div className={cn("grid min-h-0 flex-1", layout === "split" ? "grid-cols-2" : "grid-cols-1")}>
        {layout !== "preview" && (
          <textarea
            autoFocus
            spellCheck
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={target.scope === "dungeon" ? "The big picture: who built this place, what the villain wants, how the floors connect, the clock…\n\nLink records with [[Name]]." : "What this level is for, who lives here, what changes when the party arrives…\n\nLink records with [[Name]]."}
            className={cn("selectable h-full w-full resize-none bg-bg p-4 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint", layout === "split" && "border-r border-border")}
          />
        )}
        {layout !== "write" && (
          <div className="min-h-0 overflow-y-auto p-4">
            <MarkdownView source={draft} onNavigate={openInMain} className="text-[13.5px]" />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-1 text-[11px] text-ink-faint">
        {dirty ? <span className="text-gold">Unsaved changes · Ctrl+S to save</span> : "All changes saved"} · {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
      </div>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">{text}</div>;
}
