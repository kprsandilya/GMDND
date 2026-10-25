import { describe, expect, it } from "vitest";
import { evaluateMove, isDifficultCell, reachableCells, type MoveContext } from "./movement";
import type { Token } from "./types";

const hero = { id: "h", floor_id: "f", entity_id: null, name: "Hero", kind: "pc", x: 0, y: 0, size: 1, color: null, hidden: false, hp: 10, max_hp: 10, conditions: [], speed: 30, movement_used: 0, created_at: "", updated_at: "" } as Token;

const ctx = (extra: Partial<MoveContext> = {}): MoveContext => ({
  floor: { width: 20, height: 20, walls: [], cell_feet: 5, terrain: [{ x: 2, y: 0, type: "difficult" }, { x: 3, y: 0, type: "water" }, { x: 4, y: 0, type: "rubble-free" }] },
  tokens: [hero],
  doors: [],
  objects: [],
  ...extra,
});

describe("difficult terrain", () => {
  it("recognises painted cells and rooms marked difficult", () => {
    const c = ctx({ rooms: [{ x: 10, y: 10, w: 2, h: 2, terrain: "Difficult: rubble" }] });
    expect(isDifficultCell(c, 2, 0)).toBe(true);
    expect(isDifficultCell(c, 3, 0)).toBe(true);
    expect(isDifficultCell(c, 4, 0)).toBe(false);
    expect(isDifficultCell(c, 11, 11)).toBe(true);
    expect(isDifficultCell(c, 12, 11)).toBe(false);
  });

  it("charges an extra cell for each difficult cell entered", () => {
    const move = evaluateMove(hero, { x: 4, y: 0 }, ctx());
    expect(move).toMatchObject({ ok: true, distanceCells: 6, distanceFeet: 30, difficultCells: 2 });
  });

  it("refuses a move the budget cannot pay once terrain is counted, and can be switched off", () => {
    const tired = { ...hero, movement_used: 5 };
    expect(evaluateMove(tired, { x: 4, y: 0 }, ctx()).reason).toMatch(/with difficult terrain/);
    expect(evaluateMove(tired, { x: 4, y: 0 }, ctx({ rules: { difficultTerrain: false } })).ok).toBe(true);
  });

  it("shrinks the reachable area through difficult terrain", () => {
    const open = reachableCells(hero, ctx({ floor: { width: 20, height: 20, walls: [], cell_feet: 5, terrain: [] } }));
    const rough = reachableCells(hero, ctx());
    expect(open.some((c) => c.x === 6 && c.y === 0)).toBe(true);
    expect(rough.some((c) => c.x === 6 && c.y === 0)).toBe(false);
  });
});
