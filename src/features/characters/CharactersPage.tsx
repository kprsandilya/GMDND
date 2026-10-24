import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { Badge } from "@/components/ui";
import type { Entity } from "@/domain/types";
import { DmReferenceTab } from "./DmReferenceTab";
import { JourneyTimelineTab } from "./JourneyTimelineTab";

export function CharactersPage() {
  return (
    <EntityWorkspace
      title="Characters & NPCs"
      kinds={["pc", "npc"]}
      basePath="/characters"
      description="Player characters and non-player characters with stats, motives, secrets, relationships and inventories."
      rowMeta={(e) => [e.fields.race, e.fields.class, e.fields.level ? `L${e.fields.level}` : null, e.fields.occupation].filter(Boolean).join(" · ") || e.summary}
      extras={{
        tabs: [
          { value: "tokens", label: "On maps", render: (e) => <TokenRefs entity={e} /> },
          { value: "journey", label: "Journey & Timeline", render: (e) => <JourneyTimelineTab entity={e} /> },
          { value: "dmref", label: "DM Reference", render: (e) => <DmReferenceTab entity={e} /> },
        ],
        banner: (e) => <StatBanner entity={e} />,
      }}
    />
  );
}

function StatBanner({ entity }: { entity: Entity }) {
  const f = entity.fields;
  const stat = (label: string, value: unknown) => (
    <div className="rounded border border-border bg-bg px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-[14px] font-semibold">{String(value ?? "—")}</div>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border bg-bg-elevated px-4 py-2">
      {stat("AC", f.ac)}
      {stat("Initiative", f.initiative ?? "—")}
      {stat("Speed", `${f.speed ?? 30} ft`)}
      {stat("HP", `${f.hp ?? "?"}/${f.max_hp ?? "?"}`)}
      {stat("Prof.", f.proficiency_bonus != null ? `+${f.proficiency_bonus}` : "—")}
      {stat("Passive Perc.", f.passive_perception)}
      {entity.kind === "npc" && (
        <div className="ml-auto flex items-center gap-1">
          <Badge tone={f.attitude === "hostile" ? "blood" : f.attitude === "friendly" ? "moss" : "default"}>{String(f.attitude ?? "neutral")}</Badge>
          {typeof f.motive === "string" && f.motive && <span className="text-[12px] italic text-ink-muted">“{f.motive}”</span>}
        </div>
      )}
      {entity.kind === "pc" && typeof f.player_name === "string" && f.player_name && <div className="ml-auto text-[12px] text-ink-muted">Player: {f.player_name}</div>}
    </div>
  );
}

function TokenRefs({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const tokens = useQuery({ queryKey: ["dungeon", "tokensForEntity", entity.id], queryFn: () => repos.dungeons.tokensForEntity(entity.id) });
  const floors = useQuery({
    queryKey: ["dungeon", "floorsFor", (tokens.data ?? []).map((t) => t.floor_id)],
    queryFn: async () => Promise.all([...new Set((tokens.data ?? []).map((t) => t.floor_id))].map((id) => repos.dungeons.getFloor(id))),
    enabled: (tokens.data ?? []).length > 0,
  });
  if ((tokens.data ?? []).length === 0) return <div className="text-[12px] text-ink-faint">No tokens on any battle map. Place one from the dungeon editor's Tokens tool.</div>;
  return (
    <ul className="space-y-1">
      {tokens.data!.map((t) => {
        const floor = floors.data?.find((f) => f.id === t.floor_id);
        return (
          <li key={t.id} className="text-[12.5px]">
            <Link to={`/dungeons/${floor?.dungeon_id ?? ""}?floor=${t.floor_id}&token=${t.id}`} className="text-ember-soft hover:underline">
              {floor?.name ?? "Floor"} — cell ({t.x}, {t.y})
            </Link>
            <span className="ml-2 text-ink-faint">
              HP {t.hp ?? "?"}/{t.max_hp ?? "?"} · moved {t.movement_used}/{t.speed} ft
            </span>
          </li>
        );
      })}
    </ul>
  );
}
