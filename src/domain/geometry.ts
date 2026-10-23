import type { Door, Room, WallSegment } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const cellCenter = (x: number, y: number): Point => ({ x: x + 0.5, y: y + 0.5 });

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 };
}

/** Grid distance in cells using D&D 5e's default "every diagonal costs 1" rule (Chebyshev). */
export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Alternate 5-10-5 diagonal rule: every second diagonal costs double. */
export function diagonal5105(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const diagonals = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonals;
  return straight + diagonals + Math.floor(diagonals / 2);
}

function orientation(p: Point, q: Point, r: Point): number {
  const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return q.x <= Math.max(p.x, r.x) + 1e-9 && q.x >= Math.min(p.x, r.x) - 1e-9 && q.y <= Math.max(p.y, r.y) + 1e-9 && q.y >= Math.min(p.y, r.y) - 1e-9;
}

/** Proper or touching intersection of two segments. */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, q1, p2)) return true;
  if (o2 === 0 && onSegment(p1, q2, p2)) return true;
  if (o3 === 0 && onSegment(q1, p1, q2)) return true;
  if (o4 === 0 && onSegment(q1, p2, q2)) return true;
  return false;
}

/** True when a straight move between two cell centres crosses a wall. */
export function crossesWall(from: Point, to: Point, walls: WallSegment[]): boolean {
  const a = cellCenter(from.x, from.y);
  const b = cellCenter(to.x, to.y);
  return walls.some((w) => segmentsIntersect(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }));
}

/**
 * A door occupies the edge at (x, y): horizontal doors lie on the top edge of cell (x, y) between
 * cells (x, y-1) and (x, y); vertical doors lie on the left edge between (x-1, y) and (x, y).
 */
export function doorSegment(door: Pick<Door, "x" | "y" | "orientation">): { a: Point; b: Point } {
  return door.orientation === "h"
    ? { a: { x: door.x, y: door.y }, b: { x: door.x + 1, y: door.y } }
    : { a: { x: door.x, y: door.y }, b: { x: door.x, y: door.y + 1 } };
}

export function crossesDoor(from: Point, to: Point, door: Pick<Door, "x" | "y" | "orientation">): boolean {
  const a = cellCenter(from.x, from.y);
  const b = cellCenter(to.x, to.y);
  const seg = doorSegment(door);
  return segmentsIntersect(a, b, seg.a, seg.b);
}

/** Walls that a door passes through must not also block the doorway: remove overlap at that edge. */
export function wallBlocksDoor(wall: WallSegment, door: Pick<Door, "x" | "y" | "orientation">): boolean {
  const seg = doorSegment(door);
  const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
  const onLine = orientation({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }, mid) === 0;
  return onLine && onSegment({ x: wall.x1, y: wall.y1 }, mid, { x: wall.x2, y: wall.y2 });
}

/** Outline walls for a rectangular room, as four segments on the grid lines. */
export function rectWalls(rect: Rect, makeId: () => string): WallSegment[] {
  const { x, y, w, h } = rect;
  return [
    { id: makeId(), x1: x, y1: y, x2: x + w, y2: y },
    { id: makeId(), x1: x + w, y1: y, x2: x + w, y2: y + h },
    { id: makeId(), x1: x + w, y1: y + h, x2: x, y2: y + h },
    { id: makeId(), x1: x, y1: y + h, x2: x, y2: y },
  ];
}

export function roomAt(rooms: Room[], x: number, y: number): Room | undefined {
  return rooms.find((r) => rectContains(r, x, y));
}

/** Rooms that share an edge (or a door) with the given room. */
export function neighbouringRooms(room: Room, rooms: Room[], doors: Door[]): Room[] {
  const expanded: Rect = { x: room.x - 1, y: room.y - 1, w: room.w + 2, h: room.h + 2 };
  const adjacent = rooms.filter((r) => r.id !== room.id && rectsIntersect(expanded, r));
  const viaDoors = doors
    .filter((d) => d.room_a === room.id || d.room_b === room.id)
    .map((d) => (d.room_a === room.id ? d.room_b : d.room_a))
    .filter((id): id is string => !!id)
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is Room => !!r);
  const all = new Map<string, Room>();
  for (const r of [...adjacent, ...viaDoors]) all.set(r.id, r);
  return [...all.values()];
}

/** Snaps a continuous coordinate (in cells) to the nearest grid line. */
export const snapToGrid = (value: number): number => Math.round(value);
export const snapToCell = (value: number): number => Math.floor(value);
