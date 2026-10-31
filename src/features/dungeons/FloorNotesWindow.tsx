import { useQuery } from "@tanstack/react-query";
import { Columns2, Eye, PencilLine, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { platform } from "@/app/platform";
import { emitFloorNotesSaved, FLOOR_NOTES_SAVED, onAppEvent, requestMainNavigation, type FloorNotesSaved } from "@/app/windowEvents";
import { MarkdownView } from "@/components/Markdown";
import { Button } from "@/components/ui";
import { cn, errorMessage } from "@/lib/utils";

type Layout = "split" | "write" | "preview";

/**
 * Pop-out window for one floor's DM notes: a large editor with a live preview. Saves write to the database
 * and tell the main window to refresh; `[[links]]` open in the main window.
 */
export function FloorNotesWindow({ floorId }: { floorId: string }) {
  const repos = useRepos();
  const floor = useQuery({ queryKey: ["floorNotes", floorId], queryFn: () => repos.dungeons.getFloor(floorId), retry: false });
  const dungeon = useQuery({ queryKey: ["entities", "one", floor.data?.dungeon_id], queryFn: () => repos.entities.find(floor.data!.dungeon_id), enabled: !!floor.data });
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [layout, setLayout] = useState<Layout>("split");
  const [busy, setBusy] = useState(false);
  const dirty = saved !== null && draft !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // first load
  useEffect(() => {
    if (floor.data && saved === null) {
      setSaved(floor.data.notes_md);
      setDraft(floor.data.notes_md);
    }
  }, [floor.data, saved]);

  // saved elsewhere (main window): take it over unless there is unsaved text here
  useEffect(
    () =>
      onAppEvent<FloorNotesSaved>(FLOOR_NOTES_SAVED, (p) => {
        if (p.floorId !== floorId || p.notes_md === saved) return;
        if (dirtyRef.current) {
          toast.warning("These notes were changed in the main window. Saving here will replace that version.");
          return;
        }
        setSaved(p.notes_md);
        setDraft(p.notes_md);
      }),
    [floorId, saved],
  );

  // warn before closing with unsaved text
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void platform.guardClose(() => dirtyRef.current, "Close without saving these notes?").then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  // window title shows the floor and an unsaved marker
  useEffect(() => {
    if (floor.data) document.title = `${dirty ? "• " : ""}Floor notes — ${dungeon.data?.name ? `${dungeon.data.name} / ` : ""}${floor.data.name}`;
  }, [floor.data, dungeon.data, dirty]);

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const updated = await repos.dungeons.updateFloor(floorId, { notes_md: draft });
      setSaved(updated.notes_md);
      emitFloorNotesSaved({ floorId, notes_md: updated.notes_md });
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

  if (floor.isError) return <Centered text="This floor no longer exists. You can close this window." />;
  if (!floor.data || saved === null) return <Centered text="Loading notes…" />;

  const openInMain = (href: string) => {
    requestMainNavigation(href);
    void platform.focusMainWindow();
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] text-ember-soft">{floor.data.name}</div>
          <div className="truncate text-[11px] text-ink-faint">{dungeon.data?.name ?? "Dungeon"} · floor notes · Markdown, [[Name]] links open in the main window</div>
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
            placeholder={"What this level is for, who lives here, what changes when the party arrives…\n\nLink records with [[Name]]."}
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
