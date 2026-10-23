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
import { bool, buildSet, int, json, newId, now, num, parseJson, requireRow, str, text } from "./common";
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
    const template = options.encounter_id ? await this.entities.get(options.encounter_id) : null;
    const participants = options.encounter_id ? await this.participants(options.encounter_id) : [];
    const definitions = await this.entities.getMany(participants.map((p) => p.entity_id).filter((id): id is string => !!id));
    const byId = new Map(definitions.map((d) => [d.id, d]));
    const runId = newId();
    const ts = now();
    const statements: Statement[] = [
      {
        sql: `INSERT INTO encounter_runs (id, campaign_id, encounter_id, session_id, room_id, floor_id, name, status, round, turn_index, log, outcomes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', 0, 0, '[]', '{}', ?, ?)`,
        params: [runId, options.campaign_id, options.encounter_id, options.session_id ?? null, options.room_id ?? null, options.floor_id ?? null, options.name ?? template?.name ?? "Encounter", ts, ts],
      },
    ];

    let order = 0;
    const usedTokens = new Set<string>();
    for (const participant of participants) {
      const definition = participant.entity_id ? byId.get(participant.entity_id) : undefined;
      const fields = (definition?.fields ?? {}) as Record<string, unknown>;
      const maxHp = Number(fields.max_hp ?? fields.hp ?? 10) || 10;
      const ac = fields.ac !== undefined ? Number(fields.ac) : null;
      const dexMod = Math.floor(((Number((fields.abilities as Record<string, number> | undefined)?.dex) || 10) - 10) / 2);
      for (let i = 0; i < participant.count; i++) {
        const baseName = participant.label ?? definition?.name ?? "Combatant";
        const name = participant.count > 1 ? `${baseName} ${i + 1}` : baseName;
        const token = options.tokens?.find((t) => !usedTokens.has(t.id) && t.entity_id && t.entity_id === participant.entity_id);
        if (token) usedTokens.add(token.id);
        const hp = token?.hp ?? maxHp;
        statements.push(
          this.combatantInsert(runId, {
            entity_id: participant.entity_id,
            token_id: token?.id ?? null,
            name: token?.name && participant.count === 1 ? token.name : name,
            side: participant.side,
            initiative_mod: dexMod,
            hp,
            max_hp: token?.max_hp ?? maxHp,
            ac,
            resources: fields.legendary_actions ? { legendary: Number(fields.legendary_actions) } : {},
            notes: participant.notes,
            sort_order: order++,
          }),
        );
      }
    }
    for (const member of options.party ?? []) {
      const fields = member.fields as Record<string, unknown>;
      const token = options.tokens?.find((t) => !usedTokens.has(t.id) && t.entity_id === member.id);
      if (token) usedTokens.add(token.id);
      statements.push(
        this.combatantInsert(runId, {
          entity_id: member.id,
          token_id: token?.id ?? null,
          name: member.name,
          side: "party",
          initiative_mod: Math.floor(((Number((fields.abilities as Record<string, number> | undefined)?.dex) || 10) - 10) / 2),
          hp: Number(fields.hp ?? fields.max_hp ?? 10),
          max_hp: Number(fields.max_hp ?? fields.hp ?? 10),
          ac: fields.ac !== undefined ? Number(fields.ac) : null,
          sort_order: order++,
        }),
      );
    }
    await this.db.batch(statements);
    return { run: await this.getRun(runId), combatants: await this.combatants(runId) };
  }

  private combatantInsert(runId: string, input: CombatantInput, id = newId()): Statement {
    return {
      sql: `INSERT INTO combatants (id, run_id, entity_id, token_id, name, side, initiative, initiative_mod, hp, max_hp, temp_hp, ac, conditions, resources, defeated, notes, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
    const { set, params, empty } = buildSet(patch, { conditions: json, resources: json, defeated: int });
    if (!empty) await this.db.execute(`UPDATE combatants SET ${set} WHERE id = ?`, [...params, id]);
    return this.getCombatant(id);
  }

  async removeCombatant(id: string): Promise<void> {
    await this.db.execute("DELETE FROM combatants WHERE id = ?", [id]);
  }

  /** Damage goes through temporary HP first; dropping to 0 marks the combatant defeated. */
  async damage(id: string, amount: number, note = ""): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const absorbed = Math.min(c.temp_hp, amount);
    const hp = Math.max(0, c.hp - (amount - absorbed));
    const updated = await this.updateCombatant(id, { temp_hp: c.temp_hp - absorbed, hp, defeated: hp === 0 });
    await this.appendLog(c.run_id, `${c.name} takes ${amount} damage${note ? ` (${note})` : ""}${hp === 0 ? " and drops to 0 HP" : ""}.`, "damage");
    return updated;
  }

  async heal(id: string, amount: number): Promise<Combatant> {
    const c = await this.getCombatant(id);
    const hp = Math.min(c.max_hp, c.hp + amount);
    const updated = await this.updateCombatant(id, { hp, defeated: false });
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
