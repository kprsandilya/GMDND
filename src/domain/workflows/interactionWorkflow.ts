import { roll as rollDice } from "../dice";
import { roomAt } from "../geometry";
import { type InteractionContext, resolveInteraction, type Resolution } from "../interactions";
import { evaluateMove, isAdjacent, type MoveContext, type MoveResult } from "../movement";
import type { Door, DoorState, Effect, MapMarker, MapObject, Room, Token } from "../types";
import type { Repositories } from "@/persistence/repositories";
import type { Owner } from "@/persistence/repositories/inventory";
import { syncRoomLootMarker } from "./lootMarker";

export interface ActionReport {
  ok: boolean;
  outcome: Resolution["outcome"] | "moved" | "blocked" | "done";
  messages: string[];
  triggeredMarkers: MapMarker[];
  needsRoll?: { ability: string; dc: number };
}

/** Inventory owner for a token: the character record when it has one, otherwise the token itself. */
export const tokenOwner = (token: Token): Owner => ({ owner_type: "character", owner_id: token.entity_id ?? token.id });
export const objectOwner = (object: Pick<MapObject, "id">): Owner => ({ owner_type: "object", owner_id: object.id });
export const roomOwner = (room: Pick<Room, "id">): Owner => ({ owner_type: "room", owner_id: room.id });

export interface InteractionRequest {
  campaign_id: string;
  session_id?: string | null;
  object_id: string;
  interaction_id: string;
  actor_token_id: string | null;
  roll?: number | null;
  modifier?: number;
  requireAdjacency?: boolean;
}

/**
 * Executes a data-driven interaction: validates adjacency and preconditions, resolves the check
 * with the DM-entered roll and applies the resulting effects to objects, rooms, doors, inventories
 * and markers. Every persistent consequence is written to the campaign log.
 */
export async function performInteraction(repos: Repositories, request: InteractionRequest): Promise<ActionReport> {
  const object = await repos.dungeons.getObject(request.object_id);
  const def = object.interactions.find((d) => d.id === request.interaction_id);
  if (!def) return { ok: false, outcome: "blocked", messages: ["Unknown interaction"], triggeredMarkers: [] };

  const actor = request.actor_token_id ? await repos.dungeons.getToken(request.actor_token_id) : null;
  if ((request.requireAdjacency ?? true) && actor && !isAdjacent(actor, object))
    return { ok: false, outcome: "blocked", messages: [`${actor.name} must be adjacent to ${object.name}`], triggeredMarkers: [] };

  const room = object.room_id ? await repos.dungeons.findRoom(object.room_id) : null;
  const actorInventory = actor ? await repos.inventory.listByOwner(tokenOwner(actor)) : [];
  const itemIds = (def.preconditions ?? []).flatMap((p) => (p.type === "has_item" ? [p.definition_id] : []));
  const itemNames = Object.fromEntries((await repos.entities.getMany(itemIds)).map((e) => [e.id, e.name]));
  const ctx: InteractionContext = { object, room, actorInventory, itemNames };
  const resolution = resolveInteraction(def, ctx, request.roll, request.modifier ?? 0);

  if (resolution.outcome === "blocked") return { ok: false, outcome: "blocked", messages: [resolution.message], triggeredMarkers: [] };
  if (resolution.outcome === "needs_roll")
    return { ok: false, outcome: "needs_roll", messages: [resolution.message], triggeredMarkers: [], needsRoll: resolution.check ?? undefined };

  const messages = [resolution.message];
  const actorName = actor?.name ?? "The party";
  const effectMessages = await applyEffects(repos, resolution.effects, { campaign_id: request.campaign_id, object, actor, room });
  messages.push(...effectMessages);

  if (def.once && resolution.outcome === "success") {
    const used = (object.state.interactions_used as string[] | undefined) ?? [];
    await repos.dungeons.setObjectState(object.id, { interactions_used: [...used, def.id] });
  }
  if (room) await repos.dungeons.setRoomState(room.id, { explored: true });

  await repos.campaignLog.add(
    request.campaign_id,
    "interaction",
    `${actorName} — ${object.name}: ${resolution.message}${effectMessages.length ? ` ${effectMessages.join(" ")}` : ""}`,
    { object_id: object.id, token_id: actor?.id ?? "", room_id: room?.id ?? "" },
    request.session_id ?? null,
  );

  const triggered = resolution.outcome === "success" ? await fireMarkers(repos, object.floor_id, "interact_object", object.id, request.campaign_id, request.session_id ?? null) : [];
  return { ok: true, outcome: resolution.outcome, messages, triggeredMarkers: triggered };
}

interface EffectScope {
  campaign_id: string;
  object: MapObject;
  actor: Token | null;
  room: Room | null;
}

export async function applyEffects(repos: Repositories, effects: Effect[], scope: EffectScope): Promise<string[]> {
  const messages: string[] = [];
  let object = scope.object;
  for (const effect of effects) {
    switch (effect.type) {
      case "set_state":
        object = await repos.dungeons.setObjectState(object.id, { [effect.key]: effect.value });
        break;
      case "set_room_state":
        if (scope.room) await repos.dungeons.setRoomState(scope.room.id, { [effect.key]: effect.value });
        break;
      case "transfer_items": {
        const from = effect.from === "object" ? objectOwner(object) : scope.actor ? tokenOwner(scope.actor) : null;
        const to = effect.to === "object" ? objectOwner(object) : scope.actor ? tokenOwner(scope.actor) : null;
        if (!from || !to) {
          messages.push("No character selected to receive items.");
          break;
        }
        if (effect.all) {
          const moved = await repos.inventory.transferAll(from, to, `looted ${object.name}`);
          if (moved.length === 0) messages.push("It is empty.");
          else {
            const names = await repos.entities.getMany(moved.map((m) => m.definition_id));
            const byId = new Map(names.map((n) => [n.id, n.name]));
            messages.push(`Took ${moved.map((m) => `${m.quantity}× ${byId.get(m.definition_id) ?? "item"}`).join(", ")}.`);
          }
        } else if (effect.definition_id) {
          const stacks = (await repos.inventory.listByOwner(from)).filter((s) => s.definition_id === effect.definition_id);
          let remaining = effect.quantity ?? 1;
          for (const stack of stacks) {
            if (remaining <= 0) break;
            const take = Math.min(stack.quantity, remaining);
            await repos.inventory.transfer({ instance_id: stack.id, quantity: take, to, note: `from ${object.name}` });
            remaining -= take;
            messages.push(`Took ${take}× ${stack.definition.name}.`);
          }
        }
        break;
      }
      case "consume_item":
        if (scope.actor) {
          const consumed = await repos.inventory.consume(tokenOwner(scope.actor), effect.definition_id, effect.quantity ?? 1, `used at ${object.name}`);
          if (consumed) messages.push("An item was used up.");
        }
        break;
      case "reveal_object": {
        const targetId = effect.object_id ?? object.id;
        await repos.dungeons.updateObject(targetId, { hidden: false, discovered: true });
        if (targetId !== object.id) {
          const revealed = await repos.dungeons.getObject(targetId);
          messages.push(`${revealed.name} is revealed.`);
        }
        break;
      }
      case "reveal_door":
        await repos.dungeons.updateDoor(effect.door_id, { hidden: false, discovered: true });
        messages.push("A hidden door is revealed.");
        break;
      case "set_door_state":
        await repos.dungeons.updateDoor(effect.door_id, { state: effect.state });
        messages.push(`A door is now ${effect.state}.`);
        break;
      case "activate_marker": {
        const marker = await repos.dungeons.activateMarker(effect.marker_id);
        messages.push(`Event triggered: ${marker.title}.`);
        break;
      }
      case "damage_actor":
        if (scope.actor) {
          const result = rollDice(effect.amount);
          const hp = scope.actor.hp === null ? null : Math.max(0, scope.actor.hp - result.total);
          if (hp !== null) await repos.dungeons.updateToken(scope.actor.id, { hp });
          messages.push(`${scope.actor.name} takes ${result.total} damage (${effect.amount}${effect.note ? `, ${effect.note}` : ""}).`);
        }
        break;
      case "log":
        messages.push(effect.message);
        break;
    }
  }
  return messages;
}

/** Activates every enabled, not-yet-activated marker with a matching automatic trigger. */
export async function fireMarkers(
  repos: Repositories,
  floorId: string,
  trigger: MapMarker["trigger"],
  ref: string | null,
  campaignId: string,
  sessionId: string | null,
): Promise<MapMarker[]> {
  const candidates = await repos.dungeons.markersByTrigger(floorId, trigger, ref);
  const fired: MapMarker[] = [];
  for (const marker of candidates) {
    if (marker.activated) continue;
    fired.push(await repos.dungeons.activateMarker(marker.id));
    await repos.campaignLog.add(campaignId, "marker", `Triggered: ${marker.title} (${trigger.replace("_", " ")})`, { marker_id: marker.id }, sessionId);
  }
  return fired;
}

// ---- doors ----

export type DoorActionKind = "open" | "close" | "lock" | "unlock" | "pick_lock" | "force" | "break" | "discover";

export interface DoorActionRequest {
  campaign_id: string;
  session_id?: string | null;
  door_id: string;
  action: DoorActionKind;
  actor_token_id: string | null;
  roll?: number | null;
  modifier?: number;
}

export async function performDoorAction(repos: Repositories, request: DoorActionRequest): Promise<ActionReport> {
  const door = await repos.dungeons.getDoor(request.door_id);
  const actor = request.actor_token_id ? await repos.dungeons.getToken(request.actor_token_id) : null;
  const name = actor?.name ?? "The party";
  const finish = async (state: DoorState | null, message: string, extra: Partial<Door> = {}): Promise<ActionReport> => {
    await repos.dungeons.updateDoor(door.id, { ...(state ? { state } : {}), ...extra });
    await repos.campaignLog.add(request.campaign_id, "door", `${name}: ${message}`, { door_id: door.id }, request.session_id ?? null);
    const triggered = state === "open" ? await fireMarkers(repos, door.floor_id, "open_door", door.id, request.campaign_id, request.session_id ?? null) : [];
    return { ok: true, outcome: "done", messages: [message], triggeredMarkers: triggered };
  };
  const blocked = (message: string): ActionReport => ({ ok: false, outcome: "blocked", messages: [message], triggeredMarkers: [] });

  if (actor && !isAdjacent(actor, { x: door.x - (door.orientation === "v" ? 1 : 0), y: door.y - (door.orientation === "h" ? 1 : 0), w: door.orientation === "v" ? 2 : 1, h: door.orientation === "h" ? 2 : 1 }))
    return blocked(`${actor.name} must be next to the door`);

  switch (request.action) {
    case "open":
      if (door.state === "locked") return blocked("The door is locked.");
      if (door.state === "barred") return blocked("The door is barred from the other side.");
      return finish("open", "opens the door.");
    case "close":
      if (door.state === "broken") return blocked("The door is broken and cannot be closed.");
      return finish("closed", "closes the door.");
    case "lock":
      if (door.state === "open") return blocked("Close the door first.");
      return finish("locked", "locks the door.");
    case "unlock": {
      if (door.state !== "locked") return blocked("The door is not locked.");
      if (door.key_item_id && actor) {
        const has = await repos.inventory.totalQuantity(tokenOwner(actor), door.key_item_id);
        if (has <= 0) {
          const key = await repos.entities.find(door.key_item_id);
          return blocked(`${actor.name} does not have ${key?.name ?? "the key"}.`);
        }
      }
      return finish("closed", "unlocks the door.");
    }
    case "pick_lock": {
      if (door.state !== "locked") return blocked("The door is not locked.");
      const dc = door.lock_dc ?? 15;
      if (request.roll === null || request.roll === undefined)
        return { ok: false, outcome: "needs_roll", messages: [`Dexterity (Thieves' Tools) check, DC ${dc}`], triggeredMarkers: [], needsRoll: { ability: "Dexterity (Thieves' Tools)", dc } };
      const total = request.roll + (request.modifier ?? 0);
      if (total >= dc) return finish("closed", `picks the lock (${total} vs DC ${dc}).`);
      await repos.campaignLog.add(request.campaign_id, "door", `${name} fails to pick the lock (${total} vs DC ${dc}).`, { door_id: door.id }, request.session_id ?? null);
      return { ok: true, outcome: "failure", messages: [`The lock holds (${total} vs DC ${dc}).`], triggeredMarkers: [] };
    }
    case "force": {
      if (door.state === "open" || door.state === "broken") return blocked("The door is already open.");
      const dc = (door.lock_dc ?? 13) + 2;
      if (request.roll === null || request.roll === undefined)
        return { ok: false, outcome: "needs_roll", messages: [`Strength (Athletics) check, DC ${dc}`], triggeredMarkers: [], needsRoll: { ability: "Strength (Athletics)", dc } };
      const total = request.roll + (request.modifier ?? 0);
      if (total >= dc) return finish("broken", `forces the door open (${total} vs DC ${dc}).`);
      return { ok: true, outcome: "failure", messages: [`The door holds (${total} vs DC ${dc}).`], triggeredMarkers: [] };
    }
    case "break":
      return finish("broken", "breaks the door down.");
    case "discover":
      return finish(null, "discovers a hidden door.", { hidden: false, discovered: true });
  }
}

// ---- movement ----

export interface MoveRequest {
  campaign_id: string;
  session_id?: string | null;
  token_id: string;
  to: { x: number; y: number };
  rules?: MoveContext["rules"];
  /** Skip rule checks entirely (DM override). */
  force?: boolean;
}

export interface MoveReport extends ActionReport {
  move: MoveResult;
  enteredRoom: Room | null;
}

export async function moveToken(repos: Repositories, request: MoveRequest): Promise<MoveReport> {
  const token = await repos.dungeons.getToken(request.token_id);
  const data = await repos.dungeons.loadFloor(token.floor_id);
  const move = evaluateMove(token, request.to, { floor: data.floor, rooms: data.rooms, tokens: data.tokens, doors: data.doors, objects: data.objects, rules: request.rules });
  if (!move.ok && !request.force) return { ok: false, outcome: "blocked", messages: [move.reason ?? "Cannot move there"], triggeredMarkers: [], move, enteredRoom: null };

  const fromRoom = roomAt(data.rooms, token.x, token.y) ?? null;
  const toRoom = roomAt(data.rooms, request.to.x, request.to.y) ?? null;
  await repos.dungeons.moveToken(token.id, request.to.x, request.to.y, request.force ? token.movement_used : move.movementUsedAfter);

  const triggered: MapMarker[] = [];
  const messages = [`${token.name} moves to (${request.to.x}, ${request.to.y})${move.distanceFeet ? ` — ${move.distanceFeet} ft` : ""}.`];
  if (toRoom && toRoom.id !== fromRoom?.id) {
    if (!toRoom.state.explored) await repos.dungeons.setRoomState(toRoom.id, { explored: true, discovered: true });
    messages.push(`Enters ${toRoom.number ? `${toRoom.number}. ` : ""}${toRoom.entity.name}.`);
    triggered.push(...(await fireMarkers(repos, token.floor_id, "enter_room", toRoom.id, request.campaign_id, request.session_id ?? null)));
    await repos.campaignLog.add(request.campaign_id, "movement", `${token.name} enters ${toRoom.entity.name}.`, { token_id: token.id, room_id: toRoom.id }, request.session_id ?? null);
  }
  // area markers: any enabled "enter_area" marker whose footprint contains the destination
  const areaMarkers = data.markers.filter(
    (m) => m.enabled && !m.activated && m.trigger === "enter_area" && request.to.x >= Math.floor(m.x) && request.to.x < Math.floor(m.x) + Math.max(1, Math.round(m.w)) && request.to.y >= Math.floor(m.y) && request.to.y < Math.floor(m.y) + Math.max(1, Math.round(m.h)),
  );
  for (const marker of areaMarkers) {
    triggered.push(await repos.dungeons.activateMarker(marker.id));
    await repos.campaignLog.add(request.campaign_id, "marker", `Triggered: ${marker.title} (area)`, { marker_id: marker.id }, request.session_id ?? null);
  }
  // step on an undetected, armed trap object
  const trap = data.objects.find(
    (o) => (o.kind === "trap" || o.kind === "hazard") && !o.state.disarmed && !o.state.triggered && Math.floor(o.x) === request.to.x && Math.floor(o.y) === request.to.y,
  );
  if (trap) {
    const def = trap.interactions.find((d) => d.id === "trigger");
    if (def) {
      const effectMessages = await applyEffects(repos, def.success, { campaign_id: request.campaign_id, object: trap, actor: { ...token, x: request.to.x, y: request.to.y }, room: toRoom });
      messages.push(`${token.name} triggers ${trap.name}!`, ...effectMessages);
      await repos.campaignLog.add(request.campaign_id, "trap", `${token.name} triggers ${trap.name}. ${effectMessages.join(" ")}`, { object_id: trap.id, token_id: token.id }, request.session_id ?? null);
      triggered.push(...(await fireMarkers(repos, token.floor_id, "step_trap", trap.id, request.campaign_id, request.session_id ?? null)));
    }
  }
  return { ok: true, outcome: "moved", messages, triggeredMarkers: triggered, move, enteredRoom: toRoom && toRoom.id !== fromRoom?.id ? toRoom : null };
}

/** Gives, drops, equips or uses an item held by a token. */
export async function tokenItemAction(
  repos: Repositories,
  options: { campaign_id: string; session_id?: string | null; token_id: string; instance_id: string; action: "drop" | "equip" | "unequip" | "use" | "give"; target_token_id?: string; quantity?: number },
): Promise<ActionReport> {
  const token = await repos.dungeons.getToken(options.token_id);
  const instance = await repos.inventory.getWithDefinition(options.instance_id);
  const log = async (message: string) => repos.campaignLog.add(options.campaign_id, "inventory", `${token.name} ${message}`, { token_id: token.id, item_id: instance.definition_id }, options.session_id ?? null);
  switch (options.action) {
    case "drop": {
      const data = await repos.dungeons.loadFloor(token.floor_id);
      const room = roomAt(data.rooms, token.x, token.y);
      const to: Owner = room ? roomOwner(room) : { owner_type: "unassigned", owner_id: data.floor.id };
      await repos.inventory.transfer({ instance_id: instance.id, quantity: options.quantity, to, note: "dropped" });
      if (room) await syncRoomLootMarker(repos, room.id);
      await log(`drops ${options.quantity ?? instance.quantity}× ${instance.definition.name}${room ? ` in ${room.entity.name}` : ""}.`);
      return { ok: true, outcome: "done", messages: [`Dropped ${instance.definition.name}.`], triggeredMarkers: [] };
    }
    case "equip":
      await repos.inventory.updateState(instance.id, { equipped: true });
      await log(`equips ${instance.definition.name}.`);
      return { ok: true, outcome: "done", messages: [`Equipped ${instance.definition.name}.`], triggeredMarkers: [] };
    case "unequip":
      await repos.inventory.updateState(instance.id, { equipped: false });
      return { ok: true, outcome: "done", messages: [`Unequipped ${instance.definition.name}.`], triggeredMarkers: [] };
    case "use": {
      const fields = instance.definition.fields as { category?: string; charges_max?: number };
      const consumable = fields.category === "potion" || fields.category === "consumable" || fields.category === "scroll";
      if (consumable) {
        await repos.inventory.consume(tokenOwner(token), instance.definition_id, 1, `used ${instance.definition.name}`);
        await log(`uses ${instance.definition.name}.`);
        return { ok: true, outcome: "done", messages: [`Used ${instance.definition.name}.`], triggeredMarkers: [] };
      }
      if (fields.charges_max && fields.charges_max > 0) {
        const charges = Number(instance.state.charges ?? fields.charges_max);
        if (charges <= 0) return { ok: false, outcome: "blocked", messages: ["No charges left."], triggeredMarkers: [] };
        await repos.inventory.updateState(instance.id, { charges: charges - 1 });
        await log(`uses a charge of ${instance.definition.name} (${charges - 1} left).`);
        return { ok: true, outcome: "done", messages: [`${charges - 1} charges left.`], triggeredMarkers: [] };
      }
      await log(`uses ${instance.definition.name}.`);
      return { ok: true, outcome: "done", messages: [`Used ${instance.definition.name}.`], triggeredMarkers: [] };
    }
    case "give": {
      if (!options.target_token_id) return { ok: false, outcome: "blocked", messages: ["Choose a recipient."], triggeredMarkers: [] };
      const target = await repos.dungeons.getToken(options.target_token_id);
      await repos.inventory.transfer({ instance_id: instance.id, quantity: options.quantity, to: tokenOwner(target), note: `given by ${token.name}` });
      await log(`gives ${options.quantity ?? instance.quantity}× ${instance.definition.name} to ${target.name}.`);
      return { ok: true, outcome: "done", messages: [`Gave ${instance.definition.name} to ${target.name}.`], triggeredMarkers: [] };
    }
  }
}

/** Picks up items lying in the room the token stands in. */
export async function pickUpFromRoom(repos: Repositories, options: { campaign_id: string; session_id?: string | null; token_id: string; instance_id: string; quantity?: number }): Promise<ActionReport> {
  const token = await repos.dungeons.getToken(options.token_id);
  const instance = await repos.inventory.getWithDefinition(options.instance_id);
  const fromRoom = instance.owner_type === "room" ? instance.owner_id : null;
  await repos.inventory.transfer({ instance_id: instance.id, quantity: options.quantity, to: tokenOwner(token), note: "picked up" });
  if (fromRoom) await syncRoomLootMarker(repos, fromRoom);
  await repos.campaignLog.add(options.campaign_id, "inventory", `${token.name} picks up ${options.quantity ?? instance.quantity}× ${instance.definition.name}.`, { token_id: token.id }, options.session_id ?? null);
  return { ok: true, outcome: "done", messages: [`Picked up ${instance.definition.name}.`], triggeredMarkers: [] };
}
