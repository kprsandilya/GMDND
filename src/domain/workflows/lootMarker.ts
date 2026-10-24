import type { MapMarker } from "../types";
import type { Repositories } from "@/persistence/repositories";

export const ROOM_LOOT_REF = "room-loot";

function lootBody(items: { quantity: number; definition: { name: string } }[]): string {
  if (items.length === 0) return "";
  return items.map((i) => `- ${i.quantity}× ${i.definition.name}`).join("\n");
}

/** Creates, updates, or removes the auto treasure marker for a room's floor inventory. */
export async function syncRoomLootMarker(repos: Repositories, roomId: string | null | undefined): Promise<MapMarker | null> {
  if (!roomId) return null;
  const room = await repos.dungeons.findRoom(roomId);
  if (!room) return null;
  const items = await repos.inventory.listByOwner({ owner_type: "room", owner_id: room.id });
  const markers = await repos.dungeons.markers(room.floor_id);
  const existing = markers.find((m) => m.room_id === room.id && m.kind === "treasure" && m.trigger_ref === ROOM_LOOT_REF) ?? null;
  if (items.length === 0) {
    if (existing) await repos.dungeons.deleteMarker(existing.id);
    return null;
  }
  const title = `Loot — ${room.entity.name}`;
  const body_md = lootBody(items);
  const x = room.x + Math.floor(room.w / 2);
  const y = room.y + Math.floor(room.h / 2);
  if (existing) {
    return repos.dungeons.updateMarker(existing.id, { title, body_md, enabled: true, x: existing.x, y: existing.y });
  }
  return repos.dungeons.createMarker({
    floor_id: room.floor_id,
    room_id: room.id,
    kind: "treasure",
    title,
    body_md,
    x,
    y,
    trigger: "manual",
    trigger_ref: ROOM_LOOT_REF,
    dm_only: false,
    enabled: true,
  });
}

export async function syncLootIfRoom(repos: Repositories, ownerType: string | null | undefined, ownerId: string | null | undefined): Promise<void> {
  if (ownerType === "room" && ownerId) await syncRoomLootMarker(repos, ownerId);
}
