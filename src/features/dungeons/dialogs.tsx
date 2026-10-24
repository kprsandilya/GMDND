import { Dices } from "lucide-react";
import { useEffect, useState } from "react";
import { useEntities } from "@/app/queries";
import { EntityPicker } from "@/components/EntityPicker";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";
import { d20 } from "@/domain/dice";
import type { Entity, Token } from "@/domain/types";

export interface RollRequest {
  title: string;
  ability: string;
  dc: number;
  defaultModifier?: number;
  resolve: (result: { roll: number; modifier: number } | null) => void;
}

/** Manual dice entry: the DM types (or quick-rolls) a d20 and a modifier. */
export function RollDialog({ request }: { request: RollRequest | null }) {
  const [roll, setRoll] = useState("");
  const [modifier, setModifier] = useState("0");
  useEffect(() => {
    setRoll("");
    setModifier(String(request?.defaultModifier ?? 0));
  }, [request]);
  if (!request) return null;
  const r = Number(roll);
  const m = Number(modifier) || 0;
  const valid = Number.isInteger(r) && r >= 1 && r <= 20;
  const total = valid ? r + m : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && request.resolve(null)}
      title={request.title}
      description={`${request.ability} check · DC ${request.dc}. Enter the player's d20 result; natural 20 always succeeds.`}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => request.resolve(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => request.resolve({ roll: r, modifier: m })}>
            Resolve {total !== null ? `(${total} vs DC ${request.dc})` : ""}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="d20 roll">
          <Input autoFocus type="number" min={1} max={20} value={roll} onChange={(e) => setRoll(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && request.resolve({ roll: r, modifier: m })} />
        </Field>
        <Field label="Modifier">
          <Input type="number" value={modifier} onChange={(e) => setModifier(e.target.value)} />
        </Field>
        <Button variant="outline" onClick={() => setRoll(String(d20()))} title="Roll for the DM">
          <Dices size={14} />
        </Button>
      </div>
      {valid && (
        <div className={`mt-3 text-center font-display text-lg ${total! >= request.dc || r === 20 ? "text-moss" : "text-blood"}`}>
          {total} — {total! >= request.dc || r === 20 ? "Success" : "Failure"}
        </div>
      )}
    </Dialog>
  );
}

/** Choose which character/creature a new token represents. */
export function PlaceTokenDialog({ cell, onClose, onPlace }: { cell: { x: number; y: number } | null; onClose: () => void; onPlace: (input: { name: string; kind: Token["kind"]; entity_id: string | null; hp: number | null; max_hp: number | null; speed: number; size: number; color: string | null }) => void }) {
  const [mode, setMode] = useState<"entity" | "custom">("entity");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Token["kind"]>("creature");
  const [hp, setHp] = useState("10");
  const [size, setSize] = useState("1");
  const pcs = useEntities({ kinds: ["pc"] });
  useEffect(() => {
    if (cell) {
      setEntityId(null);
      setEntity(null);
      setName("");
    }
  }, [cell]);
  if (!cell) return null;
  const place = () => {
    if (mode === "entity" && entity) {
      const f = entity.fields as Record<string, unknown>;
      const max = Number(f.max_hp ?? f.hp ?? 10) || 10;
      const sizeMap: Record<string, number> = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
      onPlace({ name: name.trim() || entity.name, kind: entity.kind === "pc" ? "pc" : entity.kind === "npc" ? "npc" : "creature", entity_id: entity.id, hp: Number(f.hp ?? max) || max, max_hp: max, speed: parseInt(String(f.speed ?? "30"), 10) || 30, size: sizeMap[String(f.size ?? "Medium")] ?? 1, color: null });
    } else {
      const h = Number(hp) || null;
      onPlace({ name: name.trim() || "Token", kind, entity_id: null, hp: h, max_hp: h, speed: 30, size: Math.max(1, Number(size) || 1), color: null });
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Place token at (${cell.x}, ${cell.y})`}
      width="max-w-md"
      footer={
        <Button variant="primary" disabled={mode === "entity" ? !entity : !name.trim()} onClick={place}>
          Place
        </Button>
      }
    >
      <div className="mb-3 flex gap-1">
        <Button size="sm" variant={mode === "entity" ? "primary" : "outline"} onClick={() => setMode("entity")}>
          From record
        </Button>
        <Button size="sm" variant={mode === "custom" ? "primary" : "outline"} onClick={() => setMode("custom")}>
          Custom
        </Button>
      </div>
      {mode === "entity" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(pcs.data ?? []).map((pc) => (
              <Button key={pc.id} size="sm" variant={entityId === pc.id ? "primary" : "outline"} onClick={() => { setEntityId(pc.id); setEntity(pc); }}>
                {pc.name}
              </Button>
            ))}
          </div>
          <Field label="Or pick any character / creature">
            <EntityPicker kinds={["pc", "npc", "creature"]} value={entityId} onChange={(id, e) => { setEntityId(id); setEntity(e); }} includeGlobal />
          </Field>
          <Field label="Token label (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={entity?.name ?? ""} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" className="col-span-2">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Token["kind"])}>
              <option value="creature">Creature</option>
              <option value="npc">NPC</option>
              <option value="pc">PC</option>
            </Select>
          </Field>
          <Field label="HP">
            <Input type="number" value={hp} onChange={(e) => setHp(e.target.value)} />
          </Field>
          <Field label="Size (cells)">
            <Input type="number" min={1} max={4} value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
