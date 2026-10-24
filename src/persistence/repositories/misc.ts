import type { AssetRecord, CampaignLogEntry, QuestObjective, SessionNote, TimelineEvent } from "@/domain/types";
import type { ConfidenceLevel, TimelineEventCategory } from "@/domain/journeyTypes";
import type { Row, SqlDriver, Statement } from "../driver";
import { bool, buildSet, int, json, newId, now, num, parseJson, requireRow, str, text } from "./common";

/** Extra columns added to timeline_events by migration v3 (not part of the base TimelineEvent interface). */
export interface TimelineEventExtendedFields {
  category?: TimelineEventCategory;
  session_id?: string | null;
  journey_id?: string | null;
  segment_id?: string | null;
  location_id?: string | null;
  confidence?: ConfidenceLevel;
  manual_order?: number;
}

export class QuestRepository {
  constructor(private readonly db: SqlDriver) { }

  async objectives(questId: string): Promise<QuestObjective[]> {
    const rows = await this.db.select("SELECT * FROM quest_objectives WHERE quest_id = ? ORDER BY sort_order, rowid", [questId]);
    return rows.map(mapObjective);
  }

  async objectivesForCampaign(campaignId: string): Promise<QuestObjective[]> {
    const rows = await this.db.select(
      "SELECT o.* FROM quest_objectives o JOIN entities e ON e.id = o.quest_id WHERE e.campaign_id = ? ORDER BY o.sort_order",
      [campaignId],
    );
    return rows.map(mapObjective);
  }

  async addObjective(questId: string, title: string, optional = false, notes = ""): Promise<QuestObjective> {
    const id = newId();
    const existing = await this.objectives(questId);
    await this.db.execute(
      "INSERT INTO quest_objectives (id, quest_id, title, status, optional, sort_order, notes) VALUES (?, ?, ?, 'open', ?, ?, ?)",
      [id, questId, title, int(optional), existing.length, notes],
    );
    const rows = await this.db.select("SELECT * FROM quest_objectives WHERE id = ?", [id]);
    return mapObjective(requireRow(rows, "Objective", id));
  }

  async updateObjective(id: string, patch: Partial<Omit<QuestObjective, "id" | "quest_id">>): Promise<QuestObjective> {
    const { set, params, empty } = buildSet(patch, { optional: int });
    if (!empty) await this.db.execute(`UPDATE quest_objectives SET ${set} WHERE id = ?`, [...params, id]);
    const rows = await this.db.select("SELECT * FROM quest_objectives WHERE id = ?", [id]);
    return mapObjective(requireRow(rows, "Objective", id));
  }

  async deleteObjective(id: string): Promise<void> {
    await this.db.execute("DELETE FROM quest_objectives WHERE id = ?", [id]);
  }
}

function mapObjective(row: Row): QuestObjective {
  return {
    id: String(row.id),
    quest_id: String(row.quest_id),
    title: text(row.title),
    status: String(row.status) as QuestObjective["status"],
    optional: bool(row.optional),
    sort_order: num(row.sort_order) ?? 0,
    notes: text(row.notes),
  };
}

export class TimelineRepository {
  constructor(private readonly db: SqlDriver) { }

  async list(campaignId: string): Promise<TimelineEvent[]> {
    const rows = await this.db.select(
      "SELECT * FROM timeline_events WHERE campaign_id = ? ORDER BY manual_order ASC, year IS NULL, year, month IS NULL, month, day IS NULL, day, created_at",
      [campaignId],
    );
    return rows.map(mapTimeline);
  }

  async create(input: Omit<TimelineEvent, "id" | "created_at" | "updated_at"> & TimelineEventExtendedFields): Promise<TimelineEvent> {
    const id = newId();
    const ts = now();
    await this.db.execute(
      `INSERT INTO timeline_events (id, campaign_id, entity_id, title, body_md, year, month, day, kind, secret, category, session_id, journey_id, segment_id, location_id, confidence, manual_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.campaign_id,
        input.entity_id,
        input.title,
        input.body_md,
        input.year,
        input.month,
        input.day,
        input.kind,
        int(input.secret),
        input.category ?? "general",
        input.session_id ?? null,
        input.journey_id ?? null,
        input.segment_id ?? null,
        input.location_id ?? null,
        input.confidence ?? "certain",
        input.manual_order ?? 0,
        ts,
        ts,
      ],
    );
    return this.get(id);
  }

  async get(id: string): Promise<TimelineEvent> {
    const rows = await this.db.select("SELECT * FROM timeline_events WHERE id = ?", [id]);
    return mapTimeline(requireRow(rows, "Timeline event", id));
  }

  async update(id: string, patch: Partial<Omit<TimelineEvent, "id" | "created_at">> & TimelineEventExtendedFields): Promise<TimelineEvent> {
    const { set, params, empty } = buildSet({ ...patch, updated_at: now() }, { secret: int });
    if (!empty) await this.db.execute(`UPDATE timeline_events SET ${set} WHERE id = ?`, [...params, id]);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute("DELETE FROM timeline_events WHERE id = ?", [id]);
  }
}

function mapTimeline(row: Row): TimelineEvent {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    entity_id: str(row.entity_id),
    title: text(row.title),
    body_md: text(row.body_md),
    year: num(row.year),
    month: num(row.month),
    day: num(row.day),
    kind: String(row.kind) as TimelineEvent["kind"],
    secret: bool(row.secret),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export class SessionNoteRepository {
  constructor(private readonly db: SqlDriver) { }

  async list(sessionId: string): Promise<SessionNote[]> {
    const rows = await this.db.select("SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at", [sessionId]);
    return rows.map(mapSessionNote);
  }

  async unresolved(campaignId: string): Promise<SessionNote[]> {
    const rows = await this.db.select("SELECT * FROM session_notes WHERE campaign_id = ? AND resolved = 0 ORDER BY created_at", [campaignId]);
    return rows.map(mapSessionNote);
  }

  async add(sessionId: string, campaignId: string, body: string, kind: SessionNote["kind"] = "note"): Promise<SessionNote> {
    const id = newId();
    await this.db.execute(
      "INSERT INTO session_notes (id, session_id, campaign_id, body, kind, promoted_to, resolved, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)",
      [id, sessionId, campaignId, body, kind, now()],
    );
    const rows = await this.db.select("SELECT * FROM session_notes WHERE id = ?", [id]);
    return mapSessionNote(requireRow(rows, "Session note", id));
  }

  async update(id: string, patch: Partial<Omit<SessionNote, "id" | "session_id" | "campaign_id" | "created_at">>): Promise<void> {
    const { set, params, empty } = buildSet(patch, { resolved: int });
    if (!empty) await this.db.execute(`UPDATE session_notes SET ${set} WHERE id = ?`, [...params, id]);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute("DELETE FROM session_notes WHERE id = ?", [id]);
  }
}

function mapSessionNote(row: Row): SessionNote {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    campaign_id: String(row.campaign_id),
    body: text(row.body),
    kind: String(row.kind) as SessionNote["kind"],
    promoted_to: str(row.promoted_to),
    resolved: bool(row.resolved),
    created_at: text(row.created_at),
  };
}

export class CampaignLogRepository {
  constructor(private readonly db: SqlDriver) { }

  statement(campaignId: string, kind: string, message: string, refs: Record<string, string> = {}, sessionId: string | null = null): Statement {
    return {
      sql: "INSERT INTO campaign_log (id, campaign_id, session_id, at, kind, message, refs) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [newId(), campaignId, sessionId, now(), kind, message, json(refs)],
    };
  }

  async add(campaignId: string, kind: string, message: string, refs: Record<string, string> = {}, sessionId: string | null = null): Promise<void> {
    const s = this.statement(campaignId, kind, message, refs, sessionId || null);
    await this.db.execute(s.sql, s.params);
  }

  async list(campaignId: string, limit = 200): Promise<CampaignLogEntry[]> {
    const rows = await this.db.select("SELECT * FROM campaign_log WHERE campaign_id = ? ORDER BY at DESC LIMIT ?", [campaignId, limit]);
    return rows.map((row) => ({
      id: String(row.id),
      campaign_id: String(row.campaign_id),
      session_id: str(row.session_id),
      at: text(row.at),
      kind: text(row.kind),
      message: text(row.message),
      refs: parseJson<Record<string, string>>(row.refs, {}),
    }));
  }

  async forSession(sessionId: string): Promise<CampaignLogEntry[]> {
    const rows = await this.db.select("SELECT * FROM campaign_log WHERE session_id = ? ORDER BY at", [sessionId]);
    return rows.map((row) => ({
      id: String(row.id),
      campaign_id: String(row.campaign_id),
      session_id: str(row.session_id),
      at: text(row.at),
      kind: text(row.kind),
      message: text(row.message),
      refs: parseJson<Record<string, string>>(row.refs, {}),
    }));
  }
}

export class SettingsRepository {
  constructor(private readonly db: SqlDriver) { }

  async get<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    return rows[0] ? parseJson<T>(rows[0].value, fallback) : fallback;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, json(value)]);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.select<{ key: string; value: string }>("SELECT key, value FROM settings");
    return Object.fromEntries(rows.map((r) => [r.key, parseJson<unknown>(r.value, null)]));
  }
}

export class AssetRepository {
  constructor(private readonly db: SqlDriver) { }

  async register(input: Omit<AssetRecord, "id" | "created_at">): Promise<AssetRecord> {
    const id = newId();
    await this.db.execute(
      "INSERT INTO assets (id, campaign_id, rel_path, kind, file_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rel_path) DO UPDATE SET size = excluded.size, file_name = excluded.file_name",
      [id, input.campaign_id, input.rel_path, input.kind, input.file_name, input.size, now()],
    );
    const rows = await this.db.select("SELECT * FROM assets WHERE rel_path = ?", [input.rel_path]);
    return mapAsset(requireRow(rows, "Asset", input.rel_path));
  }

  async list(campaignId: string): Promise<AssetRecord[]> {
    const rows = await this.db.select("SELECT * FROM assets WHERE campaign_id = ? ORDER BY created_at DESC", [campaignId]);
    return rows.map(mapAsset);
  }

  async delete(relPath: string): Promise<void> {
    await this.db.execute("DELETE FROM assets WHERE rel_path = ?", [relPath]);
  }
}

function mapAsset(row: Row): AssetRecord {
  return {
    id: String(row.id),
    campaign_id: str(row.campaign_id),
    rel_path: text(row.rel_path),
    kind: text(row.kind),
    file_name: str(row.file_name),
    size: num(row.size),
    created_at: text(row.created_at),
  };
}
