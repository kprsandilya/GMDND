import { useQuery } from "@tanstack/react-query";
import { Globe2, MapPin } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAction, useCampaignId, useEntities } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { Badge, Button } from "@/components/ui";
import { GEOGRAPHIC_KINDS, KIND_LABELS, type Entity } from "@/domain/types";
import { setPartyLocation } from "@/domain/workflows/campaignWorkflow";

export function LocationsPage() {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const navigate = useNavigate();
  const travel = useAction((id: string) => setPartyLocation(repos, campaignId!, id), { success: "Party location updated", invalidate: [["entities"], ["campaignState"], ["campaignLog"]] });

  return (
    <EntityWorkspace
      title="Locations"
      kinds={[...GEOGRAPHIC_KINDS, "shop"]}
      basePath="/locations"
      description="Worlds, continents, kingdoms, regions, settlements, districts, buildings and points of interest, nested by parent."
      rowMeta={(e) => e.summary || e.subtype || KIND_LABELS[e.kind]}
      overview={<LocationTree />}
      extras={{
        actions: (e) =>
          e.kind !== "world" ? (
            <Button variant="outline" size="sm" onClick={() => travel.mutate(e.id)}>
              <MapPin size={12} /> Party is here
            </Button>
          ) : null,
        tabs: [
          {
            value: "map",
            label: "Map refs",
            render: (e) => <MapRefs entity={e} onOpen={(mapId) => navigate(`/atlas/${mapId}?entity=${e.id}`)} />,
          },
        ],
      }}
    />
  );
}

function MapRefs({ entity, onOpen }: { entity: Entity; onOpen: (mapId: string) => void }) {
  const repos = useRepos();
  const links = useQuery({ queryKey: ["maps", "featureLinksForEntity", entity.id], queryFn: () => repos.worldMaps.featureLinksForEntity(entity.id) });
  const dungeons = useEntities({ kinds: ["dungeon"], parent_id: entity.id });
  return (
    <div className="space-y-3">
      <div>
        <div className="label">World map features</div>
        {(links.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">Not linked to any atlas feature. Open the World Atlas, select a feature and choose “Link to entity”.</div>}
        <ul className="space-y-1">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-[12.5px]">
              <Globe2 size={12} className="text-ink-faint" />
              <span>
                {l.feature_type} {l.feature_name ? `“${l.feature_name}”` : `#${l.feature_id}`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onOpen(l.map_id)}>
                Show on map
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="label">Dungeons & battle maps here</div>
        {(dungeons.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">No dungeons use this location as parent.</div>}
        <ul className="space-y-1">
          {(dungeons.data ?? []).map((d) => (
            <li key={d.id}>
              <Link to={`/dungeons/${d.id}`} className="text-[12.5px] text-ember-soft hover:underline">
                {d.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Indented hierarchy of all geographic entities for the module landing view. */
function LocationTree() {
  const all = useEntities({ kinds: [...GEOGRAPHIC_KINDS, "dungeon", "shop"], orderBy: "name" });
  const items = all.data ?? [];
  const byParent = new Map<string | null, Entity[]>();
  const ids = new Set(items.map((i) => i.id));
  for (const e of items) {
    const key = e.parent_id && ids.has(e.parent_id) ? e.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), e]);
  }
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (byParent.get(parent) ?? []).map((e) => (
      <div key={e.id}>
        <Link to={routeForEntity(e)} className="row-hover flex items-center gap-2 rounded px-2 py-1 text-[13px]" style={{ paddingLeft: 8 + depth * 16 }}>
          <span>{e.name}</span>
          <Badge>{KIND_LABELS[e.kind]}</Badge>
          {e.fields.discovered === true && <Badge tone="moss">discovered</Badge>}
        </Link>
        {render(e.id, depth + 1)}
      </div>
    ));
  return (
    <div className="overflow-y-auto p-4">
      <h2 className="mb-2 font-display text-lg text-ember-soft">World hierarchy</h2>
      <p className="mb-3 text-[12px] text-ink-muted">Every place is an entity; nesting comes from the “parent” relation. Pick one to edit it, link it to atlas features or attach dungeons.</p>
      {items.length === 0 ? <div className="text-ink-faint">No locations yet.</div> : render(null, 0)}
    </div>
  );
}
