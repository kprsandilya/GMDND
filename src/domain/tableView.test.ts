import { describe, expect, it } from "vitest";
import type { FloorData } from "@/persistence/repositories/dungeons";
import { playerView } from "./tableView";

const base = { created_at: "", updated_at: "" };
const entity = (name: string) => ({ id: name, name, kind: "room", dm_notes_md: "secret plan", secret_md: "the idol is fake", body_md: "b", read_aloud_md: "r" });

const floor: FloorData = {
  floor: { id: "f", dungeon_id: "d", name: "Crypt", level: 1, width: 10, height: 10, cell_feet: 5, walls: [], terrain: [], background_asset: null, sort_order: 0, ...base },
  rooms: [
    { id: "r1", floor_id: "f", number: "1", x: 0, y: 0, w: 4, h: 4, lighting: "dim", terrain: "", state: { explored: true }, color: null, entity: entity("Hall") },
    { id: "r2", floor_id: "f", number: "2", x: 5, y: 0, w: 4, h: 4, lighting: "dark", terrain: "", state: {}, color: null, entity: entity("Vault") },
  ],
  doors: [
    { id: "d1", floor_id: "f", x: 4, y: 1, orientation: "v", kind: "door", state: "closed", lock_dc: null, key_item_id: null, room_a: "r1", room_b: "r2", target_floor_id: null, hidden: false, discovered: false, notes: "", ...base },
    { id: "d2", floor_id: "f", x: 4, y: 2, orientation: "v", kind: "secret", state: "closed", lock_dc: null, key_item_id: null, room_a: "r1", room_b: "r2", target_floor_id: null, hidden: true, discovered: false, notes: "", ...base },
    { id: "d3", floor_id: "f", x: 4, y: 3, orientation: "v", kind: "secret", state: "closed", lock_dc: null, key_item_id: null, room_a: "r1", room_b: "r2", target_floor_id: null, hidden: true, discovered: true, notes: "", ...base },
  ],
  objects: [
    { id: "o1", floor_id: "f", room_id: "r1", kind: "container", name: "Chest", x: 1, y: 1, w: 1, h: 1, rotation: 0, state: {}, hidden: false, discovered: false, interactions: [], entity_id: null, notes: "", ...base },
    { id: "o2", floor_id: "f", room_id: "r1", kind: "trap", name: "Pit", x: 2, y: 2, w: 1, h: 1, rotation: 0, state: {}, hidden: true, discovered: false, interactions: [], entity_id: null, notes: "", ...base },
  ],
  tokens: [
    { id: "t1", floor_id: "f", entity_id: null, name: "Arin", kind: "pc", x: 1, y: 2, size: 1, color: null, hidden: false, hp: 9, max_hp: 12, conditions: [], speed: 30, movement_used: 0, ...base },
    { id: "t2", floor_id: "f", entity_id: null, name: "Ghoul", kind: "creature", x: 2, y: 1, size: 1, color: null, hidden: false, hp: 14, max_hp: 22, conditions: [], speed: 30, movement_used: 0, ...base },
    { id: "t3", floor_id: "f", entity_id: null, name: "Lurker", kind: "creature", x: 6, y: 1, size: 1, color: null, hidden: true, hp: 30, max_hp: 30, conditions: [], speed: 30, movement_used: 0, ...base },
  ],
  markers: [
    { id: "m1", floor_id: "f", room_id: "r1", kind: "treasure", title: "Loot", body_md: "", x: 1, y: 1, w: 1, h: 1, trigger: "manual", trigger_ref: "room-loot", entity_id: null, encounter_id: null, dm_only: false, enabled: true, activated: false, activated_at: null, activation_count: 0, ...base },
    { id: "m2", floor_id: "f", room_id: "r2", kind: "treasure", title: "Loot", body_md: "", x: 6, y: 1, w: 1, h: 1, trigger: "manual", trigger_ref: "room-loot", entity_id: null, encounter_id: null, dm_only: false, enabled: true, activated: false, activated_at: null, activation_count: 0, ...base },
    { id: "m3", floor_id: "f", room_id: "r1", kind: "encounter", title: "Ambush", body_md: "", x: 2, y: 2, w: 1, h: 1, trigger: "enter_room", trigger_ref: null, entity_id: null, encounter_id: null, dm_only: true, enabled: true, activated: false, activated_at: null, activation_count: 0, ...base },
  ],
} as unknown as FloorData;

describe("table view (player-facing)", () => {
  it("removes secrets: undiscovered doors and objects, hidden tokens, DM-only markers and room text", () => {
    const { data } = playerView(floor, { fog: true, light_radius: 2 });
    expect(data.doors.map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(data.objects.map((o) => o.id)).toEqual(["o1"]);
    expect(data.tokens.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(data.markers.map((m) => m.id)).toEqual(["m1"]);
    expect(data.rooms[0]!.entity.secret_md).toBe("");
    expect(data.rooms[0]!.entity.dm_notes_md).toBe("");
  });

  it("shows party HP but hides enemy HP", () => {
    const { data } = playerView(floor, { fog: true, light_radius: 2 });
    expect(data.tokens.find((t) => t.id === "t1")).toMatchObject({ hp: 9, max_hp: 12 });
    expect(data.tokens.find((t) => t.id === "t2")).toMatchObject({ hp: null, max_hp: null });
  });

  it("reveals explored rooms and a light circle around PCs when fog is on", () => {
    const { reveal } = playerView(floor, { fog: true, light_radius: 2 });
    expect(reveal!.rects).toEqual([{ x: -0.1, y: -0.1, w: 4.2, h: 4.2 }]);
    expect(reveal!.circles).toEqual([{ cx: 1.5, cy: 2.5, r: 2.5 }]);
  });

  it("without fog shows every non-secret marker and no mask", () => {
    const view = playerView(floor, { fog: false, light_radius: 2 });
    expect(view.reveal).toBeNull();
    expect(view.data.markers.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
