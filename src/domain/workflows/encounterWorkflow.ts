import type { Repositories } from "@/persistence/repositories";
import type { Combatant, EncounterOutcomes, EncounterRun, Entity } from "../types";
import { fireMarkers, objectOwner } from "./interactionWorkflow";

export interface ActivateOptions {
  campaign_id: string;
  encounter_id: string;
  room_id?: string | null;
  floor_id?: string | null;
  session_id?: string | null;
  includeParty?: boolean;
  /** Place tokens for template creatures into the room if they are not on the map yet. */
  placeTokens?: boolean;
}

/**
 * Creates an execution instance of an encounter from a room (or anywhere). The template entity
 * and its participants are never modified. Creature tokens are placed in the room on request so
 * the combat tracker and the map stay in sync.
 */
export async function activateEncounter(repos: Repositories, options: ActivateOptions): Promise<{ run: EncounterRun; combatants: Combatant[] }> {
  const party = options.includeParty === false ? [] : await repos.entities.list({ campaign_id: options.campaign_id, kinds: ["pc"] });
  const session = options.session_id ? await repos.entities.find(options.session_id) : null;
  const sessionId = session?.kind === "session" ? session.id : null;
  let tokens: { id: string; entity_id: string | null; name: string; hp: number | null; max_hp: number | null }[] = [];
  if (options.floor_id) {
    tokens = await repos.dungeons.tokens(options.floor_id);
    if (options.placeTokens && options.room_id) {
      const room = await repos.dungeons.getRoom(options.room_id);
      const participants = await repos.encounters.participants(options.encounter_id);
      const definitions = await repos.entities.getMany(participants.map((p) => p.entity_id).filter((x): x is string => !!x));
      const byId = new Map(definitions.map((d) => [d.id, d]));
      const occupied = new Set(tokens.map((t) => `${(t as { x?: number }).x},${(t as { y?: number }).y}`));
      const floorTokens = await repos.dungeons.tokens(options.floor_id);
      for (const t of floorTokens) occupied.add(`${t.x},${t.y}`);
      let cursor = 0;
      for (const participant of participants) {
        if (!participant.entity_id || participant.side === "party") continue;
        const definition = byId.get(participant.entity_id);
        const existing = floorTokens.filter((t) => t.entity_id === participant.entity_id).length;
        const toPlace = Math.max(0, participant.count - existing);
        for (let i = 0; i < toPlace; i++) {
          let cell: { x: number; y: number } | null = null;
          for (let guard = 0; guard < room.w * room.h && !cell; guard++) {
            const x = room.x + (cursor % room.w);
            const y = room.y + Math.floor(cursor / room.w);
            cursor++;
            if (!occupied.has(`${x},${y}`)) cell = { x, y };
          }
          if (!cell) break;
          occupied.add(`${cell.x},${cell.y}`);
          const fields = (definition?.fields ?? {}) as Record<string, unknown>;
          const hp = Number(fields.hp ?? 10) || 10;
          const baseName = participant.label ?? definition?.name ?? "Creature";
          const token = await repos.dungeons.createToken({
            floor_id: options.floor_id,
            entity_id: participant.entity_id,
            name: participant.count > 1 ? `${baseName} ${existing + i + 1}` : baseName,
            kind: definition?.kind === "npc" ? "npc" : "creature",
            x: cell.x,
            y: cell.y,
            hp,
            max_hp: hp,
            speed: parseInt(String(fields.speed ?? "30"), 10) || 30,
            color: participant.side === "ally" ? "#4f9d69" : "#b5483f",
          });
          tokens.push(token);
        }
      }
      tokens = await repos.dungeons.tokens(options.floor_id);
    }
  }
  const result = await repos.encounters.startRun({
    campaign_id: options.campaign_id,
    encounter_id: options.encounter_id,
    room_id: options.room_id ?? null,
    floor_id: options.floor_id ?? null,
    session_id: sessionId,
    party,
    tokens,
  });
  const template = await repos.entities.get(options.encounter_id);
  await repos.campaignLog.add(options.campaign_id, "encounter", `Encounter prepared: ${template.name}`, { run_id: result.run.id, encounter_id: template.id, room_id: options.room_id ?? "" }, sessionId);
  return result;
}

/** Keeps the token's HP in step with the combatant while the tracker runs. */
export async function syncCombatantToToken(repos: Repositories, combatant: Combatant): Promise<void> {
  if (!combatant.token_id) return;
  const token = await repos.dungeons.findToken(combatant.token_id);
  if (!token) return;
  await repos.dungeons.updateToken(token.id, { hp: combatant.hp, max_hp: combatant.max_hp, conditions: combatant.conditions.map((c) => c.name) });
}

export interface OutcomeReport {
  run: EncounterRun;
  applied: string[];
}

/**
 * Finishes a run and persists only the consequences the DM selected. The template encounter is
 * left untouched; the run keeps its log, so the session recap can cite it later.
 */
export async function finishEncounter(repos: Repositories, runId: string, status: "completed" | "aborted", outcomes: EncounterOutcomes): Promise<OutcomeReport> {
  const run = await repos.encounters.getRun(runId);
  const combatants = await repos.encounters.combatants(runId);
  const applied: string[] = [];
  const log = (message: string, refs: Record<string, string> = {}) => repos.campaignLog.add(run.campaign_id, "encounter", message, { run_id: run.id, ...refs }, run.session_id);

  if (status === "completed") {
    const defeated = combatants.filter((c) => c.defeated && c.side !== "party");
    if (outcomes.mark_defeated) {
      for (const c of defeated) {
        if (c.token_id) {
          if (outcomes.remove_defeated_tokens) await repos.dungeons.deleteToken(c.token_id);
          else await repos.dungeons.updateToken(c.token_id, { hp: 0, conditions: ["dead"] });
        }
        if (c.entity_id) {
          const entity = await repos.entities.find(c.entity_id);
          if (entity && (entity.kind === "npc" || entity.kind === "pc")) {
            await repos.entities.update(entity.id, { status: "dead", fields: { ...entity.fields, hp: 0 } });
          }
        }
        applied.push(`${c.name} defeated`);
      }
      if (defeated.length) await log(`Defeated: ${defeated.map((c) => c.name).join(", ")}.`);
      if (run.floor_id) for (const c of defeated) await fireMarkers(repos, run.floor_id, "defeat_creature", c.entity_id ?? c.id, run.campaign_id, run.session_id);
    }
    if (outcomes.room_cleared && run.room_id) {
      await repos.dungeons.setRoomState(run.room_id, { cleared: true, explored: true });
      const room = await repos.dungeons.getRoom(run.room_id);
      applied.push(`${room.entity.name} cleared`);
      await log(`${room.entity.name} is cleared.`, { room_id: run.room_id });
    }
    // party HP persists onto the character records and their tokens
    for (const c of combatants.filter((x) => x.side === "party" && x.entity_id)) {
      const entity = await repos.entities.find(c.entity_id!);
      if (entity) await repos.entities.update(entity.id, { fields: { ...entity.fields, hp: c.hp } });
      if (c.token_id) await repos.dungeons.updateToken(c.token_id, { hp: c.hp, conditions: c.conditions.map((x) => x.name) }).catch(() => undefined);
    }
    if (outcomes.award_treasure && run.encounter_id) {
      // treasure held by the encounter template (owner_type 'hoard') is moved to the room floor
      const hoard = await repos.inventory.listByOwner({ owner_type: "hoard", owner_id: run.encounter_id });
      if (hoard.length && run.room_id) {
        for (const item of hoard) await repos.inventory.transfer({ instance_id: item.id, to: { owner_type: "room", owner_id: run.room_id }, note: "encounter treasure" });
        applied.push(`${hoard.length} treasure item(s) dropped in the room`);
        await log(`Treasure left in the room: ${hoard.map((h) => `${h.quantity}× ${h.definition.name}`).join(", ")}.`, { room_id: run.room_id });
      }
    }
    for (const update of outcomes.quest_updates ?? []) {
      await repos.quests.updateObjective(update.objective_id, { status: update.status as "open" | "done" | "failed" });
      applied.push(`objective ${update.status}`);
    }
    if (outcomes.notes) await log(outcomes.notes);
  } else {
    await log(`Encounter aborted: ${run.name}.`);
  }
  const finished = await repos.encounters.finish(runId, status, outcomes);
  return { run: finished, applied };
}

/** Marks a creature or NPC entity as encountered/defeated across the campaign (used by dashboards). */
export async function defeatedCreatures(repos: Repositories, campaignId: string): Promise<{ entity: Entity; count: number }[]> {
  const runs = await repos.encounters.runs(campaignId, ["completed"]);
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.outcomes.mark_defeated) continue;
    const combatants = await repos.encounters.combatants(run.id);
    for (const c of combatants) if (c.defeated && c.entity_id && c.side !== "party") counts.set(c.entity_id, (counts.get(c.entity_id) ?? 0) + 1);
  }
  const entities = await repos.entities.getMany([...counts.keys()]);
  return entities.map((entity) => ({ entity, count: counts.get(entity.id) ?? 0 }));
}

export { objectOwner };
