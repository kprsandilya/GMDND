import { d20 } from "@/domain/dice";
import { snapshotSheet } from "@/domain/statblock";
import type {
  Combatant,
  Condition,
  EncounterOutcomes,
  EncounterParticipant,
  EncounterRun,
  EncounterSide,
  Entity,
  RunLogEntry,
  RunStatus,
} from "@/domain/types";
import type { Row, SqlDriver, Statement } from "../driver";
import { bool, buildSet, existingId, int, json, newId, now, num, parseJson, requireRow, str, text } from "./common";
import { EntityRepository } from "./entities";

export function mapParticipant(row: Row): EncounterParticipant {
  return {
    id: String(row.id),
    encounter_id: String(row.encounter_id),
    entity_id: str(row.entity_id),
    label: str(row.label),
    count: num(row.count) ?? 1,
    side: String(row.side) as EncounterSide,
    notes: text(row.notes),
    sort_order: num(row.sort_order) ?? 0,
  };
}

export function mapRun(row: Row): EncounterRun {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    encounter_id: str(row.encounter_id),
    session_id: str(row.session_id),
    room_id: str(row.room_id),
    floor_id: str(row.floor_id),
    name: text(row.name),
    status: String(row.status) as RunStatus,
    round: num(row.round) ?? 0,
    turn_index: num(row.turn_index) ?? 0,
    log: parseJson<RunLogEntry[]>(row.log, []),
    outcomes: parseJson<EncounterOutcomes>(row.outcomes, {}),
    started_at: str(row.started_at),
    ended_at: str(row.ended_at),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapCombatant(row: Row): Combatant {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    entity_id: str(row.entity_id),
    token_id: str(row.token_id),
    name: text(row.name),
    side: String(row.side) as EncounterSide,
    initiative: num(row.initiative),
    initiative_mod: num(row.initiative_mod) ?? 0,
    hp: Number(row.hp),
    max_hp: Number(row.max_hp),
    temp_hp: num(row.temp_hp) ?? 0,
    ac: num(row.ac),
    conditions: parseJson<Condition[]>(row.conditions, []),
    resources: parseJson<Record<string, number>>(row.resources, {}),
    defeated: bool(row.defeated),
    notes: text(row.notes),
    sort_order: num(row.sort_order) ?? 0,
    sheet: parseJson<Record<string, unknown>>(row.sheet, {}),
  };
}

export interface StartRunOptions {
  campaign_id: string;
  encounter_id: string | null;
  name?: string;
  room_id?: string | null;
  floor_id?: string | null;
  session_id?: string | null;
  /** Party members (PC entities) to add on the "party" side. */
  party?: Entity[];
  /** Existing tokens on the floor to bind combatants to, matched by entity_id. */
  tokens?: { id: string; entity_id: string | null; name: string; hp: number | null; max_hp: number | null }[];
}

export interface CombatantInput {
  entity_id?: string | null;
  token_id?: string | null;
  name: string;
  side?: EncounterSide;
  initiative?: number | null;
  initiative_mod?: number;
  hp: number;
  max_hp: number;
  temp_hp?: number;
  ac?: number | null;
  conditions?: Condition[];
  resources?: Record<string, number>;
  notes?: string;
  sort_order?: number;
  sheet?: Record<string, unknown>;
}

/** Sort by initiative descending, ties by initiative modifier then name. */
export function sortCombatants(combatants: Combatant[]): Combatant[] {
  return [...combatants].sort((a, b) => {
    const ai = a.initiative ?? -Infinity;
    const bi = b.initiative ?? -Infinity;
    if (bi !== ai) return bi - ai;
    if (b.initiative_mod !== a.initiative_mod) return b.initiative_mod - a.initiative_mod;
    return a.name.localeCompare(b.name);
  });
}

export class EncounterRepository {
  private readonly entities: EntityRepository;

  constructor(private readonly db: SqlDriver) {
    this.entities = new EntityRepository(db);
  }

  // ---- template participants ----

  async participants(encounterId: string): Promise<EncounterParticipant[]> {
    const rows = await this.db.select("SELECT * FROM encounter_participants WHERE encounter_id = ? ORDER BY sort_order, label", [encounterId]);
    return rows.map(mapParticipant);
  }

  async addParticipant(input: Omit<EncounterParticipant, "id">): Promise<EncounterParticipant> {
    const id = newId();
    await this.db.execute(
      "INSERT INTO encounter_participants (id, encounter_id, entity_id, label, count, side, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.encounter_id, input.entity_id, input.label, input.count, input.side, input.notes, input.sort_order],
    );
    const rows = await this.db.select("SELECT * FROM encounter_participants WHERE id = ?", [id]);
    return mapParticipant(requireRow(rows, "Participant", id));
  }

  async updateParticipant(id: string, patch: Partial<Omit<EncounterParticipant, "id" | "encounter_id">>): Promise<void> {
    const { set, params, empty } = buildSet(patch);
    if (!empty) await this.db.execute(`UPDATE encounter_participants SET ${set} WHERE id = ?`, [...params, id]);
  }

  async removeParticipant(id: string): Promise<void> {
    await this.db.execute("DELETE FROM encounter_participants WHERE id = ?", [id]);
  }

  // ---- runs ----

  /**
   * Creates an execution instance from a template. Combatants are copied from participants and
   * creature records, so running the encounter never changes the reusable definition.
   */
  async startRun(options: StartRunOptions): Promise<{ run: EncounterRun; combatants: Combatant[] }> {
    const campaignId = await existingId(this.db, "entities", options.campaign_id);
    if (!campaignId) throw new Error("No campaign is selected, or that campaign no longer exists.");
    const encounterId = await existingId(this.db, "entities", options.encounter_id);
    const sessionId = await existingId(this.db, "entities", options.session_id);
    const roomId = await existingId(this.db, "rooms", options.room_id);
    const floorId = await existingId(this.db, "dungeon_floors", options.floor_id);
    const template = encounterId ? await this.entities.get(encounterId) : null;
    const participants = encounterId ? await this.participants(encounterId) : [];
    const definitions = await this.entities.getMany(participants.map((p) => p.entity_id).filter((id): id is string => !!id));
    const byId = new Map(definitions.map((d) => [d.id, d]));
    const runId = newId();
    const ts = now();
    const statements: Statement[] = [
      {
        sql: `INSERT INTO encounter_runs (id, campaign_id, encounter_id, session_id, room_id, floor_id, name, status, round, turn_index, log, outcomes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', 0, 0, '[]', '{}', ?, ?)`,
        params: [runId, campaignId, encounterId, sessionId, roomId, floorId, options.name ?? template?.name ?? "Encounter", ts, ts],
      },
    ];

    let order = 0;
    const usedTokens = new Set<string>();
    for (const participant of participants) {
      const definition = participant.entity_id ? byId.get(participant.entity_id) : undefined;
      const sheet = snapshotSheet(definition);
      const maxHp = Number(sheet.max_hp ?? sheet.hp ?? 10) || 10;
      const ac = sheet.ac !== undefined ? Number(sheet.ac) : null;
      const dexMod = Math.floor(((Number((sheet.abilities as Record<string, number> | undefined)?.dex) || 10) - 10) / 2);
      const initiativeMod = Number(sheet.initiative ?? dexMod);
      const legendary = Number(sheet.legendary_actions ?? 0) || 0;
      for (let i = 0; i < participant.count; i++) {
        const baseName = participant.label ?? definition?.name ?? "Combatant";
        const name = participant.count > 1 ? `${baseName} ${i + 1}` : baseName;
        const token = options.tokens?.find((t) => !usedTokens.has(t.id) && t.entity_id && t.entity_id === participant.entity_id);
        if (token) usedTokens.add(token.id);
        const hp = token?.hp ?? maxHp;
        statements.push(
          this.combatantInsert(runId, {
            entity_id: participant.entity_id && byId.has(participant.entity_id) ? participant.entity_id : null,
            token_id: token?.id ?? null,
            name: token?.name && participant.count === 1 ? token.name : name,
            side: participant.side,
            initiative_mod: Number.isFinite(initiativeMod) ? initiativeMod : dexMod,
            hp,
            max_hp: token?.max_hp ?? maxHp,
            ac,
            resources: legendary ? { legendary, legendary_max: legendary } : {},
            notes: participant.notes,
            sort_order: order++,
            sheet: structuredClone(sheet),
          }),
        );
      }
    }
    for (const member of options.party ?? []) {
      const sheet = snapshotSheet(member);
      const token = options.tokens?.find((t) => !usedTokens.has(t.id) && t.entity_id === member.id);
      if (token) usedTokens.add(token.id);
      statements.push(
        this.combatantInsert(runId, {
          entity_id: member.id,
          token_id: token?.id ?? null,
          name: member.name,
          side: "party",
          initiative_mod: Number(sheet.initiative ?? Math.floor(((Number((sheet.abilities as Record<string, number> | undefined)?.dex) || 10) - 10) / 2)),
          hp: Number(sheet.hp ?? sheet.max_hp ?? 10),
          max_hp: Number(sheet.max_hp ?? sheet.hp ?? 10),
          ac: sheet.ac !== undefined ? Number(sheet.ac) : null,
          sort_order: order++,
          sheet,
        }),
      );
    }
    await this.db.batch(statements);
    return { run: await this.getRun(runId), combatants: await this.combatants(runId) };
  }

  private combatantInsert(runId: string, input: CombatantInput, id = newId()): Statement {
    return {
      sql: `INSERT INTO combatants (id, run_id, entity_id, token_id, name, side, initiative, initiative_mod, hp, max_hp, temp_hp, ac, conditions, resources, defeated, notes, sort_order, sheet)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      params: [
        id,
        runId,
        input.entity_id ?? null,
        input.token_id ?? null,
        input.name,
        input.side ?? "enemy",
        input.initiative ?? null,
        input.initiative_mod ?? 0,
        input.hp,
        input.max_hp,
        input.temp_hp ?? 0,
        input.ac ?? null,
        json(input.conditions ?? []),
        json(input.resources ?? {}),
        input.notes ?? "",
        input.sort_order ?? 0,
        json(input.sheet ?? {}),
      ],
    };
  }

  async addCombatant(runId: string, input: CombatantInput): Promise<Combatant> {
    const id = newId();
    const statement = this.combatantInsert(runId, input, id);
    await this.db.execute(statement.sql, statement.params);
    return this.getCombatant(id);
  }

  async getRun(id: string): Promise<EncounterRun> {
    const rows = await this.db.select("SELECT * FROM encounter_runs WHERE id = ?", [id]);
    return mapRun(requireRow(rows, "Encounter run", id));
  }

  async findRun(id: string | null | undefined): Promise<EncounterRun | null> {
    if (!id) return null;
    const rows = await this.db.select("SELECT * FROM encounter_runs WHERE id = ?", [id]);
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async runs(campaignId: string, status?: RunStatus[]): Promise<EncounterRun[]> {
    const rows = status?.length
      ? await this.db.select(
          `SELECT * FROM encounter_runs WHERE campaign_id = ? AND status IN (${status.map(() => "?").join(",")}) ORDER BY updated_at DESC`,
          [campaignId, ...status],
        )
      : await this.db.select("SELECT * FROM encounter_runs WHERE campaign_id = ? ORDER BY updated_at DESC", [campaignId]);
    return rows.map(mapRun);
  }

  async runsForEncounter(encounterId: string): Promise<EncounterRun[]> {
    const rows = await this.db.select("SELECT * FROM encounter_runs WHERE encounter_id = ? ORDER BY created_at DESC", [encounterId]);
    return rows.map(mapRun);
  }

  async updateRun(id: string, patch: Partial<Omit<EncounterRun, "id" | "created_at">>): Promise<EncounterRun> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { log: json, outcomes: json });
    if (!empty) await this.db.execute(`UPDATE encounter_runs SET ${set} WHERE id = ?`, [...params, id]);
    return this.getRun(id);
  }

  async appendLog(runId: string, message: string, kind = "info"): Promise<EncounterRun> {
    const run = await this.getRun(runId);
    const entry: RunLogEntry = { at: now(), round: run.round, message, kind };
    return this.updateRun(runId, { log: [...run.log, entry] });
  }

  async begin(runId: string): Promise<EncounterRun> {
    const run = await this.getRun(runId);
    if (run.status !== "prepared") return run;
    await this.updateRun(runId, { status: "active", round: 1, turn_index: 0, started_at: now() });
    return this.appendLog(runId, "Encounter begins. Round 1.", "round");
  }

  /** Advances to the next living combatant; wraps to a new round and ticks condition durations. */
  async nextTurn(runId: string): Promise<{ run: EncounterRun; combatants: Combatant[] }> {
    const run = await this.getRun(runId);
    const ordered = sortCombatants(await this.combatants(runId));
    if (ordered.length === 0) return { run, combatants: ordered };
    let index = run.turn_index;
    let round = run.round;
    let newRound = false;
    for (let attempts = 0; attempts < ordered.length + 1; attempts++) {
      index += 1;
      if (index >= ordered.length) {
        index = 0;
        round += 1;
        newRound = true;
      }
      if (!ordered[index]!.defeated) break;
    }
    const statements: Statement[] = [];
    if (newRound) {
      for (const c of ordered) {
        const ticked = c.conditions
          .map((cond) => (cond.duration === null ? cond : { ...cond, duration: cond.duration - 1 }))
          .filter((cond) => cond.duration === null || cond.duration > 0);
        if (ticked.length !== c.conditions.length || ticked.some((t, i) => t.duration !== c.conditions[i]?.duration)) {
          statements.push({ sql: "UPDATE combatants SET conditions = ? WHERE id = ?", params: [json(ticked), c.id] });
        }
      }
    }
    const current = ordered[index]!;
    const legendaryMax = Number(current.resources.legendary_max ?? current.sheet.legendary_actions ?? 0) || 0;
    if (legendaryMax > 0) {
      statements.push({
        sql: "UPDATE combatants SET resources = ? WHERE id = ?",
        params: [json({ ...current.resources, legendary: legendaryMax, legendary_max: legendaryMax }), current.id],
      });
    }
    const log = [...run.log];
    if (newRound) log.push({ at: now(), round, message: `Round ${round} begins.`, kind: "round" });
    log.push({ at: now(), round, message: `${ordered[index]!.name}'s turn.`, kind: "turn" });
    statements.push({
      sql: "UPDATE encounter_runs SET turn_index = ?, round = ?, log = ?, updated_at = ? WHERE id = ?",
      params: [index, round, json(log), now(), runId],
    });
    await this.db.batch(statements);
    return { run: await this.getRun(runId), combatants: await this.combatants(runId) };
  }

  async finish(runId: string, status: "completed" | "aborted", outcomes: EncounterOutcomes): Promise<EncounterRun> {
    await this.updateRun(runId, { status, outcomes, ended_at: now() });
    return this.appendLog(runId, status === "completed" ? "Encounter completed." : "Encounter aborted.", "end");
  }

  async deleteRun(id: string): Promise<void> {
    await this.db.execute("DELETE FROM encounter_runs WHERE id = ?", [id]);
  }

  // ---- combatants ----

  async combatants(runId: string): Promise<Combatant[]> {
    const rows = await this.db.select("SELECT * FROM combatants WHERE run_id = ? ORDER BY sort_order", [runId]);
    return rows.map(mapCombatant);
  }

  async getCombatant(id: string): Promise<Combatant> {
    const rows = await this.db.select("SELECT * FROM combatants WHERE id = ?", [id]);
    return mapCombatant(requireRow(rows, "Combatant", id));
  }

  async updateCombatant(id: string, patch: Partial<Omit<Combatant, "id" | "run_id">>): Promise<Combatant> {
    const { set, params, empty } = buildSet(patch, { conditions: json, resources: json, defeated: int, sheet: json });
    if (!empty) await this.db.execute(`UPDATE combatants SET ${set} WHERE id = ?`, [...params, id]);
    return this.getCombatant(id);
  }

  /** Fills an empty sheet from the catalog entity once, then later edits stay on the instance. */
  async ensureSheet(id: string): Promise<Combatant> {
    const c = await this.getCombatant(id);
    if (Object.keys(c.sheet).length > 0 || !c.entity_id) return c;
    const entity = await this.entities.find(c.entity_id);
    if (!entity) return c;
    return this.updateCombatant(id, { sheet: snapshotSheet(entity) });
  }

  async resetSheetFromTemplate(id: string): Promise<Combatant> {
    const c = await this.getCombatant(id);
    if (!c.entity_id) return c;
    const entity = await this.entities.find(c.entity_id);
    if (!entity) return c;
    const sheet = snapshotSheet(entity);
    const legendary = Number(sheet.legendary_actions ?? 0) || 0;
    return this.updateCombatant(id, {
      sheet,
      ac: sheet.ac !== undefined ? Number(sheet.ac) : c.ac,
      max_hp: Number(sheet.max_hp ?? sheet.hp ?? c.max_hp) || c.max_hp,
      resources: legendary ? { ...c.resources, legendary, legendary_max: legendary } : c.resources,
    });
  }

  async findCombatantByToken(tokenId: string | null | undefined): Promise<Combatant | null> {
    if (!tokenId) return null;
    const rows = await this.db.select(
      `SELECT c.* FROM combatants c JOIN encounter_runs r ON r.id = c.run_id
       WHERE c.token_id = ? AND r.status IN ('prepared', 'active')
       ORDER BY r.updated_at DESC LIMIT 1`,
      [tokenId],
    );
    return rows[0] ? mapCombatant(rows[0]) : null;
  }

  async spendLegendary(id: string, note = ""): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const left = Number(c.resources.legendary ?? 0);
    if (left <= 0) return c;
    const updated = await this.updateCombatant(id, { resources: { ...c.resources, legendary: left - 1 } });
    await this.appendLog(c.run_id, `${c.name} uses a legendary action${note ? ` (${note})` : ""} (${left - 1} left).`, "action");
    return updated;
  }

  async rollDeathSave(id: string, rollValue?: number): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const value = rollValue ?? d20();
    let success = Number(c.resources.death_success ?? 0);
    let fail = Number(c.resources.death_fail ?? 0);
    let hp = c.hp;
    let defeated = c.defeated;
    let conditions = c.conditions;
    let message = `${c.name} death save: ${value}`;
    if (value === 20) {
      hp = 1;
      success = 0;
      fail = 0;
      defeated = false;
      conditions = conditions.filter((x) => x.name !== "unconscious");
      message += " — natural 20, back at 1 HP.";
    } else if (value === 1) {
      fail += 2;
      message += " — natural 1, two failures.";
    } else if (value >= 10) {
      success += 1;
      message += ` — success (${success}/3).`;
    } else {
      fail += 1;
      message += ` — failure (${fail}/3).`;
    }
    if (hp === 0 && success >= 3) {
      message += " Stabilized.";
      success = 3;
    }
    if (fail >= 3) {
      defeated = true;
      message += " Dies.";
    }
    const updated = await this.updateCombatant(id, {
      hp,
      defeated,
      conditions,
      resources: { ...c.resources, death_success: success, death_fail: fail },
    });
    await this.appendLog(c.run_id, message, "condition");
    return updated;
  }

  async removeCombatant(id: string): Promise<void> {
    await this.db.execute("DELETE FROM combatants WHERE id = ?", [id]);
  }

  /** Damage goes through temporary HP first. Enemies drop defeated at 0; the party starts death saves. */
  async damage(id: string, amount: number, note = ""): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const alreadyDown = c.hp === 0;
    const absorbed = Math.min(c.temp_hp, amount);
    const hp = Math.max(0, c.hp - (amount - absorbed));
    let defeated = c.defeated;
    let conditions = c.conditions;
    let resources = c.resources;
    let extra = "";
    if (hp === 0) {
      if (c.side === "party") {
        if (alreadyDown) {
          const fail = Number(resources.death_fail ?? 0) + 1;
          resources = { ...resources, death_fail: fail };
          defeated = fail >= 3;
          extra = defeated ? " and dies (3 death-save failures)" : ` (death-save failure ${fail}/3)`;
        } else {
          defeated = false;
          resources = { ...resources, death_success: 0, death_fail: 0 };
          if (!conditions.some((x) => x.name === "unconscious")) conditions = [...conditions, { name: "unconscious", duration: null }];
          extra = " and is dying — roll death saves";
        }
      } else {
        defeated = true;
        extra = " and drops to 0 HP";
      }
    }
    const updated = await this.updateCombatant(id, { temp_hp: c.temp_hp - absorbed, hp, defeated, conditions, resources });
    await this.appendLog(c.run_id, `${c.name} takes ${amount} damage${note ? ` (${note})` : ""}${extra}.`, "damage");
    return updated;
  }

  async heal(id: string, amount: number): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const hp = Math.min(c.max_hp, c.hp + amount);
    const conditions = hp > 0 ? c.conditions.filter((x) => x.name !== "unconscious") : c.conditions;
    const resources = hp > 0 ? { ...c.resources, death_success: 0, death_fail: 0 } : c.resources;
    const updated = await this.updateCombatant(id, { hp, defeated: false, conditions, resources });
    await this.appendLog(c.run_id, `${c.name} regains ${amount} HP.`, "heal");
    return updated;
  }

  async setTempHp(id: string, amount: number): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const updated = await this.updateCombatant(id, { temp_hp: Math.max(c.temp_hp, amount) });
    await this.appendLog(c.run_id, `${c.name} gains ${amount} temporary HP.`, "heal");
    return updated;
  }

  async addCondition(id: string, condition: Condition): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const conditions = [...c.conditions.filter((x) => x.name !== condition.name), condition];
    const updated = await this.updateCombatant(id, { conditions });
    await this.appendLog(c.run_id, `${c.name} is ${condition.name}${condition.duration ? ` for ${condition.duration} rounds` : ""}.`, "condition");
    return updated;
  }

  async removeCondition(id: string, name: string): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const updated = await this.updateCombatant(id, { conditions: c.conditions.filter((x) => x.name !== name) });
    await this.appendLog(c.run_id, `${c.name} is no longer ${name}.`, "condition");
    return updated;
  }

  async setInitiative(id: string, initiative: number | null): Promise<Combatant> {
    return this.updateCombatant(id, { initiative });
  }
}
