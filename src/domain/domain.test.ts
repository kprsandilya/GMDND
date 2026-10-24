import { describe, expect, it } from "vitest";
import { addDays, formatDate } from "./calendar";
import { averageOf, parseDice, roll } from "./dice";
import { normalizeFields } from "./schemas";
import { actionsFromSheet, assessEncounter, parseActionBlob, snapshotSheet, writeActionsToSheet } from "./statblock";
import { parseSrdCreatures } from "./srdImport";
import { chebyshev, crossesWall, diagonal5105, neighbouringRooms, rectWalls, segmentsIntersect } from "./geometry";
import { checkPreconditions, containerInteractions, resolveInteraction } from "./interactions";
import { extractWikiLinks, rewriteWikiLinks } from "./markdown";
import { evaluateMove, isAdjacent, reachableCells } from "./movement";
import type { Door, MapObject, Room, Token } from "./types";
import { UndoStack } from "./undo";

const token = (over: Partial<Token> = {}): Token => ({
  id: "t1",
  floor_id: "f1",
  entity_id: null,
  name: "Hero",
  kind: "pc",
  x: 1,
  y: 1,
  size: 1,
  color: null,
  hidden: false,
  hp: 10,
  max_hp: 10,
  conditions: [],
  speed: 30,
  movement_used: 0,
  created_at: "",
  updated_at: "",
  ...over,
});

const floor = { width: 20, height: 20, cell_feet: 5, walls: [{ id: "w", x1: 5, y1: 0, x2: 5, y2: 20 }] };

describe("geometry", () => {
  it("detects segment intersections and wall crossings", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(false);
    expect(crossesWall({ x: 4, y: 3 }, { x: 5, y: 3 }, floor.walls)).toBe(true);
    expect(crossesWall({ x: 3, y: 3 }, { x: 4, y: 3 }, floor.walls)).toBe(false);
  });

  it("measures distance with both diagonal rules", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(3);
    expect(diagonal5105({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(3);
    expect(rectWalls({ x: 1, y: 1, w: 2, h: 2 }, () => "id")).toHaveLength(4);
  });

  it("finds neighbouring rooms by adjacency and doors", () => {
    const mk = (id: string, x: number): Room => ({ id, floor_id: "f", number: null, x, y: 0, w: 2, h: 2, lighting: "", terrain: "", state: {}, color: null, entity: {} as Room["entity"] });
    const a = mk("a", 0);
    const b = mk("b", 2);
    const c = mk("c", 10);
    const door = { room_a: "a", room_b: "c" } as Door;
    expect(neighbouringRooms(a, [a, b, c], [door]).map((r) => r.id).sort()).toEqual(["b", "c"]);
  });
});

describe("movement", () => {
  it("blocks walls, closed doors, occupied cells and overspending movement", () => {
    const hero = token();
    const ctx = { floor, tokens: [hero, token({ id: "t2", x: 2, y: 1, name: "Orc" })], doors: [] as Door[], objects: [] as MapObject[] };
    expect(evaluateMove(hero, { x: 2, y: 1 }, ctx)).toMatchObject({ ok: false, reason: "Occupied by Orc" });
    expect(evaluateMove(hero, { x: 6, y: 1 }, ctx)).toMatchObject({ ok: false, reason: "A wall is in the way" });
    expect(evaluateMove(hero, { x: 4, y: 1 }, ctx)).toMatchObject({ ok: true, distanceFeet: 15, movementUsedAfter: 15 });
    expect(evaluateMove(hero, { x: 1, y: 8 }, ctx).ok).toBe(false); // 35 ft > 30 ft
    expect(evaluateMove(hero, { x: 1, y: 8 }, { ...ctx, rules: { enforceBudget: false } }).ok).toBe(true);
    expect(evaluateMove(hero, { x: -1, y: 1 }, ctx).reason).toBe("Outside the map");
  });

  it("lets open doors override walls and closed doors block", () => {
    const hero = token({ x: 4, y: 3 });
    const door: Door = { id: "d", floor_id: "f1", x: 5, y: 3, orientation: "v", kind: "door", state: "closed", lock_dc: null, key_item_id: null, room_a: null, room_b: null, target_floor_id: null, hidden: false, discovered: true, notes: "", created_at: "", updated_at: "" };
    const ctx = { floor, tokens: [hero], doors: [door], objects: [] };
    expect(evaluateMove(hero, { x: 5, y: 3 }, ctx).reason).toBe("The door is closed");
    expect(evaluateMove(hero, { x: 5, y: 3 }, { ...ctx, doors: [{ ...door, state: "locked" }] }).reason).toBe("The door is locked");
    expect(evaluateMove(hero, { x: 5, y: 3 }, { ...ctx, doors: [{ ...door, state: "open" }] }).ok).toBe(true);
  });

  it("computes reachable cells and adjacency", () => {
    const hero = token({ speed: 10 });
    const cells = reachableCells(hero, { floor, tokens: [hero], doors: [], objects: [] });
    expect(cells.length).toBe(25 - 1 - 9); // 5x5 minus centre minus the 9 cells beyond the top/left edge
    expect(isAdjacent(hero, { x: 2, y: 2 })).toBe(true);
    expect(isAdjacent(hero, { x: 3, y: 1 })).toBe(false);
    expect(isAdjacent(hero, { x: 3, y: 1, w: 1, h: 1 }, 2)).toBe(true);
  });
});

describe("interactions", () => {
  const chest = (state: MapObject["state"]): MapObject => ({
    id: "o1",
    floor_id: "f",
    room_id: null,
    kind: "container",
    name: "Chest",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    state,
    hidden: false,
    discovered: true,
    interactions: containerInteractions({ lockDc: 15, keyItemId: "key" }),
    entity_id: null,
    notes: "",
    created_at: "",
    updated_at: "",
  });

  it("gates actions on state and items", () => {
    const locked = chest({ locked: true });
    const open = locked.interactions.find((d) => d.id === "open")!;
    expect(checkPreconditions(open, { object: locked, room: null, actorInventory: [] }).ok).toBe(false);
    const unlock = locked.interactions.find((d) => d.id === "unlock-key")!;
    expect(checkPreconditions(unlock, { object: locked, room: null, actorInventory: [] }).reasons[0]).toMatch(/requires 1×/);
    const inventory = [{ definition_id: "key", quantity: 1 } as never];
    expect(checkPreconditions(unlock, { object: locked, room: null, actorInventory: inventory }).ok).toBe(true);
  });

  it("resolves checks with DM-entered rolls", () => {
    const locked = chest({ locked: true });
    const pick = locked.interactions.find((d) => d.id === "pick-lock")!;
    const ctx = { object: locked, room: null, actorInventory: [] };
    expect(resolveInteraction(pick, ctx, null).outcome).toBe("needs_roll");
    expect(resolveInteraction(pick, ctx, 10, 2).outcome).toBe("failure");
    expect(resolveInteraction(pick, ctx, 13, 2).outcome).toBe("success");
    expect(resolveInteraction(pick, ctx, 20, -10).outcome).toBe("success"); // natural 20
    const unlocked = chest({ locked: false });
    expect(resolveInteraction(pick, { ...ctx, object: unlocked }, 20).outcome).toBe("blocked");
  });
});

describe("dice, calendar, markdown, undo", () => {
  it("parses and rolls dice", () => {
    expect(parseDice("2d6+3")).toMatchObject({ count: 2, sides: 6, modifier: 3 });
    expect(parseDice("d20")).toMatchObject({ count: 1, sides: 20 });
    expect(parseDice("nope")).toBeNull();
    expect(roll("2d6+3", () => 0.999).total).toBe(15);
    expect(averageOf("4d8+4")).toBe(22);
  });

  it("advances fictional dates across months and years", () => {
    const calendar = { months: [{ name: "A", days: 30 }, { name: "B", days: 30 }], weekdays: ["One", "Two"], era: "AR", year: 10, month: 2, day: 29 };
    expect(addDays(calendar, { year: 10, month: 2, day: 29 }, 3)).toEqual({ year: 11, month: 1, day: 2 });
    expect(addDays(calendar, { year: 11, month: 1, day: 2 }, -3)).toEqual({ year: 10, month: 2, day: 29 });
    expect(formatDate(calendar, { year: 10, month: 1, day: 1 })).toMatch(/1st of A, 10 AR/);
  });

  it("extracts and rewrites wiki links", () => {
    expect(extractWikiLinks("See [[Mara]] and [[The Guild|the guild]].")).toEqual([
      { target: "Mara", label: "Mara", raw: "[[Mara]]" },
      { target: "The Guild", label: "the guild", raw: "[[The Guild|the guild]]" },
    ]);
    expect(rewriteWikiLinks("[[Mara]] [[Nobody]]", (n) => (n === "Mara" ? "/e/1" : null))).toBe("[Mara](/e/1) [Nobody](#missing:Nobody)");
  });

  it("undoes and redoes commands", async () => {
    const stack = new UndoStack();
    let value = 0;
    await stack.execute({ label: "inc", do: () => void (value += 1), undo: () => void (value -= 1) });
    await stack.execute({ label: "inc", do: () => void (value += 1), undo: () => void (value -= 1) });
    expect(value).toBe(2);
    await stack.undo();
    expect(value).toBe(1);
    await stack.redo();
    expect(value).toBe(2);
    expect(stack.canRedo).toBe(false);
  });
});

describe("statblock instances", () => {
  it("parses titled actions and dice from a blob", () => {
    const parsed = parseActionBlob("Reed Knife. Melee Weapon Attack: +3 to hit, reach 5 ft. Hit: 4 (1d4+1) slashing.\n\nStaff. Hit: 3 (1d6) bludgeoning.");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.title).toMatch(/Reed Knife/);
    expect(parsed[0]!.toHit).toBe(3);
    expect(parsed[0]!.dice).toContain("1d4+1");
    expect(parsed[1]!.dice).toContain("1d6");
  });

  it("snapshots independently so edits do not alias the template", () => {
    const entity = { fields: { actions: "Bite. 1d6", ac: 12 } } as { fields: Record<string, unknown> };
    const a = snapshotSheet(entity);
    const b = snapshotSheet(entity);
    a.ac = 18;
    expect(b.ac).toBe(12);
    expect(entity.fields.ac).toBe(12);
    const next = writeActionsToSheet(a, [{ title: "Claw", body: "Claw. 1d4", dice: ["1d4"], toHit: null }]);
    expect(String(next.actions)).toMatch(/Claw/);
    expect(entity.fields.actions).toBe("Bite. 1d6");
  });

  it("rates four CR 1/8 cultists against two level-2 PCs as medium", () => {
    const budget = assessEncounter(100, 4, [2, 2]);
    expect(budget.adjustedXp).toBe(200);
    expect(budget.band).toBe("medium");
  });

  it("fills official 5e character-sheet fields on PCs and creatures", () => {
    const pc = normalizeFields("pc", { class: "Fighter", level: 2, weapon1_name: "Longsword", weapon1_atk: "+5", weapon1_damage: "1d8+3 slashing" });
    expect(pc.background).toBe("");
    expect(pc.proficiency_bonus).toBe(2);
    expect(pc.personality_traits).toBe("");
    expect(pc.spellcasting_class).toBe("");
    expect(pc.initiative).toBe(0);
    const creature = normalizeFields("creature", { cr: "1", actions: "Bite. +4 to hit, 1d6+2 piercing" });
    expect(creature.condition_immunities).toBe("");
    expect(creature.bonus_actions).toBe("");
    expect(creature.legendary_resistances).toBe(0);
    const actions = actionsFromSheet(pc);
    expect(actions[0]).toMatchObject({ title: "Longsword", toHit: 5 });
    expect(actions[0]!.dice).toContain("1d8+3");
  });

  it("reads a local SRD-shaped JSON array", () => {
    const creatures = parseSrdCreatures({
      monsters: [{ name: "Goblin", challenge_rating: "1/4", xp: 50, armor_class: 15, hit_points: 7, actions: [{ name: "Scimitar", desc: "+4 to hit, 1d6+2 slashing" }] }],
    });
    expect(creatures).toHaveLength(1);
    expect(creatures[0]!.fields.ac).toBe(15);
    expect(String(creatures[0]!.fields.actions)).toMatch(/Scimitar/);
  });
});
