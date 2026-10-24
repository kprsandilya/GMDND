import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEntities } from "@/app/queries";
import { KIND_LABELS, type Entity, type EntityKind } from "@/domain/types";
import { cn } from "@/lib/utils";
import { Input } from "./ui";

/** Searchable dropdown over entities of the given kinds in the active campaign. */
export function EntityPicker({ kinds, value, onChange, allowNone, placeholder, exclude, className, includeGlobal }: { kinds: EntityKind[]; value: string | null; onChange: (id: string | null, entity: Entity | null) => void; allowNone?: boolean; placeholder?: string; exclude?: string[]; className?: string; includeGlobal?: boolean }) {
  const list = useEntities({ kinds, orderBy: "name", campaign_id: includeGlobal ? undefined : undefined });
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const items = useMemo(() => {
    const all = (list.data ?? []).filter((e) => !exclude?.includes(e.id));
    const t = term.trim().toLowerCase();
    return (t ? all.filter((e) => e.name.toLowerCase().includes(t)) : all).slice(0, 60);
  }, [list.data, term, exclude]);
  const selected = list.data?.find((e) => e.id === value);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => setBox(buttonRef.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const pick = (id: string | null, entity: Entity | null) => {
    onChange(id, entity);
    setOpen(false);
    setTerm("");
  };

  const menu =
    open && box
      ? createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[90] max-h-64 overflow-y-auto rounded border border-border-strong bg-bg-elevated shadow-xl"
              style={{ top: Math.min(box.bottom + 4, window.innerHeight - 80), left: box.left, width: Math.max(box.width, 220) }}
            >
              <div className="sticky top-0 bg-bg-elevated p-1">
                <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter…" />
              </div>
              {allowNone && (
                <button type="button" className="row-hover w-full px-2 py-1 text-left text-[12px] text-ink-faint" onClick={() => pick(null, null)}>
                  — none —
                </button>
              )}
              {items.map((e) => (
                <button key={e.id} type="button" className={cn("row-hover flex w-full items-center justify-between px-2 py-1 text-left text-[12.5px]", e.id === value && "row-active")} onClick={() => pick(e.id, e)}>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] uppercase text-ink-faint">{KIND_LABELS[e.kind]}</span>
                </button>
              ))}
              {items.length === 0 && <div className="p-2 text-[12px] text-ink-faint">{list.isLoading ? "Loading…" : "No matches."}</div>}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className={cn("relative", className)}>
      <button ref={buttonRef} type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cn("truncate", !selected && "text-ink-faint")}>{selected ? selected.name : (placeholder ?? "Select…")}</span>
        <span className="ml-2 text-[10px] text-ink-faint">{selected ? KIND_LABELS[selected.kind] : "▾"}</span>
      </button>
      {menu}
    </div>
  );
}
