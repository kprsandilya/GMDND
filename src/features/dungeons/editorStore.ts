import { create } from "zustand";
import { normalizeRect, type Rect } from "@/domain/geometry";
import { defaultInteractionsFor } from "@/domain/interactions";
import type { Door, DungeonFloor, MapMarker, MapObject, ObjectKind, Room, Token, WallSegment } from "@/domain/types";
import { UndoStack, type UndoableCommand } from "@/domain/undo";
import type { Repositories } from "@/persistence/repositories";
import type { FloorData } from "@/persistence/repositories/dungeons";
import { newId } from "@/persistence/repositories/common";

export type Tool = "select" | "pan" | "room" | "wall" | "door" | "object" | "token" | "marker" | "erase";
export type ElementType = "room" | "door" | "object" | "token" | "marker" | "wall";
export type Mode = "edit" | "play";

export interface Selection {
  type: ElementType;
  id: string;
}

export interface Layers {
  grid: boolean;
  rooms: boolean;
  walls: boolean;
  doors: boolean;
  objects: boolean;
  tokens: boolean;
  markers: boolean;
  labels: boolean;
  hidden: boolean; // show hidden/undiscovered elements (DM view)
  reach: boolean; // reachable cells overlay in play mode
  image: boolean; // battle-map image under the grid
}

export const CELL = 40;

interface EditorState {
  repos: Repositories | null;
  campaignId: string | null;
  dungeonId: string | null;
  floorId: string | null;
  data: FloorData | null;
  loading: boolean;
  mode: Mode;
  tool: Tool;
  objectKind: ObjectKind;
  markerKind: MapMarker["kind"];
  doorKind: Door["kind"];
  selection: Selection[];
  hover: { x: number; y: number } | null;
  zoom: number;
  pan: { x: number; y: number };
  layers: Layers;
  undo: UndoStack;
  undoVersion: number;
  log: { at: string; text: string; tone?: "info" | "warn" | "success" }[];
  clipboard: Selection[];

  init: (repos: Repositories, campaignId: string, dungeonId: string) => void;
  load: (floorId: string) => Promise<void>;
  refresh: () => Promise<void>;
  setMode: (mode: Mode) => void;
  setTool: (tool: Tool) => void;
  setObjectKind: (kind: ObjectKind) => void;
  setMarkerKind: (kind: MapMarker["kind"]) => void;
  setDoorKind: (kind: Door["kind"]) => void;
  select: (items: Selection[], additive?: boolean) => void;
  clearSelection: () => void;
  setHover: (cell: { x: number; y: number } | null) => void;
  setView: (zoom: number, pan: { x: number; y: number }) => void;
  toggleLayer: (layer: keyof Layers) => void;
  run: (command: UndoableCommand) => Promise<void>;
  undoLast: () => Promise<void>;
  redoLast: () => Promise<void>;
  pushLog: (text: string, tone?: "info" | "warn" | "success") => void;

  // editing commands
  createRoom: (rect: Rect) => Promise<Room | null>;
  addWall: (wall: Omit<WallSegment, "id">) => Promise<void>;
  removeWalls: (ids: string[]) => Promise<void>;
  createDoor: (x: number, y: number, orientation: "h" | "v") => Promise<void>;
  createObject: (x: number, y: number, kind?: ObjectKind) => Promise<MapObject | null>;
  createToken: (input: { x: number; y: number; name: string; kind: Token["kind"]; entity_id?: string | null; hp?: number | null; max_hp?: number | null; speed?: number; size?: number; color?: string | null }) => Promise<Token | null>;
  createMarker: (x: number, y: number) => Promise<MapMarker | null>;
  moveSelection: (dx: number, dy: number) => Promise<void>;
  resizeRoom: (id: string, rect: Rect) => Promise<void>;
  deleteSelection: () => Promise<void>;
  duplicateSelection: () => Promise<void>;
  updateRoom: (id: string, patch: Parameters<Repositories["dungeons"]["updateRoom"]>[1], entityPatch?: Parameters<Repositories["dungeons"]["updateRoom"]>[2]) => Promise<void>;
  updateDoor: (id: string, patch: Partial<Door>) => Promise<void>;
  updateObject: (id: string, patch: Partial<MapObject>) => Promise<void>;
  updateToken: (id: string, patch: Partial<Token>) => Promise<void>;
  updateMarker: (id: string, patch: Partial<MapMarker>) => Promise<void>;
  updateFloor: (patch: Partial<DungeonFloor>) => Promise<void>;
}

const DEFAULT_LAYERS: Layers = { grid: true, rooms: true, walls: true, doors: true, objects: true, tokens: true, markers: true, labels: true, hidden: true, reach: true, image: true };

const ROOM_COLORS = ["#6b5b3e", "#4f5f6b", "#5e4f6b", "#4b6b55", "#6b4f4f", "#5f6b4f"];

function roomFor(data: FloorData, x: number, y: number): string | null {
  return data.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)?.id ?? null;
}

function pick<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export const useEditor = create<EditorState>()((set, get) => {
  const undo = new UndoStack(300);
  undo.subscribe(() => set((s) => ({ undoVersion: s.undoVersion + 1 })));

  const requireCtx = () => {
    const { repos, data, campaignId, dungeonId } = get();
    if (!repos || !data || !campaignId || !dungeonId) throw new Error("Editor not ready");
    return { repos, data, campaignId, dungeonId };
  };

  /** Generic update command with automatic inverse built from the current row. */
  const updateCommand = async <T extends { id: string }>(
    label: string,
    current: T,
    patch: Partial<T>,
    apply: (id: string, p: Partial<T>) => Promise<unknown>,
  ) => {
    const keys = Object.keys(patch) as (keyof T)[];
    const before = pick(current as Record<string, unknown>, keys as string[]) as Partial<T>;
    await get().run({ label, do: () => apply(current.id, patch).then(() => undefined), undo: () => apply(current.id, before).then(() => undefined) });
  };

  return {
    repos: null,
    campaignId: null,
    dungeonId: null,
    floorId: null,
    data: null,
    loading: false,
    mode: "edit",
    tool: "select",
    objectKind: "container",
    markerKind: "event",
    doorKind: "door",
    selection: [],
    hover: null,
    zoom: 1,
    pan: { x: 24, y: 24 },
    layers: DEFAULT_LAYERS,
    undo,
    undoVersion: 0,
    log: [],
    clipboard: [],

    init: (repos, campaignId, dungeonId) => {
      if (get().dungeonId !== dungeonId) {
        undo.clear();
        set({ repos, campaignId, dungeonId, floorId: null, data: null, selection: [], log: [] });
      } else set({ repos, campaignId });
    },
    load: async (floorId) => {
      const repos = get().repos;
      if (!repos) return;
      if (get().floorId !== floorId) {
        undo.clear();
        set({ selection: [], floorId, loading: true });
      }
      const data = await repos.dungeons.loadFloor(floorId);
      set({ data, loading: false });
    },
    refresh: async () => {
      const { repos, floorId } = get();
      if (!repos || !floorId) return;
      const data = await repos.dungeons.loadFloor(floorId);
      // drop selections that no longer exist
      const alive = new Set<string>([...data.rooms, ...data.doors, ...data.objects, ...data.tokens, ...data.markers].map((e) => e.id).concat(data.floor.walls.map((w) => w.id)));
      set((s) => ({ data, selection: s.selection.filter((sel) => alive.has(sel.id)) }));
    },
    setMode: (mode) => set({ mode, tool: "select", selection: [] }),
    setTool: (tool) => set({ tool }),
    setObjectKind: (objectKind) => set({ objectKind }),
    setMarkerKind: (markerKind) => set({ markerKind }),
    setDoorKind: (doorKind) => set({ doorKind }),
    select: (items, additive) =>
      set((s) => {
        if (!additive) return { selection: items };
        const next = [...s.selection];
        for (const item of items) {
          const idx = next.findIndex((n) => n.id === item.id);
          if (idx >= 0) next.splice(idx, 1);
          else next.push(item);
        }
        return { selection: next };
      }),
    clearSelection: () => set({ selection: [] }),
    setHover: (hover) => set({ hover }),
    setView: (zoom, pan) => set({ zoom, pan }),
    toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
    run: async (command) => {
      await undo.execute(command);
      await get().refresh();
    },
    undoLast: async () => {
      const label = await undo.undo();
      if (label) get().pushLog(`Undo: ${label}`);
      await get().refresh();
    },
    redoLast: async () => {
      const label = await undo.redo();
      if (label) get().pushLog(`Redo: ${label}`);
      await get().refresh();
    },
    pushLog: (text, tone) => set((s) => ({ log: [{ at: new Date().toISOString(), text, tone }, ...s.log].slice(0, 200) })),

    createRoom: async (rect) => {
      const { repos, data, campaignId, dungeonId } = requireCtx();
      const id = newId();
      const number = String(data.rooms.length + 1);
      const name = `Room ${number}`;
      const color = ROOM_COLORS[data.rooms.length % ROOM_COLORS.length]!;
      await get().run({
        label: "Create room",
        do: () => repos.dungeons.createRoom({ id, floor_id: data.floor.id, campaign_id: campaignId, dungeon_id: dungeonId, name, number, ...rect, color }).then(() => undefined),
        undo: () => repos.dungeons.deleteRoom(id),
      });
      get().select([{ type: "room", id }]);
      return get().data?.rooms.find((r) => r.id === id) ?? null;
    },
    addWall: async (wall) => {
      const { repos, data } = requireCtx();
      const floorId = data.floor.id;
      const id = newId();
      await get().run({
        label: "Add wall",
        do: async () => {
          const floor = await repos.dungeons.getFloor(floorId);
          await repos.dungeons.updateFloor(floorId, { walls: [...floor.walls, { id, ...wall }] });
        },
        undo: async () => {
          const floor = await repos.dungeons.getFloor(floorId);
          await repos.dungeons.updateFloor(floorId, { walls: floor.walls.filter((w) => w.id !== id) });
        },
      });
    },
    removeWalls: async (ids) => {
      const { repos, data } = requireCtx();
      const floorId = data.floor.id;
      const removed = data.floor.walls.filter((w) => ids.includes(w.id));
      await get().run({
        label: "Remove wall",
        do: async () => {
          const floor = await repos.dungeons.getFloor(floorId);
          await repos.dungeons.updateFloor(floorId, { walls: floor.walls.filter((w) => !ids.includes(w.id)) });
        },
        undo: async () => {
          const floor = await repos.dungeons.getFloor(floorId);
          await repos.dungeons.updateFloor(floorId, { walls: [...floor.walls, ...removed] });
        },
      });
    },
    createDoor: async (x, y, orientation) => {
      const { repos, data } = requireCtx();
      const id = newId();
      const kind = get().doorKind;
      // rooms on either side
      const a = orientation === "v" ? roomFor(data, x - 1, y) : roomFor(data, x, y - 1);
      const b = roomFor(data, x, y);
      await get().run({
        label: "Add door",
        do: () => repos.dungeons.createDoor({ id, floor_id: data.floor.id, x, y, orientation, kind, state: kind === "passage" ? "open" : "closed", hidden: kind === "secret", discovered: kind !== "secret", room_a: a, room_b: b }).then(() => undefined),
        undo: () => repos.dungeons.deleteDoor(id),
      });
      get().select([{ type: "door", id }]);
    },
    createObject: async (x, y, kind) => {
      const { repos, data } = requireCtx();
      const id = newId();
      const k = kind ?? get().objectKind;
      const name = k.charAt(0).toUpperCase() + k.slice(1).replace("_", " ");
      const state = k === "container" ? { locked: false, open: false } : k === "trap" ? { trap_dc: 12 } : {};
      await get().run({
        label: `Add ${name}`,
        do: () => repos.dungeons.createObject({ id, floor_id: data.floor.id, x, y, kind: k, name, room_id: roomFor(data, x, y), state, interactions: defaultInteractionsFor(k, state), hidden: k === "trap" || k === "secret_passage", discovered: !(k === "trap" || k === "secret_passage") }).then(() => undefined),
        undo: () => repos.dungeons.deleteObject(id),
      });
      get().select([{ type: "object", id }]);
      return get().data?.objects.find((o) => o.id === id) ?? null;
    },
    createToken: async (input) => {
      const { repos, data } = requireCtx();
      const id = newId();
      await get().run({
        label: `Place ${input.name}`,
        do: () => repos.dungeons.createToken({ id, floor_id: data.floor.id, ...input, entity_id: input.entity_id ?? null }).then(() => undefined),
        undo: () => repos.dungeons.deleteToken(id),
      });
      get().select([{ type: "token", id }]);
      return get().data?.tokens.find((t) => t.id === id) ?? null;
    },
    createMarker: async (x, y) => {
      const { repos, data } = requireCtx();
      const id = newId();
      const kind = get().markerKind;
      await get().run({
        label: "Add marker",
        do: () => repos.dungeons.createMarker({ id, floor_id: data.floor.id, x, y, kind, title: `${kind.charAt(0).toUpperCase() + kind.slice(1)} marker`, room_id: roomFor(data, x, y), trigger: "manual" }).then(() => undefined),
        undo: () => repos.dungeons.deleteMarker(id),
      });
      get().select([{ type: "marker", id }]);
      return get().data?.markers.find((m) => m.id === id) ?? null;
    },
    moveSelection: async (dx, dy) => {
      const { repos, data } = requireCtx();
      const sel = get().selection;
      if (sel.length === 0 || (dx === 0 && dy === 0)) return;
      const ops: { apply: (d: { x: number; y: number }) => Promise<unknown>; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const s of sel) {
        if (s.type === "room") {
          const r = data.rooms.find((x) => x.id === s.id);
          if (r) ops.push({ apply: (p) => repos.dungeons.updateRoom(r.id, p), from: { x: r.x, y: r.y }, to: { x: r.x + dx, y: r.y + dy } });
        } else if (s.type === "door") {
          const d = data.doors.find((x) => x.id === s.id);
          if (d) ops.push({ apply: (p) => repos.dungeons.updateDoor(d.id, p), from: { x: d.x, y: d.y }, to: { x: d.x + dx, y: d.y + dy } });
        } else if (s.type === "object") {
          const o = data.objects.find((x) => x.id === s.id);
          if (o) ops.push({ apply: (p) => repos.dungeons.updateObject(o.id, { ...p, room_id: roomFor(data, p.x, p.y) }), from: { x: o.x, y: o.y }, to: { x: o.x + dx, y: o.y + dy } });
        } else if (s.type === "token") {
          const t = data.tokens.find((x) => x.id === s.id);
          if (t) ops.push({ apply: (p) => repos.dungeons.updateToken(t.id, p), from: { x: t.x, y: t.y }, to: { x: t.x + dx, y: t.y + dy } });
        } else if (s.type === "marker") {
          const m = data.markers.find((x) => x.id === s.id);
          if (m) ops.push({ apply: (p) => repos.dungeons.updateMarker(m.id, { ...p, room_id: roomFor(data, p.x, p.y) }), from: { x: m.x, y: m.y }, to: { x: m.x + dx, y: m.y + dy } });
        } else if (s.type === "wall") {
          const w = data.floor.walls.find((x) => x.id === s.id);
          if (w) {
            const floorId = data.floor.id;
            ops.push({
              apply: async (p) => {
                const floor = await repos.dungeons.getFloor(floorId);
                const shift = { x: p.x - w.x1, y: p.y - w.y1 };
                await repos.dungeons.updateFloor(floorId, { walls: floor.walls.map((seg) => (seg.id === w.id ? { ...seg, x1: w.x1 + shift.x, y1: w.y1 + shift.y, x2: w.x2 + shift.x, y2: w.y2 + shift.y } : seg)) });
              },
              from: { x: w.x1, y: w.y1 },
              to: { x: w.x1 + dx, y: w.y1 + dy },
            });
          }
        }
      }
      if (ops.length === 0) return;
      await get().run({
        label: `Move ${ops.length} element(s)`,
        do: async () => {
          for (const op of ops) await op.apply(op.to);
        },
        undo: async () => {
          for (const op of ops) await op.apply(op.from);
        },
      });
    },
    resizeRoom: async (id, rect) => {
      const { repos, data } = requireCtx();
      const room = data.rooms.find((r) => r.id === id);
      if (!room) return;
      const next = normalizeRect(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      await updateCommand("Resize room", room, { x: next.x, y: next.y, w: Math.max(1, next.w), h: Math.max(1, next.h) }, (rid, p) => repos.dungeons.updateRoom(rid, p));
    },
    deleteSelection: async () => {
      const { repos, data, campaignId, dungeonId } = requireCtx();
      const sel = get().selection;
      if (sel.length === 0) return;
      const wallIds = sel.filter((s) => s.type === "wall").map((s) => s.id);
      const rooms = data.rooms.filter((r) => sel.some((s) => s.type === "room" && s.id === r.id));
      const doors = data.doors.filter((d) => sel.some((s) => s.type === "door" && s.id === d.id));
      const objects = data.objects.filter((o) => sel.some((s) => s.type === "object" && s.id === o.id));
      const tokens = data.tokens.filter((t) => sel.some((s) => s.type === "token" && s.id === t.id));
      const markers = data.markers.filter((m) => sel.some((s) => s.type === "marker" && s.id === m.id));
      const walls = data.floor.walls.filter((w) => wallIds.includes(w.id));
      const floorId = data.floor.id;
      // Items inside deleted containers are preserved by moving them to "unassigned" so they can be recovered.
      const containerItems = (await Promise.all(objects.map((o) => repos.inventory.listByOwner({ owner_type: "object", owner_id: o.id })))).flat();
      await get().run({
        label: `Delete ${sel.length} element(s)`,
        do: async () => {
          for (const item of containerItems) await repos.inventory.transfer({ instance_id: item.id, to: { owner_type: "unassigned", owner_id: floorId }, note: "container deleted" });
          for (const m of markers) await repos.dungeons.deleteMarker(m.id);
          for (const t of tokens) await repos.dungeons.deleteToken(t.id);
          for (const o of objects) await repos.dungeons.deleteObject(o.id);
          for (const d of doors) await repos.dungeons.deleteDoor(d.id);
          for (const r of rooms) await repos.dungeons.deleteRoom(r.id);
          if (walls.length) {
            const floor = await repos.dungeons.getFloor(floorId);
            await repos.dungeons.updateFloor(floorId, { walls: floor.walls.filter((w) => !wallIds.includes(w.id)) });
          }
        },
        undo: async () => {
          for (const r of rooms)
            await repos.dungeons.createRoom({
              id: r.id,
              floor_id: r.floor_id,
              campaign_id: campaignId,
              dungeon_id: dungeonId,
              name: r.entity.name,
              number: r.number,
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              lighting: r.lighting,
              terrain: r.terrain,
              state: r.state,
              color: r.color,
              summary: r.entity.summary,
              body_md: r.entity.body_md,
              read_aloud_md: r.entity.read_aloud_md,
              dm_notes_md: r.entity.dm_notes_md,
              secret_md: r.entity.secret_md,
              fields: r.entity.fields,
            });
          for (const d of doors) await repos.dungeons.createDoor(d);
          for (const o of objects) await repos.dungeons.createObject(o);
          for (const t of tokens) await repos.dungeons.createToken(t);
          for (const m of markers) await repos.dungeons.createMarker(m);
          for (const item of containerItems) {
            const current = await repos.inventory.find(item.id);
            if (current) await repos.inventory.transfer({ instance_id: current.id, to: { owner_type: "object", owner_id: item.owner_id! }, note: "container restored" });
          }
          if (walls.length) {
            const floor = await repos.dungeons.getFloor(floorId);
            await repos.dungeons.updateFloor(floorId, { walls: [...floor.walls, ...walls] });
          }
        },
      });
      set({ selection: [] });
    },
    duplicateSelection: async () => {
      const { repos, data, campaignId, dungeonId } = requireCtx();
      const sel = get().selection;
      if (sel.length === 0) return;
      const created: Selection[] = [];
      const makers: { do: () => Promise<unknown>; undo: () => Promise<unknown> }[] = [];
      for (const s of sel) {
        const id = newId();
        if (s.type === "room") {
          const r = data.rooms.find((x) => x.id === s.id);
          if (!r) continue;
          makers.push({
            do: () => repos.dungeons.createRoom({ id, floor_id: r.floor_id, campaign_id: campaignId, dungeon_id: dungeonId, name: `${r.entity.name} (copy)`, number: null, x: r.x + 1, y: r.y + 1, w: r.w, h: r.h, lighting: r.lighting, terrain: r.terrain, color: r.color, summary: r.entity.summary, body_md: r.entity.body_md, read_aloud_md: r.entity.read_aloud_md, dm_notes_md: r.entity.dm_notes_md, secret_md: r.entity.secret_md }),
            undo: () => repos.dungeons.deleteRoom(id),
          });
          created.push({ type: "room", id });
        } else if (s.type === "object") {
          const o = data.objects.find((x) => x.id === s.id);
          if (!o) continue;
          makers.push({ do: () => repos.dungeons.createObject({ ...o, id, x: o.x + 1, y: o.y + 1, state: { ...o.state, interactions_used: [] } }), undo: () => repos.dungeons.deleteObject(id) });
          created.push({ type: "object", id });
        } else if (s.type === "token") {
          const t = data.tokens.find((x) => x.id === s.id);
          if (!t) continue;
          makers.push({ do: () => repos.dungeons.createToken({ ...t, id, x: t.x + 1, y: t.y + 1, movement_used: 0 }), undo: () => repos.dungeons.deleteToken(id) });
          created.push({ type: "token", id });
        } else if (s.type === "marker") {
          const m = data.markers.find((x) => x.id === s.id);
          if (!m) continue;
          makers.push({ do: () => repos.dungeons.createMarker({ ...m, id, x: m.x + 1, y: m.y + 1, activated: false, activated_at: null, activation_count: 0 }), undo: () => repos.dungeons.deleteMarker(id) });
          created.push({ type: "marker", id });
        } else if (s.type === "door") {
          const d = data.doors.find((x) => x.id === s.id);
          if (!d) continue;
          makers.push({ do: () => repos.dungeons.createDoor({ ...d, id, x: d.x + 1, y: d.y + 1 }), undo: () => repos.dungeons.deleteDoor(id) });
          created.push({ type: "door", id });
        }
      }
      if (makers.length === 0) return;
      await get().run({
        label: `Duplicate ${makers.length} element(s)`,
        do: async () => {
          for (const m of makers) await m.do();
        },
        undo: async () => {
          for (const m of makers) await m.undo();
        },
      });
      set({ selection: created });
    },
    updateRoom: async (id, patch, entityPatch) => {
      const { repos, data } = requireCtx();
      const room = data.rooms.find((r) => r.id === id);
      if (!room) return;
      const beforeRoom = pick(room as unknown as Record<string, unknown>, Object.keys(patch)) as typeof patch;
      const beforeEntity = entityPatch ? (pick(room.entity as unknown as Record<string, unknown>, Object.keys(entityPatch)) as typeof entityPatch) : undefined;
      await get().run({
        label: "Edit room",
        do: () => repos.dungeons.updateRoom(id, patch, entityPatch).then(() => undefined),
        undo: () => repos.dungeons.updateRoom(id, beforeRoom, beforeEntity).then(() => undefined),
      });
    },
    updateDoor: async (id, patch) => {
      const { repos, data } = requireCtx();
      const door = data.doors.find((d) => d.id === id);
      if (door) await updateCommand("Edit door", door, patch, (i, p) => repos.dungeons.updateDoor(i, p));
    },
    updateObject: async (id, patch) => {
      const { repos, data } = requireCtx();
      const object = data.objects.find((o) => o.id === id);
      if (object) await updateCommand("Edit object", object, patch, (i, p) => repos.dungeons.updateObject(i, p));
    },
    updateToken: async (id, patch) => {
      const { repos, data } = requireCtx();
      const token = data.tokens.find((t) => t.id === id);
      if (token) await updateCommand("Edit token", token, patch, (i, p) => repos.dungeons.updateToken(i, p));
    },
    updateMarker: async (id, patch) => {
      const { repos, data } = requireCtx();
      const marker = data.markers.find((m) => m.id === id);
      if (marker) await updateCommand("Edit marker", marker, patch, (i, p) => repos.dungeons.updateMarker(i, p));
    },
    updateFloor: async (patch) => {
      const { repos, data } = requireCtx();
      await updateCommand("Edit floor", data.floor, patch, (i, p) => repos.dungeons.updateFloor(i, p));
    },
  };
});

export function selectedOfType<T extends { id: string }>(selection: Selection[], type: ElementType, items: T[]): T[] {
  const ids = new Set(selection.filter((s) => s.type === type).map((s) => s.id));
  return items.filter((i) => ids.has(i.id));
}
