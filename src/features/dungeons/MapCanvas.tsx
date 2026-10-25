import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platform } from "@/app/platform";
import { useAppStore } from "@/app/appStore";
import { doorSegment, normalizeRect, rectsIntersect, type Point, type Rect } from "@/domain/geometry";
import { reachableCells } from "@/domain/movement";
import type { Door, MapMarker, MapObject, Room, Token, WallSegment } from "@/domain/types";
import { ROOM_LOOT_REF } from "@/domain/workflows/lootMarker";
import { cn } from "@/lib/utils";
import { CELL, selectedOfType, useEditor, type Selection } from "./editorStore";

type Drag =
  | { kind: "marquee"; start: Point; current: Point; additive: boolean }
  | { kind: "move"; start: Point; current: Point; moved: boolean }
  | { kind: "room"; start: Point; current: Point }
  | { kind: "terrain"; start: Point; current: Point }
  | { kind: "wall"; start: Point; current: Point }
  | { kind: "resize"; roomId: string; corner: "nw" | "ne" | "sw" | "se"; origin: Rect; current: Point }
  | { kind: "pan"; startScreen: Point; startPan: Point };

export interface PlayHandlers {
  moveToken: (tokenId: string, to: Point) => Promise<void>;
}

const OBJECT_GLYPH: Record<MapObject["kind"], string> = {
  container: "▣",
  furniture: "▤",
  trap: "▲",
  hazard: "☠",
  mechanism: "⚙",
  statue: "♜",
  bookshelf: "▥",
  document: "✎",
  altar: "✝",
  decoration: "✿",
  secret_passage: "◫",
};
const MARKER_COLOR: Record<MapMarker["kind"], string> = {
  event: "#e0a458",
  encounter: "#c0392b",
  trap: "#e67e22",
  treasure: "#d4af37",
  clue: "#3498db",
  npc: "#9b59b6",
  secret: "#8e44ad",
  note: "#7f8c8d",
};
const TOKEN_COLOR: Record<Token["kind"], string> = { pc: "#3b8ea5", npc: "#8e7cc3", creature: "#b23a3a" };

export function MapCanvas({ play }: { play: PlayHandlers | null }) {
  const data = useEditor((s) => s.data);
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const layers = useEditor((s) => s.layers);
  const hover = useEditor((s) => s.hover);
  const ed = useEditor.getState;
  const settings = useAppStore((s) => s.settings);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const scale = CELL * zoom;

  useEffect(() => {
    const rel = data?.floor.background_asset;
    if (!rel) {
      setBgUrl(null);
      return;
    }
    let cancelled = false;
    void platform.assetUrl(rel).then((url) => {
      if (!cancelled) setBgUrl(url);
    }).catch(() => {
      if (!cancelled) setBgUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [data?.floor.background_asset]);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: (e.clientX - rect.left - pan.x) / scale, y: (e.clientY - rect.top - pan.y) / scale };
    },
    [pan, scale],
  );
  const cellOf = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  const vertexOf = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

  // keyboard: space for pan, delete, arrows nudge, ctrl+z/y, ctrl+d, ctrl+a, escape
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
      }
      const s = ed();
      if (!s.data) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void s.undoLast();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        void s.redoLast();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (s.mode === "edit") void s.duplicateSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const d = s.data;
        s.select([
          ...d.rooms.map((r): Selection => ({ type: "room", id: r.id })),
          ...d.doors.map((r): Selection => ({ type: "door", id: r.id })),
          ...d.objects.map((r): Selection => ({ type: "object", id: r.id })),
          ...d.tokens.map((r): Selection => ({ type: "token", id: r.id })),
          ...d.markers.map((r): Selection => ({ type: "marker", id: r.id })),
        ]);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.mode === "edit") {
        e.preventDefault();
        void s.deleteSelection();
      } else if (e.key === "Escape") {
        s.clearSelection();
        s.setTool("select");
        setDrag(null);
      } else if (e.key.startsWith("Arrow") && s.selection.length && s.mode === "edit") {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        void s.moveSelection(dx, dy);
      } else if (!e.ctrlKey && !e.metaKey) {
        const map: Record<string, typeof s.tool> = { v: "select", h: "pan", r: "room", w: "wall", d: "door", o: "object", t: "token", m: "marker", g: "terrain", e: "erase" };
        const t = map[e.key.toLowerCase()];
        if (t && (s.mode === "edit" || t === "select" || t === "pan" || t === "token")) s.setTool(t);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ed]);

  // wheel zoom around cursor
  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(4, Math.max(0.2, zoom * factor));
    const k = next / zoom;
    ed().setView(next, { x: mx - (mx - pan.x) * k, y: my - (my - pan.y) * k });
  };

  const hitTest = (p: Point): Selection | null => {
    if (!data) return null;
    const c = cellOf(p);
    const visible = <T extends { hidden: boolean }>(e: T) => layers.hidden || !e.hidden;
    if (layers.tokens) {
      const t = [...data.tokens].reverse().find((t) => visible(t) && c.x >= t.x && c.x < t.x + t.size && c.y >= t.y && c.y < t.y + t.size);
      if (t) return { type: "token", id: t.id };
    }
    // Objects take priority over markers drawn on top of them; markers stay reachable from the room list.
    if (layers.objects) {
      const o = [...data.objects].reverse().find((o) => visible(o) && c.x >= o.x && c.x < o.x + o.w && c.y >= o.y && c.y < o.y + o.h);
      if (o) return { type: "object", id: o.id };
    }
    if (layers.markers) {
      const m = [...data.markers].reverse().find((m) => c.x >= Math.floor(m.x) && c.x < Math.floor(m.x) + Math.max(1, Math.round(m.w)) && c.y >= Math.floor(m.y) && c.y < Math.floor(m.y) + Math.max(1, Math.round(m.h)));
      if (m) return { type: "marker", id: m.id };
    }
    if (layers.doors) {
      const d = data.doors.find((d) => {
        if (!visible(d)) return false;
        const seg = doorSegment(d);
        const dist = d.orientation === "h" ? Math.abs(p.y - seg.a.y) : Math.abs(p.x - seg.a.x);
        const along = d.orientation === "h" ? p.x >= seg.a.x && p.x <= seg.b.x : p.y >= seg.a.y && p.y <= seg.b.y;
        return dist < 0.3 && along;
      });
      if (d) return { type: "door", id: d.id };
    }
    if (layers.walls) {
      const w = data.floor.walls.find((w) => distToSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }) < 0.2);
      if (w) return { type: "wall", id: w.id };
    }
    if (layers.rooms) {
      const r = data.rooms.find((r) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h);
      if (r) return { type: "room", id: r.id };
    }
    return null;
  };

  const resizeHandleAt = (p: Point): { roomId: string; corner: "nw" | "ne" | "sw" | "se"; origin: Rect } | null => {
    if (!data || mode !== "edit") return null;
    for (const room of selectedOfType(selection, "room", data.rooms)) {
      const corners = { nw: { x: room.x, y: room.y }, ne: { x: room.x + room.w, y: room.y }, sw: { x: room.x, y: room.y + room.h }, se: { x: room.x + room.w, y: room.y + room.h } } as const;
      for (const [corner, pt] of Object.entries(corners) as ["nw" | "ne" | "sw" | "se", Point][]) {
        if (Math.abs(p.x - pt.x) < 0.35 && Math.abs(p.y - pt.y) < 0.35) return { roomId: room.id, corner, origin: { x: room.x, y: room.y, w: room.w, h: room.h } };
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!data) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    const s = ed();
    if (e.button === 1 || tool === "pan" || spaceDown) {
      setDrag({ kind: "pan", startScreen: { x: e.clientX, y: e.clientY }, startPan: pan });
      return;
    }
    if (e.button === 2) return; // context handled by inspector
    const additive = e.shiftKey || e.ctrlKey;

    if (mode === "play") {
      const hit = hitTest(p);
      const selectedToken = selectedOfType(selection, "token", data.tokens)[0];
      // A click on open floor (even inside a room) moves the selected token; other hits select.
      const movesToken = selectedToken && play && tool === "select" && (!hit || hit.type === "room");
      if (hit && !movesToken) {
        if (hit.type === "token") {
          s.select([hit], additive);
          setDrag({ kind: "move", start: p, current: p, moved: false });
        } else s.select([hit], additive);
        return;
      }
      if (movesToken && selectedToken && play) {
        void play.moveToken(selectedToken.id, cellOf(p));
        return;
      }
      if (tool === "token") {
        window.dispatchEvent(new CustomEvent("dm:place-token", { detail: cellOf(p) }));
        return;
      }
      s.clearSelection();
      return;
    }

    switch (tool) {
      case "select": {
        const handle = resizeHandleAt(p);
        if (handle) {
          setDrag({ kind: "resize", roomId: handle.roomId, corner: handle.corner, origin: handle.origin, current: p });
          return;
        }
        const hit = hitTest(p);
        if (hit) {
          const already = selection.some((sel) => sel.id === hit.id);
          if (!already) s.select([hit], additive);
          else if (additive) s.select([hit], true);
          if (!additive || already) setDrag({ kind: "move", start: p, current: p, moved: false });
        } else {
          if (!additive) s.clearSelection();
          setDrag({ kind: "marquee", start: p, current: p, additive });
        }
        break;
      }
      case "room":
        setDrag({ kind: "room", start: cellOf(p), current: cellOf(p) });
        break;
      case "terrain":
        setDrag({ kind: "terrain", start: cellOf(p), current: cellOf(p) });
        break;
      case "wall":
        setDrag({ kind: "wall", start: vertexOf(p), current: vertexOf(p) });
        break;
      case "door": {
        // nearest edge of the cell under the cursor
        const c = cellOf(p);
        const fx = p.x - c.x;
        const fy = p.y - c.y;
        const candidates = [
          { d: fy, x: c.x, y: c.y, o: "h" as const },
          { d: 1 - fy, x: c.x, y: c.y + 1, o: "h" as const },
          { d: fx, x: c.x, y: c.y, o: "v" as const },
          { d: 1 - fx, x: c.x + 1, y: c.y, o: "v" as const },
        ].sort((a, b) => a.d - b.d);
        const best = candidates[0]!;
        void s.createDoor(best.x, best.y, best.o);
        break;
      }
      case "object": {
        const c = cellOf(p);
        void s.createObject(c.x, c.y);
        break;
      }
      case "token":
        window.dispatchEvent(new CustomEvent("dm:place-token", { detail: cellOf(p) }));
        break;
      case "marker": {
        const c = cellOf(p);
        void s.createMarker(c.x, c.y);
        break;
      }
      case "erase": {
        const hit = hitTest(p);
        if (hit) {
          s.select([hit]);
          void s.deleteSelection();
        }
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!data) return;
    const p = toWorld(e);
    const c = cellOf(p);
    if (!hover || hover.x !== c.x || hover.y !== c.y) ed().setHover(c);
    if (!drag) return;
    if (drag.kind === "pan") {
      ed().setView(zoom, { x: drag.startPan.x + e.clientX - drag.startScreen.x, y: drag.startPan.y + e.clientY - drag.startScreen.y });
      return;
    }
    if (drag.kind === "room" || drag.kind === "terrain") setDrag({ ...drag, current: c });
    else if (drag.kind === "wall") setDrag({ ...drag, current: vertexOf(p) });
    else if (drag.kind === "move") setDrag({ ...drag, current: p, moved: drag.moved || Math.abs(p.x - drag.start.x) > 0.3 || Math.abs(p.y - drag.start.y) > 0.3 });
    else setDrag({ ...drag, current: p });
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (!data || !drag) return;
    const s = ed();
    const p = toWorld(e);
    const current = drag;
    setDrag(null);
    if (current.kind === "pan") return;
    if (current.kind === "room") {
      const r = normalizeRect(current.start.x, current.start.y, current.current.x + 1, current.current.y + 1);
      if (r.w >= 1 && r.h >= 1) await s.createRoom({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: r.h });
      return;
    }
    if (current.kind === "terrain") {
      const r = normalizeRect(current.start.x, current.start.y, current.current.x + 1, current.current.y + 1);
      await s.paintTerrain(r);
      return;
    }
    if (current.kind === "wall") {
      const a = current.start;
      const b = vertexOf(p);
      if (a.x !== b.x || a.y !== b.y) await s.addWall({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      return;
    }
    if (current.kind === "marquee") {
      const r = normalizeRect(current.start.x, current.start.y, p.x, p.y);
      if (r.w < 0.2 && r.h < 0.2) return;
      const hits: Selection[] = [];
      for (const room of data.rooms) if (rectsIntersect(r, room)) hits.push({ type: "room", id: room.id });
      for (const o of data.objects) if (rectsIntersect(r, o)) hits.push({ type: "object", id: o.id });
      for (const t of data.tokens) if (rectsIntersect(r, { x: t.x, y: t.y, w: t.size, h: t.size })) hits.push({ type: "token", id: t.id });
      for (const m of data.markers) if (rectsIntersect(r, { x: m.x, y: m.y, w: Math.max(1, m.w), h: Math.max(1, m.h) })) hits.push({ type: "marker", id: m.id });
      for (const d of data.doors) {
        const seg = doorSegment(d);
        if (rectsIntersect(r, { x: Math.min(seg.a.x, seg.b.x) - 0.1, y: Math.min(seg.a.y, seg.b.y) - 0.1, w: Math.abs(seg.b.x - seg.a.x) + 0.2, h: Math.abs(seg.b.y - seg.a.y) + 0.2 })) hits.push({ type: "door", id: d.id });
      }
      s.select(hits, current.additive);
      return;
    }
    if (current.kind === "move") {
      if (!current.moved) return;
      const dx = Math.round(p.x - current.start.x);
      const dy = Math.round(p.y - current.start.y);
      if (mode === "play") {
        const token = selectedOfType(s.selection, "token", data.tokens)[0];
        if (token && play && (dx || dy)) await play.moveToken(token.id, { x: token.x + dx, y: token.y + dy });
        return;
      }
      await s.moveSelection(dx, dy);
      return;
    }
    if (current.kind === "resize") {
      const rect = resizedRect(current.origin, current.corner, p);
      await s.resizeRoom(current.roomId, rect);
    }
  };

  // ---- derived overlays ----
  const selectedToken = data ? selectedOfType(selection, "token", data.tokens)[0] : undefined;
  const reach = useMemo(() => {
    if (!data || mode !== "play" || !selectedToken || !layers.reach) return [];
    return reachableCells(selectedToken, { floor: data.floor, rooms: data.rooms, tokens: data.tokens, doors: data.doors, objects: data.objects, rules: { diagonal: settings.diagonalRule, enforceBudget: settings.enforceMovementBudget } });
  }, [data, mode, selectedToken, layers.reach, settings.diagonalRule, settings.enforceMovementBudget]);

  if (!data) return <div className="flex flex-1 items-center justify-center text-ink-faint">No floor selected.</div>;
  const { floor } = data;
  const W = floor.width;
  const H = floor.height;
  const moveOffset = drag?.kind === "move" && drag.moved ? { x: Math.round(drag.current.x - drag.start.x), y: Math.round(drag.current.y - drag.start.y) } : { x: 0, y: 0 };
  const isSelected = (id: string) => selection.some((s) => s.id === id);
  const offsetFor = (id: string) => (isSelected(id) && mode === "edit" ? moveOffset : { x: 0, y: 0 });
  const cursor = spaceDown || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <svg
      ref={svgRef}
      className={cn("h-full w-full select-none bg-[#0f0d0b]", drag?.kind === "pan" && "cursor-grabbing")}
      style={{ cursor, touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerLeave={() => ed().setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#b23a3a" strokeWidth={1.5} opacity={0.6} />
        </pattern>
      </defs>
      <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
        {/* floor background */}
        <rect x={0} y={0} width={W} height={H} fill="#1a1612" stroke="#3a322c" strokeWidth={0.05} />
        {layers.image && bgUrl && <image href={bgUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" opacity={0.85} />}
        {/* rooms */}
        {layers.rooms &&
          data.rooms.map((room) => {
            const o = offsetFor(room.id);
            const liveRect = drag?.kind === "resize" && drag.roomId === room.id ? resizedRect(drag.origin, drag.corner, drag.current) : null;
            const r = liveRect ?? { x: room.x + o.x, y: room.y + o.y, w: room.w, h: room.h };
            const unexplored = mode === "play" && !room.state.explored;
            return (
              <g key={room.id}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={room.color ?? "#5a4a3a"} opacity={unexplored ? 0.35 : 0.75} stroke={isSelected(room.id) ? "#f0b35a" : "#8a7a66"} strokeWidth={isSelected(room.id) ? 0.08 : 0.04} />
                {room.state.cleared && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#hatch)" opacity={0.25} pointerEvents="none" />}
                {layers.labels && (
                  <text x={r.x + 0.15} y={r.y + 0.45} fontSize={0.38} fill="#f3e9d7" fontFamily="serif" pointerEvents="none">
                    {room.number ? `${room.number}. ` : ""}
                    {room.entity.name}
                  </text>
                )}
                {isSelected(room.id) && mode === "edit" && (
                  <>
                    {[
                      [r.x, r.y],
                      [r.x + r.w, r.y],
                      [r.x, r.y + r.h],
                      [r.x + r.w, r.y + r.h],
                    ].map(([cx, cy], i) => (
                      <rect key={i} x={cx! - 0.15} y={cy! - 0.15} width={0.3} height={0.3} fill="#f0b35a" stroke="#1a1612" strokeWidth={0.03} />
                    ))}
                  </>
                )}
              </g>
            );
          })}
        {/* terrain */}
        {floor.terrain.map((t, i) => (
          <rect key={i} x={t.x} y={t.y} width={1} height={1} fill={t.type === "water" ? "#2b5c7a" : t.type === "difficult" ? "#5c4a2b" : "#444"} opacity={0.5} pointerEvents="none" />
        ))}
        {/* grid */}
        {layers.grid && settings.showGrid && <GridLines w={W} h={H} />}
        {/* reachable cells */}
        {reach.map((c) => (
          <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1} height={1} fill="#3b8ea5" opacity={0.25} pointerEvents="none" />
        ))}
        {/* hover */}
        {hover && hover.x >= 0 && hover.y >= 0 && hover.x < W && hover.y < H && <rect x={hover.x} y={hover.y} width={1} height={1} fill="none" stroke="#f0b35a" strokeWidth={0.04} opacity={0.6} pointerEvents="none" />}
        {/* walls */}
        {layers.walls &&
          floor.walls.map((w) => {
            const o = offsetFor(w.id);
            return <line key={w.id} x1={w.x1 + o.x} y1={w.y1 + o.y} x2={w.x2 + o.x} y2={w.y2 + o.y} stroke={isSelected(w.id) ? "#f0b35a" : "#d8ccb8"} strokeWidth={0.12} strokeLinecap="round" />;
          })}
        {/* doors */}
        {layers.doors &&
          data.doors.map((d) => {
            if (d.hidden && !layers.hidden) return null;
            const o = offsetFor(d.id);
            return <DoorGlyph key={d.id} door={{ ...d, x: d.x + o.x, y: d.y + o.y }} selected={isSelected(d.id)} />;
          })}
        {/* objects */}
        {layers.objects &&
          data.objects.map((obj) => {
            if (obj.hidden && !layers.hidden) return null;
            const o = offsetFor(obj.id);
            return <ObjectGlyph key={obj.id} object={{ ...obj, x: obj.x + o.x, y: obj.y + o.y }} selected={isSelected(obj.id)} showLabel={layers.labels} />;
          })}
        {/* markers */}
        {layers.markers &&
          data.markers.map((m) => {
            if (mode === "play" && !m.dm_only && m.kind === "treasure" && m.trigger_ref === ROOM_LOOT_REF) {
              const room = data.rooms.find((r) => r.id === m.room_id);
              if (room && !room.state.explored) return null;
            }
            const o = offsetFor(m.id);
            return <MarkerGlyph key={m.id} marker={{ ...m, x: m.x + o.x, y: m.y + o.y }} selected={isSelected(m.id)} showLabel={layers.labels} />;
          })}
        {/* tokens */}
        {layers.tokens &&
          data.tokens.map((t) => {
            if (t.hidden && !layers.hidden) return null;
            const o = mode === "play" && isSelected(t.id) && drag?.kind === "move" && drag.moved ? moveOffset : offsetFor(t.id);
            return <TokenGlyph key={t.id} token={{ ...t, x: t.x + o.x, y: t.y + o.y }} selected={isSelected(t.id)} showLabel={layers.labels} />;
          })}
        {/* drag previews */}
        {drag?.kind === "room" && (() => {
          const r = normalizeRect(drag.start.x, drag.start.y, drag.current.x + 1, drag.current.y + 1);
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#f0b35a" opacity={0.25} stroke="#f0b35a" strokeWidth={0.05} pointerEvents="none" />;
        })()}
        {drag?.kind === "terrain" && (() => {
          const r = normalizeRect(drag.start.x, drag.start.y, drag.current.x + 1, drag.current.y + 1);
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#5c4a2b" opacity={0.35} stroke="#c9a44c" strokeWidth={0.05} strokeDasharray="0.15 0.1" pointerEvents="none" />;
        })()}
        {drag?.kind === "wall" && <line x1={drag.start.x} y1={drag.start.y} x2={drag.current.x} y2={drag.current.y} stroke="#f0b35a" strokeWidth={0.12} strokeDasharray="0.2 0.1" pointerEvents="none" />}
        {drag?.kind === "marquee" && (() => {
          const r = normalizeRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y);
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#3b8ea5" opacity={0.15} stroke="#3b8ea5" strokeWidth={0.04} strokeDasharray="0.15 0.1" pointerEvents="none" />;
        })()}
        {tool === "wall" && hover && drag?.kind !== "wall" && <circle cx={Math.round(hover.x + 0.5)} cy={Math.round(hover.y + 0.5)} r={0.12} fill="#f0b35a" pointerEvents="none" />}
      </g>
    </svg>
  );
}

export function GridLines({ w, h }: { w: number; h: number }) {
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= w; x++) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke="#000" strokeOpacity={0.35} strokeWidth={0.02} />);
  for (let y = 0; y <= h; y++) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke="#000" strokeOpacity={0.35} strokeWidth={0.02} />);
  return <g pointerEvents="none">{lines}</g>;
}

export function DoorGlyph({ door, selected }: { door: Door; selected: boolean }) {
  const seg = doorSegment(door);
  const cx = (seg.a.x + seg.b.x) / 2;
  const cy = (seg.a.y + seg.b.y) / 2;
  const color = door.state === "locked" ? "#d4af37" : door.state === "open" || door.state === "broken" ? "#8fbf8f" : door.state === "barred" ? "#b23a3a" : "#e8d9bf";
  const stroke = selected ? "#f0b35a" : color;
  const isH = door.orientation === "h";
  const dash = door.kind === "secret" ? "0.1 0.08" : door.kind === "portcullis" ? "0.05 0.05" : undefined;
  return (
    <g opacity={door.hidden && !door.discovered ? 0.55 : 1}>
      <line x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke="#1a1612" strokeWidth={0.22} />
      {door.kind === "passage" ? (
        <line x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke="#1a1612" strokeWidth={0.18} />
      ) : (
        <rect x={isH ? cx - 0.35 : cx - 0.09} y={isH ? cy - 0.09 : cy - 0.35} width={isH ? 0.7 : 0.18} height={isH ? 0.18 : 0.7} fill={door.state === "open" ? "none" : color} stroke={stroke} strokeWidth={0.05} strokeDasharray={dash} transform={door.state === "open" ? `rotate(${isH ? -60 : 60} ${cx - (isH ? 0.35 : 0)} ${cy - (isH ? 0 : 0.35)})` : undefined} />
      )}
      {door.state === "locked" && <circle cx={cx} cy={cy} r={0.07} fill="#1a1612" />}
      {door.kind === "secret" && <text x={cx - 0.1} y={cy + 0.1} fontSize={0.28} fill="#f0b35a" pointerEvents="none">S</text>}
      {(door.kind === "stairs_up" || door.kind === "stairs_down") && <text x={cx - 0.12} y={cy + 0.1} fontSize={0.28} fill="#f3e9d7" pointerEvents="none">{door.kind === "stairs_up" ? "↑" : "↓"}</text>}
    </g>
  );
}

export function ObjectGlyph({ object, selected, showLabel }: { object: MapObject; selected: boolean; showLabel: boolean }) {
  const dim = object.hidden && !object.discovered;
  const color = object.kind === "trap" || object.kind === "hazard" ? "#e67e22" : object.kind === "container" ? "#c9a14a" : object.kind === "secret_passage" ? "#8e44ad" : "#bfae94";
  return (
    <g opacity={dim ? 0.45 : 1} transform={object.rotation ? `rotate(${object.rotation} ${object.x + object.w / 2} ${object.y + object.h / 2})` : undefined}>
      <rect x={object.x + 0.1} y={object.y + 0.1} width={object.w - 0.2} height={object.h - 0.2} rx={0.1} fill="#2b2420" stroke={selected ? "#f0b35a" : color} strokeWidth={selected ? 0.08 : 0.05} strokeDasharray={dim ? "0.1 0.08" : undefined} />
      <text x={object.x + object.w / 2} y={object.y + object.h / 2 + 0.18} textAnchor="middle" fontSize={0.5} fill={color} pointerEvents="none">
        {OBJECT_GLYPH[object.kind]}
      </text>
      {object.state.locked && <circle cx={object.x + object.w - 0.2} cy={object.y + 0.2} r={0.1} fill="#d4af37" />}
      {object.state.open && <circle cx={object.x + object.w - 0.2} cy={object.y + 0.2} r={0.1} fill="#8fbf8f" />}
      {(object.state.disarmed || object.state.triggered) && <line x1={object.x + 0.15} y1={object.y + 0.15} x2={object.x + object.w - 0.15} y2={object.y + object.h - 0.15} stroke="#8fbf8f" strokeWidth={0.06} />}
      {showLabel && (
        <text x={object.x + object.w / 2} y={object.y + object.h + 0.3} textAnchor="middle" fontSize={0.26} fill="#d8ccb8" pointerEvents="none">
          {object.name}
        </text>
      )}
    </g>
  );
}

export function MarkerGlyph({ marker, selected, showLabel }: { marker: MapMarker; selected: boolean; showLabel: boolean }) {
  const w = Math.max(1, marker.w);
  const h = Math.max(1, marker.h);
  const color = MARKER_COLOR[marker.kind];
  return (
    <g opacity={marker.enabled ? 1 : 0.4}>
      {(w > 1 || h > 1 || marker.trigger === "enter_area") && <rect x={marker.x} y={marker.y} width={w} height={h} fill={color} opacity={0.15} stroke={color} strokeWidth={0.04} strokeDasharray="0.15 0.1" />}
      <g transform={`translate(${marker.x + 0.5} ${marker.y + 0.5})`}>
        <path d="M0,-0.42 L0.36,0 L0,0.42 L-0.36,0 Z" fill={marker.activated ? "#1a1612" : color} stroke={selected ? "#f0b35a" : color} strokeWidth={selected ? 0.08 : 0.05} />
        <text x={0} y={0.12} textAnchor="middle" fontSize={0.3} fill={marker.activated ? color : "#1a1612"} fontWeight={700} pointerEvents="none">
          {marker.kind === "encounter" ? "!" : marker.kind === "treasure" ? "$" : marker.kind === "trap" ? "^" : marker.kind === "secret" ? "?" : "•"}
        </text>
      </g>
      {showLabel && (
        <text x={marker.x + 0.5} y={marker.y - 0.1} textAnchor="middle" fontSize={0.26} fill={color} pointerEvents="none">
          {marker.title}
        </text>
      )}
    </g>
  );
}

export function TokenGlyph({ token, selected, showLabel }: { token: Token; selected: boolean; showLabel: boolean }) {
  const color = token.color ?? TOKEN_COLOR[token.kind];
  const r = token.size / 2 - 0.08;
  const cx = token.x + token.size / 2;
  const cy = token.y + token.size / 2;
  const hpPct = token.max_hp && token.hp !== null ? Math.max(0, Math.min(1, token.hp / token.max_hp)) : null;
  const initials = token.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <g opacity={token.hidden ? 0.5 : 1}>
      <circle cx={cx} cy={cy} r={r} fill={color} stroke={selected ? "#f0b35a" : "#0f0d0b"} strokeWidth={selected ? 0.1 : 0.05} />
      <text x={cx} y={cy + 0.14 * token.size} textAnchor="middle" fontSize={0.38 * token.size} fill="#fff" fontWeight={700} pointerEvents="none" fontFamily="sans-serif">
        {initials}
      </text>
      {hpPct !== null && (
        <>
          <rect x={token.x + 0.1} y={token.y + token.size - 0.16} width={token.size - 0.2} height={0.1} fill="#000" opacity={0.6} />
          <rect x={token.x + 0.1} y={token.y + token.size - 0.16} width={(token.size - 0.2) * hpPct} height={0.1} fill={hpPct > 0.5 ? "#8fbf8f" : hpPct > 0.25 ? "#e0a458" : "#b23a3a"} />
        </>
      )}
      {token.hp === 0 && <text x={cx} y={cy + 0.15} textAnchor="middle" fontSize={0.6} fill="#000" pointerEvents="none">✕</text>}
      {token.conditions.length > 0 && <circle cx={token.x + token.size - 0.15} cy={token.y + 0.15} r={0.12} fill="#9b59b6" stroke="#0f0d0b" strokeWidth={0.03} />}
      {showLabel && (
        <text x={cx} y={token.y + token.size + 0.3} textAnchor="middle" fontSize={0.26} fill="#f3e9d7" pointerEvents="none" fontFamily="sans-serif">
          {token.name}
        </text>
      )}
    </g>
  );
}

function resizedRect(origin: Rect, corner: "nw" | "ne" | "sw" | "se", p: Point): Rect {
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  const x1 = corner === "nw" || corner === "sw" ? Math.min(px, origin.x + origin.w - 1) : origin.x;
  const y1 = corner === "nw" || corner === "ne" ? Math.min(py, origin.y + origin.h - 1) : origin.y;
  const x2 = corner === "ne" || corner === "se" ? Math.max(px, origin.x + 1) : origin.x + origin.w;
  const y2 = corner === "sw" || corner === "se" ? Math.max(py, origin.y + 1) : origin.y + origin.h;
  return normalizeRect(x1, y1, x2, y2);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export type { WallSegment, Room };
