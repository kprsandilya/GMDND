import { useQuery } from "@tanstack/react-query";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { Badge } from "@/components/ui";
import type { Entity } from "@/domain/types";

export function CreaturesPage() {
  return (
    <EntityWorkspace
      title="Creatures"
      kinds={["creature"]}
      basePath="/creatures"
      library
      description="Monster and NPC stat block templates. The standard SRD 2024 bestiary is available in every campaign; your own creatures are 'Custom'. Encounters reference these; combat changes only the instance, never the template."
      rowMeta={(e) => `CR ${e.fields.cr ?? "?"} · ${e.fields.size ?? ""} ${e.fields.type ?? ""}`}
      extras={{ banner: (e) => <CreatureBanner entity={e} /> }}
    />
  );
}

function CreatureBanner({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const f = entity.fields;
  const usage = useQuery({
    queryKey: ["encounters", "usage", entity.id],
    queryFn: async () => {
      const encounters = await repos.entities.list({ campaign_id: campaignId, kinds: ["encounter"] });
      let n = 0;
      for (const enc of encounters) {
        const parts = await repos.encounters.participants(enc.id);
        if (parts.some((p) => p.entity_id === entity.id)) n++;
      }
      return n;
    },
  });
  const stat = (label: string, value: unknown) => (
    <div className="rounded border border-border bg-bg px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-[14px] font-semibold">{String(value ?? "—")}</div>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-bg-elevated px-4 py-2">
      {stat("AC", f.ac)}
      {stat("Initiative", f.initiative ?? "—")}
      {stat("HP", `${f.hp ?? "?"}${f.hp_formula ? ` (${f.hp_formula})` : ""}`)}
      {stat("Speed", f.speed)}
      {stat("Prof.", f.proficiency_bonus != null ? `+${f.proficiency_bonus}` : "—")}
      {stat("CR", `${f.cr ?? "?"} (${f.xp ?? 0} XP)`)}
      <Badge className="ml-auto">{usage.data ?? 0} encounter(s) use this template</Badge>
    </div>
  );
}
