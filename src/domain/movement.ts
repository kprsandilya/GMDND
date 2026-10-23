import { chebyshev, crossesDoor, crossesWall, diagonal5105, rectContains, type Point } from "./geometry";
import type { Door, DungeonFloor, MapObject, Token } from "./types";

export type DiagonalRule = "chebyshev" | "5-10-5";

export interface MovementRules {
  diagonal: DiagonalRule;
  enforceBudget: boolean;
  blockOnTokens: boolean;
  blockOnWalls: boolean;
  blockOnClosedDoors: boolean;
  blockOnObjects: boolean;
}

export const DEFAULT_MOVEMENT_RULES: MovementRules = {
  diagonal: "chebyshev",
  enforceBudget: true,
  blockOnTokens: true,
  blockOnWalls: true,
  blockOnClosedDoors: true,
  blockOnObjects: false,
};

export interface MoveContext {
  floor: Pick<DungeonFloor, "width" | "height" | "walls" | "cell_feet">;
  tokens: Token[];
  doors: Door[];
  objects: MapObject[];
  rules?: Partial<MovementRules>;
}

export interface MoveResult {
  ok: boolean;
  reason?: string;
  distanceCells: number;
  distanceFeet: number;
  movementUsedAfter: number;
}

const BLOCKING_OBJECT_KINDS = new Set(["statue", "altar", "furniture", "container", "bookshelf"]);

/** Bresenham-like walk over cells between two cells (inclusive of destination). */
export function cellsAlongPath(from: Point, to: Point): Point[] {
  const cells: Point[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 10000; guard++) {
    if (x === to.x && y === to.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    cells.push({ x, y });
  }
  return cells;
}

/**
 * Validates a token move. The DM stays in control: every rule can be toggled, and the result
 * carries a reason so the UI can explain why a move was refused.
 */
export function evaluateMove(token: Token, to: Point, ctx: MoveContext): MoveResult {
  const rules = { ...DEFAULT_MOVEMENT_RULES, ...ctx.rules };
  const from = { x: token.x, y: token.y };
  const measure = rules.diagonal === "5-10-5" ? diagonal5105 : chebyshev;
  const distanceCells = measure(from, to);
  const distanceFeet = distanceCells * ctx.floor.cell_feet;
  const movementUsedAfter = token.movement_used + distanceFeet;
  const base = { distanceCells, distanceFeet, movementUsedAfter };

  if (to.x < 0 || to.y < 0 || to.x + token.size > ctx.floor.width || to.y + token.size > ctx.floor.height)
    return { ...base, ok: false, reason: "Outside the map" };
  if (distanceCells === 0) return { ...base, ok: true };

  if (rules.blockOnTokens) {
    const footprint = { x: to.x, y: to.y, w: token.size, h: token.size };
    const occupied = ctx.tokens.find(
      (t) => t.id !== token.id && t.floor_id === token.floor_id && rectsOverlap(footprint, { x: t.x, y: t.y, w: t.size, h: t.size }),
    );
    if (occupied) return { ...base, ok: false, reason: `Occupied by ${occupied.name}` };
  }

  if (rules.blockOnObjects) {
    const blocker = ctx.objects.find((o) => !o.hidden && BLOCKING_OBJECT_KINDS.has(o.kind) && rectContains({ x: Math.floor(o.x), y: Math.floor(o.y), w: Math.max(1, Math.round(o.w)), h: Math.max(1, Math.round(o.h)) }, to.x, to.y));
    if (blocker) return { ...base, ok: false, reason: `Blocked by ${blocker.name}` };
  }

  // Walk the path cell by cell so walls and doors between intermediate cells are respected.
  const path = [from, ...cellsAlongPath(from, to)];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const doorHere = ctx.doors.find((d) => crossesDoor(a, b, d));
    if (doorHere) {
      if (rules.blockOnClosedDoors && doorHere.state !== "open" && doorHere.state !== "broken" && doorHere.kind !== "passage")
        return { ...base, ok: false, reason: doorHere.state === "locked" ? "The door is locked" : "The door is closed" };
      continue; // an open door overrides the wall drawn across it
    }
    if (rules.blockOnWalls && crossesWall(a, b, ctx.floor.walls)) return { ...base, ok: false, reason: "A wall is in the way" };
  }

  if (rules.enforceBudget && movementUsedAfter > token.speed)
    return { ...base, ok: false, reason: `Not enough movement (${token.speed - token.movement_used} ft left, needs ${distanceFeet} ft)` };

  return { ...base, ok: true };
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Cells reachable this turn, for the movement overlay. */
export function reachableCells(token: Token, ctx: MoveContext): Point[] {
  const rules = { ...DEFAULT_MOVEMENT_RULES, ...ctx.rules };
  const remainingFeet = Math.max(0, token.speed - token.movement_used);
  const radius = Math.floor(remainingFeet / ctx.floor.cell_feet);
  if (radius <= 0) return [];
  const result: Point[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue;
      const to = { x: token.x + dx, y: token.y + dy };
      const check = evaluateMove(token, to, { ...ctx, rules: { ...rules, enforceBudget: true } });
      if (check.ok) result.push(to);
    }
  }
  return result;
}

/** Whether an actor stands next to (or on) a target footprint: needed to interact with objects. */
export function isAdjacent(actor: Pick<Token, "x" | "y" | "size">, target: { x: number; y: number; w?: number; h?: number }, reach = 1): boolean {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const tw = Math.max(1, Math.round(target.w ?? 1));
  const th = Math.max(1, Math.round(target.h ?? 1));
  const ax1 = actor.x - reach;
  const ay1 = actor.y - reach;
  const ax2 = actor.x + actor.size - 1 + reach;
  const ay2 = actor.y + actor.size - 1 + reach;
  return tx <= ax2 && tx + tw - 1 >= ax1 && ty <= ay2 && ty + th - 1 >= ay1;
}
