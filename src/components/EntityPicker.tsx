import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEntities } from "@/app/queries";
import { KIND_LABELS, type Entity, type EntityKind } from "@/domain/types";
import { cn } from "@/lib/utils";
import { Input } from "./ui";

/** Rows rendered at once; beyond this the footer asks to filter (keeps huge SRD lists fast). */
const MAX_ROWS = 300;
const MENU_MAX = 320;

/** Opens below the field, or above it when there is clearly more room there; never runs off-screen. */
function menuPosition(box: DOMRect): React.CSSProperties {
  const below = window.innerHeight - box.bottom - 8;
  const above = box.top - 8;
  const width = Math.max(box.width, 220);
  const left = Math.min(box.left, window.innerWidth - width - 8);
  if (below < 200 && above > below) return { bottom: window.innerHeight - box.top + 4, left, width, maxHeight: Math.min(MENU_MAX, above) };
  return { top: box.bottom + 4, left, width, maxHeight: Math.min(MENU_MAX, Math.max(120, below)) };
}

/** Searchable dropdown over entities of the given kinds in the active campaign. */
export function EntityPicker({ kinds, value, onChange, allowNone, placeholder, exclude, className, includeGlobal }: { kinds: EntityKind[]; value: string | null; onChange: (id: string | null, entity: Entity | null) => void; allowNone?: boolean; placeholder?: string; exclude?: string[]; className?: string; includeGlobal?: boolean }) {
  // Always scoped to the active campaign (useEntities applies the current campaign_id). When
  // `includeGlobal` is set, the shared standard library (campaign_id IS NULL, e.g. SRD records)
  // is included as well — used by pickers that choose item/creature templates.
  const list = useEntities({ kinds, orderBy: "name", include_shared: includeGlobal });
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const matches = useMemo(() => {
    const all = (list.data ?? []).filter((e) => !exclude?.includes(e.id));
    const t = term.trim().toLowerCase();
    return t ? all.filter((e) => e.name.toLowerCase().includes(t)) : all;
  }, [list.data, term, exclude]);
  const items = matches.slice(0, MAX_ROWS);

  // A modal dialog locks page scrolling by cancelling wheel/touch events at the document. This menu is
  // portaled outside the dialog, so stop those events here or the list cannot be scrolled.
  const menuRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const stop = (e: Event) => e.stopPropagation();
    node.addEventListener("wheel", stop, { passive: true });
    node.addEventListener("touchmove", stop, { passive: true });
  }, []);
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
          {/* pointer-events-auto escapes the `pointer-events: none` that a modal Radix Dialog
                applies to <body> while open; without it this portaled menu is visible but unclickable. */}
          <div className="pointer-events-auto fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            className="pointer-events-auto fixed z-[90] overflow-y-auto overscroll-contain rounded border border-border-strong bg-bg-elevated shadow-xl"
            style={menuPosition(box)}
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
            {matches.length > items.length && (
              <div className="border-t border-border px-2 py-1 text-[11px] text-ink-faint">
                Showing {items.length} of {matches.length} — type to narrow the list.
              </div>
            )}
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
