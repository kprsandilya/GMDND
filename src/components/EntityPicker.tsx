import { useMemo, useState } from "react";
import { useEntities } from "@/app/queries";
import { KIND_LABELS, type Entity, type EntityKind } from "@/domain/types";
import { cn } from "@/lib/utils";
import { Input } from "./ui";

/** Searchable dropdown over entities of the given kinds in the active campaign. */
export function EntityPicker({ kinds, value, onChange, allowNone, placeholder, exclude, className, includeGlobal }: { kinds: EntityKind[]; value: string | null; onChange: (id: string | null, entity: Entity | null) => void; allowNone?: boolean; placeholder?: string; exclude?: string[]; className?: string; includeGlobal?: boolean }) {
  const list = useEntities({ kinds, orderBy: "name", campaign_id: includeGlobal ? undefined : undefined });
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const items = useMemo(() => {
    const all = (list.data ?? []).filter((e) => !exclude?.includes(e.id));
    const t = term.trim().toLowerCase();
    return (t ? all.filter((e) => e.name.toLowerCase().includes(t)) : all).slice(0, 60);
  }, [list.data, term, exclude]);
  const selected = list.data?.find((e) => e.id === value);
  return (
    <div className={cn("relative", className)}>
      <button type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cn("truncate", !selected && "text-ink-faint")}>{selected ? selected.name : (placeholder ?? "Select…")}</span>
        <span className="ml-2 text-[10px] text-ink-faint">{selected ? KIND_LABELS[selected.kind] : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded border border-border-strong bg-bg-elevated shadow-xl">
          <div className="sticky top-0 bg-bg-elevated p-1">
            <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter…" />
          </div>
          {allowNone && (
            <button type="button" className="row-hover w-full px-2 py-1 text-left text-[12px] text-ink-faint" onClick={() => { onChange(null, null); setOpen(false); }}>
              — none —
            </button>
          )}
          {items.map((e) => (
            <button key={e.id} type="button" className={cn("row-hover flex w-full items-center justify-between px-2 py-1 text-left text-[12.5px]", e.id === value && "row-active")} onClick={() => { onChange(e.id, e); setOpen(false); setTerm(""); }}>
              <span className="truncate">{e.name}</span>
              <span className="ml-2 shrink-0 text-[10px] uppercase text-ink-faint">{KIND_LABELS[e.kind]}</span>
            </button>
          ))}
          {items.length === 0 && <div className="p-2 text-[12px] text-ink-faint">No matches.</div>}
        </div>
      )}
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
    </div>
  );
}
