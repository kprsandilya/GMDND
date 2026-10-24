import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityWorkspace, type WorkspaceFilter } from "@/components/EntityWorkspace";
import { Badge } from "@/components/ui";
import { ITEM_RARITIES } from "@/domain/schemas";
import type { Entity, ItemInstance } from "@/domain/types";

const field = (e: Entity, key: string): string => {
  const v = e.fields[key];
  return v === null || v === undefined ? "" : String(v).trim();
};

const RARITY_ORDER = new Map(ITEM_RARITIES.map((r, i) => [r, i] as const));

const ITEM_FILTERS: WorkspaceFilter[] = [
  { key: "category", label: "category", get: (e) => (e.kind === "item" ? field(e, "category") : "") },
  {
    key: "rarity",
    label: "rarity",
    get: (e) => (e.kind === "item" ? field(e, "rarity") : ""),
    sort: (a, b) => (RARITY_ORDER.get(a as never) ?? 99) - (RARITY_ORDER.get(b as never) ?? 99),
  },
  {
    key: "magical",
    label: "type",
    get: (e) => (e.kind === "item" ? (e.fields.magical ? "Magical" : "Mundane") : ""),
    options: [
      { value: "Magical", label: "Magical" },
      { value: "Mundane", label: "Mundane" },
    ],
  },
];

export function ItemsPage() {
  return (
    <EntityWorkspace
      title="Items & Equipment"
      kinds={["item", "spell"]}
      basePath="/items"
      library
      filters={ITEM_FILTERS}
      description="Item definitions are templates. The standard SRD 2024 items and magic items are available in every campaign; your own entries are 'Custom'. Physical copies live as instances in character, room, container, shop or hoard inventories."
      rowMeta={(e) => (e.kind === "item" ? `${e.fields.category ?? ""} · ${e.fields.rarity ?? ""}${e.fields.magical ? " · magical" : ""}` : `Level ${e.fields.level ?? 0} ${e.fields.school ?? ""}`)}
      extras={{
        tabs: [{ value: "instances", label: "Instances", render: (e) => <Instances entity={e} /> }],
        banner: (e) =>
          e.kind === "item" ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-bg-elevated px-4 py-2 text-[12px] text-ink-muted">
              <Badge tone="gold">{String(e.fields.rarity ?? "common")}</Badge>
              <Badge>{String(e.fields.category ?? "equipment")}</Badge>
              {e.fields.damage ? <span>{String(e.fields.damage)} {String(e.fields.damage_type ?? "")}</span> : null}
              {e.fields.armor_class ? <span>AC {String(e.fields.armor_class)}</span> : null}
              <span className="ml-auto">
                {String(e.fields.weight ?? 0)} lb · {String(e.fields.value_gp ?? 0)} gp{e.fields.attunement ? " · requires attunement" : ""}
              </span>
            </div>
          ) : null,
      }}
    />
  );
}

function Instances({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const instances = useQuery({ queryKey: ["inventory", "definition", entity.id], queryFn: () => repos.inventory.listForDefinition(entity.id) });
  const owners = useQuery({
    queryKey: ["inventory", "owners", (instances.data ?? []).map((i) => i.owner_id)],
    queryFn: async () => {
      const ids = [...new Set((instances.data ?? []).map((i) => i.owner_id).filter((x): x is string => !!x))];
      const entities = await repos.entities.getMany(ids);
      const objects = (await repos.dungeons.objectsForCampaign(campaignId!)).filter((o) => ids.includes(o.id));
      return { entities, objects };
    },
    enabled: (instances.data ?? []).length > 0,
  });
  const describe = (i: ItemInstance) => {
    const ent = owners.data?.entities.find((e) => e.id === i.owner_id);
    if (ent) return <Link to={routeForEntity(ent)} className="text-ember-soft hover:underline">{ent.name}</Link>;
    const obj = owners.data?.objects.find((o) => o.id === i.owner_id);
    if (obj) return <span>{obj.name} (map object)</span>;
    return <span className="text-ink-faint">{i.owner_type}</span>;
  };
  const total = (instances.data ?? []).reduce((s, i) => s + i.quantity, 0);
  return (
    <div>
      <div className="label">
        {total} in existence across {(instances.data ?? []).length} stack(s)
      </div>
      <ul className="divide-y divide-border rounded border border-border">
        {(instances.data ?? []).map((i) => (
          <li key={i.id} className="flex items-center gap-2 px-2 py-1 text-[12.5px]">
            <span className="w-8 font-mono">×{i.quantity}</span>
            <span className="w-20 text-[10px] uppercase tracking-wide text-ink-faint">{i.owner_type}</span>
            {describe(i)}
            {Object.keys(i.state).length > 0 && <span className="ml-auto font-mono text-[10px] text-ink-faint">{JSON.stringify(i.state)}</span>}
          </li>
        ))}
        {(instances.data ?? []).length === 0 && <li className="p-2 text-[12px] text-ink-faint">No instances yet. Add one from a character's, room's or shop's inventory tab.</li>}
      </ul>
    </div>
  );
}
