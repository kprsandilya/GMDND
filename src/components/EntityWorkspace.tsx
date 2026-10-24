import { Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useAppStore } from "@/app/appStore";
import { useEntities } from "@/app/queries";
import { KIND_LABELS, type Entity, type EntityKind } from "@/domain/types";
import { cn } from "@/lib/utils";
import { CreateEntityDialog } from "./EntityForm";
import { EntityDetail, type DetailExtras } from "./EntityDetail";
import { Badge, Button, EmptyState, Input, Select, SplitPane } from "./ui";

export interface WorkspaceProps {
  title: string;
  kinds: EntityKind[];
  basePath: string;
  description?: string;
  extras?: DetailExtras;
  /** Secondary line in list rows. */
  rowMeta?: (e: Entity) => ReactNode;
  /** Group rows (default: by kind when more than one kind). */
  groupBy?: (e: Entity) => string;
  emptyHint?: string;
  /** Rendered in the right pane when nothing is selected. */
  overview?: ReactNode;
  /**
   * When true, the list also includes the shared standard library (SRD-2024) and shows a
   * Standard/Custom source filter. Used by Creatures and Items & Equipment.
   */
  library?: boolean;
}

type SourceFilter = "all" | "custom" | "standard";

/** Master/detail layout shared by most modules: filterable list on the left, EntityDetail on the right. */
export function EntityWorkspace({ title, kinds, basePath, description, extras, rowMeta, groupBy, emptyHint, overview, library }: WorkspaceProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const width = useAppStore((s) => s.settings.listPanelWidth);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [term, setTerm] = useState("");
  const [kindFilter, setKindFilter] = useState<EntityKind | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [creating, setCreating] = useState(false);
  const list = useEntities({
    kinds: kindFilter === "all" ? kinds : [kindFilter],
    orderBy: "name",
    include_shared: library,
    source: library ? sourceFilter : undefined,
  });

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    const items = list.data ?? [];
    return t ? items.filter((e) => e.name.toLowerCase().includes(t) || e.summary.toLowerCase().includes(t) || e.tags.some((tag) => tag.toLowerCase().includes(t))) : items;
  }, [list.data, term]);

  const groups = useMemo(() => {
    const fn = groupBy ?? (kinds.length > 1 ? (e: Entity) => KIND_LABELS[e.kind] : null);
    if (!fn) return [{ label: null as string | null, items: filtered }];
    const map = new Map<string, Entity[]>();
    for (const e of filtered) {
      const key = fn(e);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }, [filtered, groupBy, kinds.length]);

  return (
    <>
      <SplitPane
        width={width}
        onWidthChange={(w) => updateSettings({ listPanelWidth: w })}
        left={
          <>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
              <h2 className="font-display text-[15px] text-ember-soft">{title}</h2>
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={12} /> New
              </Button>
            </div>
            <div className="flex shrink-0 gap-1.5 border-b border-border p-2">
              <div className="relative flex-1">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter…" className="pl-6" />
              </div>
              {kinds.length > 1 && (
                <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as EntityKind | "all")} className="w-28">
                  <option value="all">All kinds</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
              {library && (
                <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} className="w-28" title="Filter by source">
                  <option value="all">All sources</option>
                  <option value="custom">Custom</option>
                  <option value="standard">Standard (SRD)</option>
                </Select>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && !list.isLoading && <div className="p-4 text-center text-[12px] text-ink-faint">{emptyHint ?? "Nothing here yet."}</div>}
              {groups.map((g) => (
                <div key={g.label ?? "_"}>
                  {g.label && <div className="sticky top-0 bg-bg-elevated px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</div>}
                  {g.items.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => navigate(`${basePath}/${e.id}`)}
                      className={cn("row-hover block w-full px-3 py-1.5 text-left", e.id === id && "row-active")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px]">{e.name}</span>
                        {library && typeof e.fields.source === "string" && e.fields.source && (
                          <Badge tone="gold" className="ml-auto">SRD</Badge>
                        )}
                        {e.subtype && <Badge className={library && e.fields.source ? "" : "ml-auto"}>{e.subtype}</Badge>}
                      </div>
                      <div className="truncate text-[11px] text-ink-faint">{rowMeta ? rowMeta(e) : e.summary}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-ink-faint">{filtered.length} shown</div>
          </>
        }
        right={
          id ? (
            <EntityDetail id={id} kinds={kinds} extras={extras} afterDelete={() => navigate(basePath)} />
          ) : (
            (overview ?? <EmptyState title={title} body={description ?? "Select an entry on the left, or create a new one."} action={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={13} /> New {kinds.length === 1 ? KIND_LABELS[kinds[0]!] : "entry"}</Button>} />)
          )
        }
      />
      <CreateEntityDialog open={creating} onOpenChange={setCreating} kinds={kinds} onCreated={(e) => navigate(`${basePath}/${e.id}`)} />
    </>
  );
}
