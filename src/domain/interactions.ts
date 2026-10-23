import type { Effect, InteractionDefinition, ItemInstanceWithDefinition, MapObject, Precondition, Room, SkillCheck } from "./types";

/**
 * Data-driven object interactions. Definitions live on map objects as JSON; this module evaluates
 * preconditions and decides the outcome. Applying effects to the database is the job of
 * `workflows/interactionWorkflow.ts`, so this file stays pure and testable.
 */

export interface InteractionContext {
  object: MapObject;
  room: Room | null;
  actorInventory: ItemInstanceWithDefinition[];
  itemNames?: Record<string, string>;
}

export interface PreconditionResult {
  ok: boolean;
  reasons: string[];
}

export function describePrecondition(p: Precondition, ctx: InteractionContext): string {
  switch (p.type) {
    case "state":
      return `${p.key} must be ${String(p.equals)}`;
    case "not_state":
      return `${p.key} must not be ${String(p.equals)}`;
    case "has_item":
      return `requires ${p.quantity ?? 1}× ${ctx.itemNames?.[p.definition_id] ?? "a specific item"}`;
    case "discovered":
      return "must be discovered first";
  }
}

export function checkPreconditions(def: InteractionDefinition, ctx: InteractionContext): PreconditionResult {
  const reasons: string[] = [];
  const state = ctx.object.state;
  const used = (state.interactions_used as string[] | undefined) ?? [];
  if (def.once && used.includes(def.id)) reasons.push("already done");
  for (const p of def.preconditions ?? []) {
    switch (p.type) {
      case "state":
        if ((state[p.key] ?? false) !== p.equals) reasons.push(describePrecondition(p, ctx));
        break;
      case "not_state":
        if ((state[p.key] ?? false) === p.equals) reasons.push(describePrecondition(p, ctx));
        break;
      case "has_item": {
        const have = ctx.actorInventory.filter((i) => i.definition_id === p.definition_id).reduce((sum, i) => sum + i.quantity, 0);
        if (have < (p.quantity ?? 1)) reasons.push(describePrecondition(p, ctx));
        break;
      }
      case "discovered":
        if (!ctx.object.discovered) reasons.push(describePrecondition(p, ctx));
        break;
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export type Outcome = "success" | "failure" | "blocked" | "needs_roll";

export interface Resolution {
  outcome: Outcome;
  effects: Effect[];
  message: string;
  check?: SkillCheck | null;
  total?: number;
}

/**
 * Resolves an interaction. `roll` is the d20 result entered by the DM (modifier applied by the
 * caller or passed separately). When the definition has a check and no roll was given, the caller
 * must ask for one.
 */
export function resolveInteraction(
  def: InteractionDefinition,
  ctx: InteractionContext,
  roll: number | null | undefined,
  modifier = 0,
): Resolution {
  const pre = checkPreconditions(def, ctx);
  if (!pre.ok) return { outcome: "blocked", effects: [], message: `${def.label}: ${pre.reasons.join("; ")}` };
  if (def.check) {
    if (roll === null || roll === undefined) return { outcome: "needs_roll", effects: [], message: `${def.label} requires a ${def.check.ability} check (DC ${def.check.dc})`, check: def.check };
    const total = roll + modifier;
    if (total >= def.check.dc || roll === 20) {
      return { outcome: "success", effects: def.success, message: `${def.label}: success (${total} vs DC ${def.check.dc})`, check: def.check, total };
    }
    return { outcome: "failure", effects: def.failure ?? [], message: `${def.label}: failure (${total} vs DC ${def.check.dc})`, check: def.check, total };
  }
  return { outcome: "success", effects: def.success, message: `${def.label}: done` };
}

/** Which interactions are currently offered (and why some are disabled) for the context menu. */
export function availableInteractions(ctx: InteractionContext): { def: InteractionDefinition; enabled: boolean; reasons: string[] }[] {
  return ctx.object.interactions.map((def) => {
    const pre = checkPreconditions(def, ctx);
    return { def, enabled: pre.ok, reasons: pre.reasons };
  });
}

// ---- templates: sensible defaults the DM can tweak in the editor ----

const id = (suffix: string) => `${suffix}`;

export function containerInteractions(options: { lockDc?: number | null; keyItemId?: string | null; trapped?: boolean } = {}): InteractionDefinition[] {
  const defs: InteractionDefinition[] = [];
  if (options.keyItemId) {
    defs.push({
      id: id("unlock-key"),
      label: "Unlock with key",
      preconditions: [{ type: "state", key: "locked", equals: true }, { type: "has_item", definition_id: options.keyItemId }],
      success: [{ type: "set_state", key: "locked", value: false }, { type: "log", message: "The key turns and the lock clicks open." }],
    });
  }
  if (options.lockDc) {
    defs.push({
      id: id("pick-lock"),
      label: "Pick the lock",
      preconditions: [{ type: "state", key: "locked", equals: true }],
      check: { ability: "Dexterity (Thieves' Tools)", dc: options.lockDc },
      success: [{ type: "set_state", key: "locked", value: false }, { type: "log", message: "The lock yields to the picks." }],
      failure: [{ type: "log", message: "The picks slip; the lock holds." }],
    });
  }
  defs.push(
    {
      id: id("open"),
      label: "Open",
      preconditions: [{ type: "not_state", key: "locked", equals: true }, { type: "not_state", key: "open", equals: true }],
      success: [{ type: "set_state", key: "open", value: true }, { type: "set_state", key: "searched", value: true }],
    },
    {
      id: id("close"),
      label: "Close",
      preconditions: [{ type: "state", key: "open", equals: true }],
      success: [{ type: "set_state", key: "open", value: false }],
    },
    {
      id: id("loot"),
      label: "Take everything",
      preconditions: [{ type: "state", key: "open", equals: true }],
      success: [{ type: "transfer_items", from: "object", to: "actor", all: true }],
    },
    {
      id: id("force"),
      label: "Force open",
      preconditions: [{ type: "state", key: "locked", equals: true }],
      check: { ability: "Strength (Athletics)", dc: Math.max(10, (options.lockDc ?? 10) + 2) },
      success: [{ type: "set_state", key: "locked", value: false }, { type: "set_state", key: "broken", value: true }, { type: "set_state", key: "open", value: true }],
      failure: [{ type: "log", message: "The lid will not budge." }],
    },
  );
  return defs;
}

export function trapInteractions(options: { detectDc?: number; disarmDc?: number; damage?: string; saveText?: string } = {}): InteractionDefinition[] {
  return [
    {
      id: id("detect"),
      label: "Search for traps",
      preconditions: [{ type: "not_state", key: "detected", equals: true }],
      check: { ability: "Wisdom (Perception)", dc: options.detectDc ?? 12 },
      success: [{ type: "set_state", key: "detected", value: true }, { type: "reveal_object" }, { type: "log", message: "The trap mechanism is spotted." }],
      failure: [{ type: "log", message: "Nothing unusual is noticed." }],
    },
    {
      id: id("disarm"),
      label: "Disarm",
      preconditions: [{ type: "state", key: "detected", equals: true }, { type: "not_state", key: "disarmed", equals: true }],
      check: { ability: "Dexterity (Thieves' Tools)", dc: options.disarmDc ?? 12 },
      success: [{ type: "set_state", key: "disarmed", value: true }, { type: "set_room_state", key: "trapped", value: false }],
      failure: [{ type: "set_state", key: "triggered", value: true }, { type: "damage_actor", amount: options.damage ?? "1d6", note: "trap goes off while disarming" }],
    },
    {
      id: id("trigger"),
      label: "Trigger",
      preconditions: [{ type: "not_state", key: "disarmed", equals: true }],
      success: [
        { type: "set_state", key: "triggered", value: true },
        { type: "set_state", key: "detected", value: true },
        { type: "reveal_object" },
        { type: "damage_actor", amount: options.damage ?? "1d6", note: options.saveText ?? "trap" },
      ],
    },
    {
      id: id("reset"),
      label: "Reset trap (DM)",
      preconditions: [{ type: "state", key: "triggered", equals: true }],
      success: [{ type: "set_state", key: "triggered", value: false }],
    },
  ];
}

export function investigateInteractions(options: { dc?: number; revealObjectId?: string; revealDoorId?: string; message?: string } = {}): InteractionDefinition[] {
  const success: Effect[] = [{ type: "set_state", key: "investigated", value: true }];
  if (options.revealObjectId) success.push({ type: "reveal_object", object_id: options.revealObjectId });
  if (options.revealDoorId) success.push({ type: "reveal_door", door_id: options.revealDoorId });
  success.push({ type: "log", message: options.message ?? "Something of interest is found." });
  return [
    {
      id: id("investigate"),
      label: "Investigate",
      check: { ability: "Intelligence (Investigation)", dc: options.dc ?? 12 },
      success,
      failure: [{ type: "log", message: "Nothing out of the ordinary." }],
    },
  ];
}

export function mechanismInteractions(options: { doorId?: string; doorState?: "open" | "closed" | "locked"; revealObjectId?: string; message?: string } = {}): InteractionDefinition[] {
  const success: Effect[] = [{ type: "set_state", key: "activated", value: true }];
  if (options.doorId) success.push({ type: "set_door_state", door_id: options.doorId, state: options.doorState ?? "open" });
  if (options.revealObjectId) success.push({ type: "reveal_object", object_id: options.revealObjectId });
  success.push({ type: "log", message: options.message ?? "Something shifts with a grinding of stone." });
  return [
    { id: id("activate"), label: "Activate", preconditions: [{ type: "not_state", key: "activated", equals: true }], success },
    {
      id: id("deactivate"),
      label: "Deactivate",
      preconditions: [{ type: "state", key: "activated", equals: true }],
      success: [{ type: "set_state", key: "activated", value: false }],
    },
  ];
}

export function documentInteractions(message = "The text is legible."): InteractionDefinition[] {
  return [{ id: id("read"), label: "Read", success: [{ type: "set_state", key: "read", value: true }, { type: "log", message }] }];
}

export function secretPassageInteractions(dc = 15): InteractionDefinition[] {
  return [
    {
      id: id("discover"),
      label: "Search for hidden passages",
      preconditions: [{ type: "not_state", key: "found", equals: true }],
      check: { ability: "Wisdom (Perception)", dc },
      success: [{ type: "set_state", key: "found", value: true }, { type: "reveal_object" }, { type: "log", message: "A hidden passage is revealed." }],
      failure: [{ type: "log", message: "The wall seems solid." }],
    },
  ];
}

export function defaultInteractionsFor(kind: MapObject["kind"], state: MapObject["state"] = {}): InteractionDefinition[] {
  switch (kind) {
    case "container":
      return containerInteractions({ lockDc: state.lock_dc ?? null, keyItemId: state.key_item_id ?? null });
    case "trap":
    case "hazard":
      return trapInteractions({ detectDc: state.trap_dc ?? 12, disarmDc: state.trap_dc ?? 12, damage: state.trap_damage ?? "1d6" });
    case "mechanism":
      return mechanismInteractions();
    case "document":
      return documentInteractions();
    case "secret_passage":
      return secretPassageInteractions();
    case "statue":
    case "bookshelf":
    case "altar":
    case "furniture":
    case "decoration":
      return investigateInteractions();
  }
}
