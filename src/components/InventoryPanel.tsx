import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { qk, useAction, useEntities, useRequiredCampaignId } from "@/app/queries";
import type { ItemInstanceWithDefinition, OwnerType } from "@/domain/types";
import type { Owner } from "@/persistence/repositories/inventory";
import { EntityPicker } from "./EntityPicker";
import { Badge, Button, Dialog, Field, Input, Select } from "./ui";

export function useInventory(owner: Owner | null) {
  const repos = useRepos();
  return useQuery({
    queryKey: qk.inventory(owner?.owner_type ?? "none", owner?.owner_id ?? null),
    queryFn: () => repos.inventory.listByOwner(owner!),
    enabled: !!owner,
  });
}

const OWNER_TYPES: { value: OwnerType; label: string }[] = [
  { value: "character", label: "Character" },
  { value: "party", label: "Party pool" },
  { value: "room", label: "Room" },
  { value: "object", label: "Container / object" },
  { value: "shop", label: "Shop" },
  { value: "hoard", label: "Encounter hoard" },
  { value: "unassigned", label: "Unassigned" },
];

/** Lists item instances for an owner with grant, adjust, transfer and destroy actions. */
export function InventoryPanel({ owner, title, compact, sessionId }: { owner: Owner; title?: string; compact?: boolean; sessionId?: string | null }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const items = useInventory(owner);
  const [granting, setGranting] = useState(false);
  const [transferring, setTransferring] = useState<ItemInstanceWithDefinition | null>(null);
  const invalidate = [["inventory"]];

  const adjust = useAction(({ id, quantity }: { id: string; quantity: number }) => repos.inventory.setQuantity(id, quantity), { invalidate });
  const destroy = useAction((id: string) => repos.inventory.destroy(id), { success: "Item destroyed", invalidate });

  const total = (items.data ?? []).reduce((s, i) => s + i.quantity, 0);
  const weight = (items.data ?? []).reduce((s, i) => s + i.quantity * Number(i.definition.fields.weight ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="label mb-0">
          {title ?? "Inventory"} <span className="text-ink-faint">· {total} items · {weight.toFixed(1)} lb</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setGranting(true)}>
          <Plus size={12} /> Add item
        </Button>
      </div>
      {(items.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">Empty.</div>}
      <ul className="divide-y divide-border rounded border border-border">
        {(items.data ?? []).map((item) => (
          <li key={item.id} className="flex items-center gap-2 px-2 py-1 text-[12.5px]">
            <Link to={`/items/${item.definition.id}`} className="truncate text-ember-soft hover:underline">
              {item.definition.name}
            </Link>
            <Badge>{String(item.definition.fields.category ?? "item")}</Badge>
            {item.state.equipped === true && <Badge tone="moss">equipped</Badge>}
            {item.state.attuned === true && <Badge tone="violet">attuned</Badge>}
            {typeof item.state.charges === "number" && <Badge tone="gold">{item.state.charges} charges</Badge>}
            <span className="ml-auto flex items-center gap-1">
              {!compact && (
                <button className="text-ink-faint hover:text-ink" onClick={() => adjust.mutate({ id: item.id, quantity: item.quantity - 1 })} aria-label="Decrease">
                  <Minus size={11} />
                </button>
              )}
              <span className="w-8 text-center font-mono">×{item.quantity}</span>
              {!compact && (
                <button className="text-ink-faint hover:text-ink" onClick={() => adjust.mutate({ id: item.id, quantity: item.quantity + 1 })} aria-label="Increase">
                  <Plus size={11} />
                </button>
              )}
              <button className="ml-1 text-ink-faint hover:text-ink" onClick={() => setTransferring(item)} aria-label="Transfer">
                <ArrowRightLeft size={12} />
              </button>
              <button className="text-ink-faint hover:text-blood" onClick={() => destroy.mutate(item.id)} aria-label="Destroy">
                <Trash2 size={12} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <GrantDialog open={granting} onOpenChange={setGranting} owner={owner} campaignId={campaignId} />
      {transferring && <TransferDialog item={transferring} onClose={() => setTransferring(null)} sessionId={sessionId} />}
    </div>
  );
}

function GrantDialog({ open, onOpenChange, owner, campaignId }: { open: boolean; onOpenChange: (o: boolean) => void; owner: Owner; campaignId: string }) {
  const repos = useRepos();
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const grant = useAction(() => repos.inventory.grant(campaignId, definitionId!, quantity, owner, {}, "granted by DM"), {
    success: "Item added",
    invalidate: [["inventory"]],
    onSuccess: () => {
      onOpenChange(false);
      setDefinitionId(null);
      setQuantity(1);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add item instance"
      description="Creates a physical copy of an item definition in this inventory."
      footer={
        <Button variant="primary" disabled={!definitionId || grant.isPending} onClick={() => grant.mutate(undefined as never)}>
          Add
        </Button>
      }
    >
      <div className="space-y-2">
        <Field label="Item definition">
          <EntityPicker kinds={["item"]} value={definitionId} onChange={(id) => setDefinitionId(id)} />
        </Field>
        <Field label="Quantity">
          <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
        </Field>
      </div>
    </Dialog>
  );
}

export function TransferDialog({ item, onClose, sessionId }: { item: ItemInstanceWithDefinition; onClose: () => void; sessionId?: string | null }) {
  const repos = useRepos();
  const [ownerType, setOwnerType] = useState<OwnerType>("character");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(item.quantity);
  const needsId = ownerType === "character" || ownerType === "room" || ownerType === "shop" || ownerType === "hoard";
  const kindsFor: Record<string, Parameters<typeof EntityPicker>[0]["kinds"]> = { character: ["pc", "npc"], room: ["room"], shop: ["shop"], hoard: ["encounter"] };
  const objects = useQuery({ queryKey: ["allObjects", item.campaign_id], queryFn: () => repos.dungeons.objectsForCampaign(item.campaign_id), enabled: ownerType === "object" });
  const move = useAction(
    () => repos.inventory.transfer({ instance_id: item.id, quantity, to: { owner_type: ownerType, owner_id: needsId || ownerType === "object" ? ownerId : null }, note: "DM transfer", session_id: sessionId ?? null }),
    { success: `Moved ${quantity} × ${item.definition.name}`, invalidate: [["inventory"]], onSuccess: onClose },
  );
  void useEntities; // keep import for picker kinds typing
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Transfer ${item.definition.name}`}
      description="Transfers are atomic: the stack is split or merged, never duplicated."
      footer={
        <Button variant="primary" disabled={((needsId || ownerType === "object") && !ownerId) || move.isPending} onClick={() => move.mutate(undefined as never)}>
          Transfer
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Destination type">
          <Select value={ownerType} onChange={(e) => { setOwnerType(e.target.value as OwnerType); setOwnerId(null); }}>
            {OWNER_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity">
          <Input type="number" min={1} max={item.quantity} value={quantity} onChange={(e) => setQuantity(Math.min(item.quantity, Math.max(1, Number(e.target.value))))} />
        </Field>
        {needsId && (
          <Field label="Destination" className="col-span-2">
            <EntityPicker kinds={kindsFor[ownerType]!} value={ownerId} onChange={(id) => setOwnerId(id)} />
          </Field>
        )}
        {ownerType === "object" && (
          <Field label="Container" className="col-span-2">
            <Select value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value || null)}>
              <option value="">Select a map object…</option>
              {(objects.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.kind})
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
