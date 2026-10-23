import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { qk, useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { Badge, Checkbox, Input, PageHeader } from "@/components/ui";
import { ENTITY_KINDS, KIND_LABELS, type EntityKind } from "@/domain/types";

export function SearchPage() {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kinds, setKinds] = useState<Set<EntityKind>>(new Set());
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(id);
  }, [term]);
  const results = useQuery({ queryKey: qk.search(campaignId, debounced), queryFn: () => repos.entities.search(campaignId, debounced, 200), enabled: debounced.trim().length > 1 });
  const hits = (results.data ?? []).filter((h) => kinds.size === 0 || kinds.has(h.entity.kind));
  const counts = new Map<EntityKind, number>();
  for (const h of results.data ?? []) counts.set(h.entity.kind, (counts.get(h.entity.kind) ?? 0) + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Global Search" subtitle="Searches names, summaries, descriptions, read-aloud text, DM notes, secrets and tags across the active campaign.">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type at least two characters…" className="h-10 pl-9 text-[14px]" />
        </div>
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
        <aside className="overflow-y-auto border-r border-border p-3">
          <div className="label">Filter by kind</div>
          {ENTITY_KINDS.filter((k) => counts.has(k)).map((k) => (
            <Checkbox
              key={k}
              label={`${KIND_LABELS[k]} (${counts.get(k)})`}
              checked={kinds.has(k)}
              onChange={(v) => {
                const next = new Set(kinds);
                if (v) next.add(k);
                else next.delete(k);
                setKinds(next);
              }}
              className="block py-0.5"
            />
          ))}
          {counts.size === 0 && <div className="text-[12px] text-ink-faint">No results to filter.</div>}
        </aside>
        <ul className="overflow-y-auto p-3">
          {hits.map((h) => (
            <li key={h.entity.id} className="mb-1 rounded border border-border p-2 hover:bg-bg-hover">
              <div className="flex items-center gap-2">
                <Link to={routeForEntity(h.entity)} className="font-display text-[15px] text-ember-soft hover:underline">
                  {h.entity.name}
                </Link>
                <Badge>{KIND_LABELS[h.entity.kind]}</Badge>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-faint">match in {h.field}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-ink-muted">{h.snippet}</div>
            </li>
          ))}
          {debounced.trim().length > 1 && hits.length === 0 && !results.isLoading && <li className="text-ink-faint">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
