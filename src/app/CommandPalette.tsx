import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { KIND_LABELS } from "@/domain/types";
import { useRepos } from "./appContext";
import { useAppStore } from "./appStore";
import { qk, useCampaignId } from "./queries";
import { NAV_ITEMS, routeForEntity } from "./routes";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const recent = useAppStore((s) => s.recent);
  const pushRecent = useAppStore((s) => s.pushRecent);
  const navigate = useNavigate();
  const repos = useRepos();
  const campaignId = useCampaignId();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 120);
    return () => clearTimeout(id);
  }, [term]);
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const results = useQuery({
    queryKey: qk.search(campaignId, debounced),
    queryFn: () => repos.entities.search(campaignId, debounced, 25),
    enabled: open && debounced.trim().length > 1,
  });

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter={!debounced.trim()}
      className="fixed left-1/2 top-[12vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-bg-elevated shadow-2xl"
      overlayClassName="fixed inset-0 z-40 bg-black/50"
    >
      <Command.Input value={term} onValueChange={setTerm} placeholder="Search entities or jump to a module…" className="w-full border-b border-border bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-faint" />
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="p-4 text-center text-[12px] text-ink-faint">Nothing found.</Command.Empty>
        {results.data && results.data.length > 0 && (
          <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
            {results.data.map((hit) => (
              <Command.Item
                key={hit.entity.id}
                value={`${hit.entity.name} ${hit.entity.id}`}
                onSelect={() => {
                  pushRecent({ id: hit.entity.id, name: hit.entity.name, kind: hit.entity.kind });
                  go(routeForEntity(hit.entity));
                }}
                className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-[13px] data-[selected=true]:bg-bg-active"
              >
                <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">{KIND_LABELS[hit.entity.kind]}</span>
                <span className="truncate">{hit.entity.name}</span>
                <span className="ml-auto truncate text-[11px] text-ink-faint">{hit.snippet}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {!debounced.trim() && recent.length > 0 && (
          <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
            {recent.map((r) => (
              <Command.Item key={r.id} value={`recent ${r.name}`} onSelect={() => go(routeForEntity({ id: r.id, kind: r.kind as never, parent_id: null }))} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-[13px] data-[selected=true]:bg-bg-active">
                <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">{KIND_LABELS[r.kind as keyof typeof KIND_LABELS] ?? r.kind}</span>
                <span className="truncate">{r.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
          {NAV_ITEMS.map((item) => (
            <Command.Item key={item.to} value={`go ${item.label}`} onSelect={() => go(item.to)} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-[13px] data-[selected=true]:bg-bg-active">
              <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">Module</span>
              {item.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
