import { Filter, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button, Checkbox, Tooltip } from "@/components/ui";
import { JOURNEY_CATEGORIES, JOURNEY_CATEGORY_LABELS, type JourneyCategory, type RouteFilters } from "@/domain/journeyTypes";
import { cn } from "@/lib/utils";

// ── Props ──

export interface JourneyFilterToolbarProps {
  filters: RouteFilters;
  onFiltersChange: (filters: RouteFilters) => void;
  /** Available characters (PCs + NPCs) for the campaign */
  characters: { id: string; name: string }[];
  /** Available parties for the campaign */
  parties: { id: string; name: string }[];
  /** Available sessions for the campaign */
  sessions: { id: string; name: string }[];
  /** Whether the filter combination returned zero segments */
  noResults?: boolean;
}

// ── Multi-select dropdown ──

function MultiSelectDropdown({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  // Close on outside click
  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
    },
    [],
  );

  const count = selected.length;

  return (
    <div ref={containerRef} className="relative" onBlur={onBlur}>
      <button
        type="button"
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded border px-2 text-[12px] transition-colors",
          count > 0
            ? "border-ember/50 bg-ember/10 text-ember-soft"
            : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {count > 0 && <span className="ml-0.5 rounded-full bg-ember/20 px-1.5 text-[10px] font-semibold">{count}</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-52 overflow-y-auto rounded-md border border-border-strong bg-bg-elevated shadow-lg">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-ink-faint">None available</div>
          ) : (
            <div className="p-1.5">
              {items.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="h-3.5 w-3.5 accent-ember"
                  />
                  <span className="truncate">{item.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category multi-select ──

function CategoryMultiSelect({
  selected,
  onChange,
}: {
  selected: JourneyCategory[];
  onChange: (cats: JourneyCategory[]) => void;
}) {
  const items = JOURNEY_CATEGORIES.map((c) => ({ id: c, name: JOURNEY_CATEGORY_LABELS[c] }));
  return (
    <MultiSelectDropdown
      label="Category"
      items={items}
      selected={selected}
      onChange={(ids) => onChange(ids as JourneyCategory[])}
    />
  );
}

// ── Toolbar ──

export function JourneyFilterToolbar({
  filters,
  onFiltersChange,
  characters,
  parties,
  sessions,
  noResults = false,
}: JourneyFilterToolbarProps) {
  const update = useCallback(
    (patch: Partial<RouteFilters>) => onFiltersChange({ ...filters, ...patch }),
    [filters, onFiltersChange],
  );

  const hasActiveFilters =
    (filters.characterIds && filters.characterIds.length > 0) ||
    (filters.partyIds && filters.partyIds.length > 0) ||
    (filters.sessionIds && filters.sessionIds.length > 0) ||
    (filters.categories && filters.categories.length > 0) ||
    filters.startDate != null ||
    filters.endDate != null ||
    filters.hideAll === true;

  const clearAll = () =>
    onFiltersChange({
      characterIds: undefined,
      partyIds: undefined,
      sessionIds: undefined,
      categories: undefined,
      startDate: undefined,
      endDate: undefined,
      hideAll: undefined,
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-bg-panel/80 px-2 py-1 backdrop-blur">
        <Filter size={13} className="shrink-0 text-ink-faint" />

        {/* Multi-select dropdowns */}
        <MultiSelectDropdown
          label="Character"
          items={characters}
          selected={filters.characterIds ?? []}
          onChange={(ids) => update({ characterIds: ids.length > 0 ? ids : undefined })}
        />
        <MultiSelectDropdown
          label="Party"
          items={parties}
          selected={filters.partyIds ?? []}
          onChange={(ids) => update({ partyIds: ids.length > 0 ? ids : undefined })}
        />
        <MultiSelectDropdown
          label="Session"
          items={sessions}
          selected={filters.sessionIds ?? []}
          onChange={(ids) => update({ sessionIds: ids.length > 0 ? ids : undefined })}
        />
        <CategoryMultiSelect
          selected={filters.categories ?? []}
          onChange={(cats) => update({ categories: cats.length > 0 ? cats : undefined })}
        />

        {/* Date range — year inputs */}
        <div className="flex items-center gap-1 text-[11px] text-ink-muted">
          <span>Year</span>
          <input
            type="number"
            placeholder="from"
            value={filters.startDate?.year ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              update({ startDate: v ? { year: Number(v) } : undefined });
            }}
            className="h-6 w-16 rounded border border-border bg-bg px-1.5 text-[11px] text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span>–</span>
          <input
            type="number"
            placeholder="to"
            value={filters.endDate?.year ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              update({ endDate: v ? { year: Number(v) } : undefined });
            }}
            className="h-6 w-16 rounded border border-border bg-bg px-1.5 text-[11px] text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>

        {/* Separator */}
        <div className="mx-0.5 h-4 w-px bg-border" />

        {/* Hide all toggle */}
        <Checkbox
          label="Hide all"
          checked={filters.hideAll ?? false}
          onChange={(v) => update({ hideAll: v || undefined })}
        />

        {/* Clear filters */}
        {hasActiveFilters && (
          <Tooltip content="Clear all filters">
            <Button size="sm" variant="ghost" onClick={clearAll} className="h-6 px-1.5">
              <X size={12} /> Clear
            </Button>
          </Tooltip>
        )}
      </div>

      {/* No results message */}
      {noResults && !filters.hideAll && (
        <div className="rounded border border-border bg-bg-panel/60 px-2 py-1 text-[11px] text-ink-faint">
          No routes match the current filters.
        </div>
      )}
    </div>
  );
}
