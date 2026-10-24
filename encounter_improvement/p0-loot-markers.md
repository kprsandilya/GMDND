# P0 — Treasure marker when loot hits the floor

## Problem

`finishEncounter` with `award_treasure` moves hoard items onto the room (`owner_type: "room"`). The room inspector can list them, but the **map does not change**. A gold `$` treasure marker already exists for hand-placed clues; dropped loot never creates one.

The same hole exists if play-mode interactions dump a container onto the room (`transferAll` in `interactionWorkflow`).

## Behavior

Whenever item instances become owned by a **room**:

1. If that room already has an enabled marker with `kind: "treasure"` and `trigger_ref` / notes pointing at “floor loot”, **reuse it** (update title/body with the current item list).
2. Otherwise **create** a `map_markers` row:
   - `kind: "treasure"`
   - `floor_id` / `room_id` from the room
   - `x, y` = room center (or first empty cell)
   - `title`: `Loot` or `Loot — {room name}`
   - `body_md`: bullet list of `quantity × name`
   - `dm_only`: false (party should see a chest/pile once the room is explored; keep `dm_only: true` only if we later add a “hidden stash”)
   - `trigger: "manual"`
3. When the room inventory becomes **empty** (party picked it all up), **disable or delete** that generated marker so the `$` goes away.

Hand-placed treasure markers (no auto body, or `trigger_ref` unset) are left alone.

## Where to hook

Prefer one helper used by every transfer onto a room:

```ts
ensureRoomLootMarker(repos, roomId: string): Promise<void>
```

Call sites:

- `finishEncounter` after hoard → room (`encounterWorkflow.ts`)
- `transfer` / `transferAll` when `to.owner_type === "room"` (`inventory` repo or `interactionWorkflow`)
- Inspector “drop on floor” / `InventoryPanel` transfers onto a room

## Marker identity

Use `trigger_ref = "room-loot"` (or `loot:{roomId}`) so we can find the auto marker without a schema change.

`MapMarker` already has `trigger_ref`. No migration required.

## Map / inspector

- Canvas already paints treasure as gold `$` (`MapCanvas.tsx`).
- Room inspector already shows floor items. Add a one-line “Loot marker on map” when the auto marker exists.
- Clicking the `$` should open the marker / room inventory (already selected as a marker).

## Tests

- Completing an encounter with `award_treasure` creates one treasure marker in the guard post.
- Completing again (or dropping more) updates the same marker, does not stack duplicates.
- Transferring the last item off the room removes or disables the marker.
- A DM-authored treasure marker without `trigger_ref === "room-loot"` is not deleted.
