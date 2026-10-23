import type { InventoryLogEntry, ItemInstance, ItemInstanceWithDefinition, OwnerType } from "@/domain/types";
import type { Row, SqlDriver, Statement } from "../driver";
import { json, newId, now, num, parseJson, requireRow, str, text } from "./common";
import { mapEntity } from "./entities";

export interface Owner {
  owner_type: OwnerType;
  owner_id: string | null;
}

export function mapInstance(row: Row): ItemInstance {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    definition_id: String(row.definition_id),
    quantity: Number(row.quantity),
    owner_type: String(row.owner_type) as OwnerType,
    owner_id: str(row.owner_id),
    state: parseJson<Record<string, unknown>>(row.state, {}),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

function mapInstanceWithDefinition(row: Row): ItemInstanceWithDefinition {
  const instance = mapInstance({
    id: row.i_id,
    campaign_id: row.i_campaign_id,
    definition_id: row.definition_id,
    quantity: row.quantity,
    owner_type: row.owner_type,
    owner_id: row.owner_id,
    state: row.state,
    created_at: row.i_created_at,
    updated_at: row.i_updated_at,
  });
  return { ...instance, definition: mapEntity(row) };
}

const WITH_DEF = `SELECT i.id AS i_id, i.campaign_id AS i_campaign_id, i.definition_id, i.quantity, i.owner_type, i.owner_id, i.state,
  i.created_at AS i_created_at, i.updated_at AS i_updated_at, e.*
  FROM item_instances i JOIN entities e ON e.id = i.definition_id`;

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface TransferRequest {
  instance_id: string;
  quantity?: number; // defaults to the whole stack
  to: Owner;
  note?: string;
  session_id?: string | null;
}

export class InventoryRepository {
  constructor(private readonly db: SqlDriver) {}

  async get(id: string): Promise<ItemInstance> {
    const rows = await this.db.select("SELECT * FROM item_instances WHERE id = ?", [id]);
    return mapInstance(requireRow(rows, "Item instance", id));
  }

  async find(id: string): Promise<ItemInstance | null> {
    const rows = await this.db.select("SELECT * FROM item_instances WHERE id = ?", [id]);
    return rows[0] ? mapInstance(rows[0]) : null;
  }

  async getWithDefinition(id: string): Promise<ItemInstanceWithDefinition> {
    const rows = await this.db.select(`${WITH_DEF} WHERE i.id = ?`, [id]);
    return mapInstanceWithDefinition(requireRow(rows, "Item instance", id));
  }

  async listByOwner(owner: Owner): Promise<ItemInstanceWithDefinition[]> {
    const rows = owner.owner_id
      ? await this.db.select(`${WITH_DEF} WHERE i.owner_type = ? AND i.owner_id = ? ORDER BY e.name COLLATE NOCASE`, [owner.owner_type, owner.owner_id])
      : await this.db.select(`${WITH_DEF} WHERE i.owner_type = ? AND i.owner_id IS NULL ORDER BY e.name COLLATE NOCASE`, [owner.owner_type]);
    return rows.map(mapInstanceWithDefinition);
  }

  async listForCampaign(campaignId: string): Promise<ItemInstanceWithDefinition[]> {
    const rows = await this.db.select(`${WITH_DEF} WHERE i.campaign_id = ? ORDER BY e.name COLLATE NOCASE`, [campaignId]);
    return rows.map(mapInstanceWithDefinition);
  }

  async listForDefinition(definitionId: string): Promise<ItemInstance[]> {
    const rows = await this.db.select("SELECT * FROM item_instances WHERE definition_id = ?", [definitionId]);
    return rows.map(mapInstance);
  }

  async totalQuantity(owner: Owner, definitionId: string): Promise<number> {
    const rows = owner.owner_id
      ? await this.db.select<{ q: number | null }>(
          "SELECT sum(quantity) AS q FROM item_instances WHERE owner_type = ? AND owner_id = ? AND definition_id = ?",
          [owner.owner_type, owner.owner_id, definitionId],
        )
      : await this.db.select<{ q: number | null }>(
          "SELECT sum(quantity) AS q FROM item_instances WHERE owner_type = ? AND owner_id IS NULL AND definition_id = ?",
          [owner.owner_type, definitionId],
        );
    return Number(rows[0]?.q ?? 0);
  }

  grantStatement(
    campaignId: string,
    definitionId: string,
    quantity: number,
    owner: Owner,
    state: Record<string, unknown> = {},
    id = newId(),
  ): Statement {
    const ts = now();
    return {
      sql: `INSERT INTO item_instances (id, campaign_id, definition_id, quantity, owner_type, owner_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, campaignId, definitionId, quantity, owner.owner_type, owner.owner_id, json(state), ts, ts],
    };
  }

  /** Creates a new physical instance of a definition in an owner's possession. */
  async grant(campaignId: string, definitionId: string, quantity: number, owner: Owner, state: Record<string, unknown> = {}, note = "created"): Promise<ItemInstance> {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new InventoryError("quantity must be a positive integer");
    const id = newId();
    await this.db.batch([
      this.grantStatement(campaignId, definitionId, quantity, owner, state, id),
      this.logStatement(campaignId, { instance_id: id, definition_id: definitionId, quantity, to: owner, note }),
    ]);
    return this.get(id);
  }

  async updateState(id: string, state: Record<string, unknown>): Promise<ItemInstance> {
    const existing = await this.get(id);
    await this.db.execute("UPDATE item_instances SET state = ?, updated_at = ? WHERE id = ?", [json({ ...existing.state, ...state }), now(), id]);
    return this.get(id);
  }

  async setQuantity(id: string, quantity: number, note = "adjusted"): Promise<ItemInstance | null> {
    if (!Number.isInteger(quantity) || quantity < 0) throw new InventoryError("quantity must be a non-negative integer");
    const existing = await this.get(id);
    const statements: Statement[] =
      quantity === 0
        ? [{ sql: "DELETE FROM item_instances WHERE id = ?", params: [id], expect_changes: 1 }]
        : [{ sql: "UPDATE item_instances SET quantity = ?, updated_at = ? WHERE id = ?", params: [quantity, now(), id], expect_changes: 1 }];
    statements.push(
      this.logStatement(existing.campaign_id, {
        instance_id: id,
        definition_id: existing.definition_id,
        quantity: quantity - existing.quantity,
        from: { owner_type: existing.owner_type, owner_id: existing.owner_id },
        note,
      }),
    );
    await this.db.batch(statements);
    return quantity === 0 ? null : this.get(id);
  }

  async destroy(id: string, note = "destroyed"): Promise<void> {
    await this.setQuantity(id, 0, note);
  }

  /**
   * Moves `quantity` units of an instance to another owner inside one transaction.
   * Stacks of the same definition with identical state merge at the destination, so taking a
   * potion out of a chest never duplicates it and never leaves a phantom copy behind.
   */
  async transfer(request: TransferRequest): Promise<ItemInstance> {
    const source = await this.get(request.instance_id);
    const quantity = request.quantity ?? source.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) throw new InventoryError("quantity must be a positive integer");
    if (quantity > source.quantity) throw new InventoryError(`only ${source.quantity} available, cannot transfer ${quantity}`);
    if (source.owner_type === request.to.owner_type && source.owner_id === request.to.owner_id) return source;

    const stateJson = json(source.state);
    const destinationStacks = await this.listByOwner(request.to);
    const mergeTarget = destinationStacks.find(
      (s) => s.definition_id === source.definition_id && json(s.state) === stateJson && s.definition.fields.stackable !== false,
    );
    const ts = now();
    const statements: Statement[] = [];
    let resultId: string;

    if (quantity === source.quantity) {
      if (mergeTarget) {
        statements.push(
          { sql: "DELETE FROM item_instances WHERE id = ? AND quantity = ?", params: [source.id, source.quantity], expect_changes: 1 },
          { sql: "UPDATE item_instances SET quantity = quantity + ?, updated_at = ? WHERE id = ?", params: [quantity, ts, mergeTarget.id], expect_changes: 1 },
        );
        resultId = mergeTarget.id;
      } else {
        statements.push({
          sql: "UPDATE item_instances SET owner_type = ?, owner_id = ?, updated_at = ? WHERE id = ? AND quantity = ?",
          params: [request.to.owner_type, request.to.owner_id, ts, source.id, source.quantity],
          expect_changes: 1,
        });
        resultId = source.id;
      }
    } else {
      statements.push({
        sql: "UPDATE item_instances SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND quantity >= ?",
        params: [quantity, ts, source.id, quantity],
        expect_changes: 1,
      });
      if (mergeTarget) {
        statements.push({
          sql: "UPDATE item_instances SET quantity = quantity + ?, updated_at = ? WHERE id = ?",
          params: [quantity, ts, mergeTarget.id],
          expect_changes: 1,
        });
        resultId = mergeTarget.id;
      } else {
        resultId = newId();
        statements.push(this.grantStatement(source.campaign_id, source.definition_id, quantity, request.to, source.state, resultId));
      }
    }

    statements.push(
      this.logStatement(source.campaign_id, {
        instance_id: resultId,
        definition_id: source.definition_id,
        quantity,
        from: { owner_type: source.owner_type, owner_id: source.owner_id },
        to: request.to,
        note: request.note ?? "transfer",
      }),
    );
    await this.db.batch(statements);
    return this.get(resultId);
  }

  /** Moves every instance owned by `from` to `to` (looting a whole container). */
  async transferAll(from: Owner, to: Owner, note = "loot all"): Promise<ItemInstance[]> {
    const items = await this.listByOwner(from);
    const moved: ItemInstance[] = [];
    for (const item of items) moved.push(await this.transfer({ instance_id: item.id, to, note }));
    return moved;
  }

  /** Removes `quantity` of a definition from an owner (using a key, drinking a potion). */
  async consume(owner: Owner, definitionId: string, quantity = 1, note = "consumed"): Promise<boolean> {
    const stacks = (await this.listByOwner(owner)).filter((s) => s.definition_id === definitionId);
    const available = stacks.reduce((sum, s) => sum + s.quantity, 0);
    if (available < quantity) return false;
    let remaining = quantity;
    const statements: Statement[] = [];
    for (const stack of stacks) {
      if (remaining <= 0) break;
      const take = Math.min(stack.quantity, remaining);
      remaining -= take;
      if (take === stack.quantity) statements.push({ sql: "DELETE FROM item_instances WHERE id = ?", params: [stack.id], expect_changes: 1 });
      else
        statements.push({
          sql: "UPDATE item_instances SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND quantity >= ?",
          params: [take, now(), stack.id, take],
          expect_changes: 1,
        });
      statements.push(this.logStatement(stack.campaign_id, { instance_id: stack.id, definition_id: definitionId, quantity: -take, from: owner, note }));
    }
    await this.db.batch(statements);
    return true;
  }

  private logStatement(
    campaignId: string,
    entry: { instance_id?: string; definition_id?: string; quantity: number; from?: Owner; to?: Owner; note: string },
  ): Statement {
    return {
      sql: `INSERT INTO inventory_log (id, campaign_id, at, instance_id, definition_id, quantity, from_type, from_id, to_type, to_id, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        newId(),
        campaignId,
        now(),
        entry.instance_id ?? null,
        entry.definition_id ?? null,
        entry.quantity,
        entry.from?.owner_type ?? null,
        entry.from?.owner_id ?? null,
        entry.to?.owner_type ?? null,
        entry.to?.owner_id ?? null,
        entry.note,
      ],
    };
  }

  async log(campaignId: string, limit = 100): Promise<InventoryLogEntry[]> {
    const rows = await this.db.select("SELECT * FROM inventory_log WHERE campaign_id = ? ORDER BY at DESC LIMIT ?", [campaignId, limit]);
    return rows.map((row) => ({
      id: String(row.id),
      campaign_id: String(row.campaign_id),
      at: text(row.at),
      instance_id: str(row.instance_id),
      definition_id: str(row.definition_id),
      quantity: num(row.quantity) ?? 0,
      from_type: str(row.from_type),
      from_id: str(row.from_id),
      to_type: str(row.to_type),
      to_id: str(row.to_id),
      note: text(row.note),
    }));
  }
}
