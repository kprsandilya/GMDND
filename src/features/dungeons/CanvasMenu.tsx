import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Point } from "@/domain/geometry";
import { cn } from "@/lib/utils";
import { useEditor, type Selection } from "./editorStore";

export interface CanvasMenuState {
  screen: { x: number; y: number };
  cell: Point;
  hit: Selection | null;
}

interface Item {
  label: string;
  run: () => unknown;
  danger?: boolean;
}

/**
 * Right-click menu for the dungeon canvas. Entries depend on what is under the cursor and on the mode;
 * every action goes through the editor store, so it is undoable like any other edit.
 */
export function CanvasMenu({ menu, onClose }: { menu: CanvasMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useEditor.getState();
  const data = useEditor((st) => st.data);
  const mode = useEditor((st) => st.mode);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);

  if (!data) return null;
  const edit = mode === "edit";
  const items: Item[] = [];
  const hit = menu.hit;

  if (hit?.type === "token") {
    const t = data.tokens.find((x) => x.id === hit.id);
    if (t) {
      items.push({ label: t.hidden ? "Reveal token" : "Hide token", run: () => s.updateToken(t.id, { hidden: !t.hidden }) });
      if (t.movement_used > 0) items.push({ label: "Reset movement", run: () => s.updateToken(t.id, { movement_used: 0 }) });
    }
  } else if (hit?.type === "object") {
    const o = data.objects.find((x) => x.id === hit.id);
    if (o) {
      if (o.hidden) items.push({ label: o.discovered ? "Mark undiscovered" : "Mark discovered", run: () => s.updateObject(o.id, { discovered: !o.discovered }) });
      items.push({ label: o.hidden ? "Unhide object" : "Hide object", run: () => s.updateObject(o.id, { hidden: !o.hidden }) });
      if (o.kind === "container" || o.kind === "secret_passage") items.push({ label: o.state.open ? "Close" : "Open", run: () => s.updateObject(o.id, { state: { ...o.state, open: !o.state.open } }) });
      if (o.kind === "container") items.push({ label: o.state.locked ? "Unlock" : "Lock", run: () => s.updateObject(o.id, { state: { ...o.state, locked: !o.state.locked } }) });
      if (o.kind === "trap" || o.kind === "hazard") items.push({ label: o.state.disarmed ? "Re-arm" : "Mark disarmed", run: () => s.updateObject(o.id, { state: { ...o.state, disarmed: !o.state.disarmed, triggered: false } }) });
    }
  } else if (hit?.type === "door") {
    const d = data.doors.find((x) => x.id === hit.id);
    if (d) {
      items.push({ label: d.state === "open" ? "Close door" : "Open door", run: () => s.updateDoor(d.id, { state: d.state === "open" ? "closed" : "open" }) });
      items.push({ label: d.state === "locked" ? "Unlock door" : "Lock door", run: () => s.updateDoor(d.id, { state: d.state === "locked" ? "closed" : "locked" }) });
      if (d.hidden || d.kind === "secret") items.push({ label: d.discovered ? "Mark undiscovered" : "Mark discovered", run: () => s.updateDoor(d.id, { discovered: !d.discovered }) });
    }
  } else if (hit?.type === "room") {
    const r = data.rooms.find((x) => x.id === hit.id);
    if (r) {
      items.push({ label: r.state.explored ? "Mark unexplored" : "Mark explored", run: () => s.updateRoom(r.id, { state: { ...r.state, explored: !r.state.explored } }) });
      items.push({ label: r.state.cleared ? "Mark not cleared" : "Mark cleared", run: () => s.updateRoom(r.id, { state: { ...r.state, cleared: !r.state.cleared } }) });
    }
  } else if (hit?.type === "marker") {
    const m = data.markers.find((x) => x.id === hit.id);
    if (m) {
      items.push({ label: m.enabled ? "Disable marker" : "Enable marker", run: () => s.updateMarker(m.id, { enabled: !m.enabled }) });
      items.push({ label: m.dm_only ? "Show to players" : "Make DM only", run: () => s.updateMarker(m.id, { dm_only: !m.dm_only }) });
      if (m.activated) items.push({ label: "Reset trigger", run: () => s.updateMarker(m.id, { activated: false }) });
    }
  }

  if (hit && edit) {
    if (hit.type !== "wall") items.push({ label: "Duplicate", run: () => s.duplicateSelection() });
    items.push({ label: "Delete", run: () => s.deleteSelection(), danger: true });
  }
  if (!hit || hit.type === "room") {
    items.push({ label: "Place token here…", run: () => window.dispatchEvent(new CustomEvent("dm:place-token", { detail: menu.cell })) });
    if (edit) {
      items.push({ label: "Place object here", run: () => s.createObject(menu.cell.x, menu.cell.y) });
      items.push({ label: "Place marker here", run: () => s.createMarker(menu.cell.x, menu.cell.y) });
    }
  }
  if (items.length === 0) return null;

  const left = Math.min(menu.screen.x, window.innerWidth - 200);
  const top = Math.min(menu.screen.y, window.innerHeight - items.length * 28 - 16);
  return createPortal(
    <div ref={ref} className="fixed z-50 min-w-44 rounded border border-border-strong bg-bg-elevated py-1 text-[12.5px] shadow-xl" style={{ left, top }} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={cn("block w-full px-3 py-1 text-left hover:bg-bg-hover", item.danger && "text-blood")}
          onClick={() => {
            onClose();
            void item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
