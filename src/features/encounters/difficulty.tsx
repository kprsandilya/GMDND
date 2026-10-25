import { useQuery } from "@tanstack/react-query";
import { Gem, Save } from "lucide-react";
import { useRepos } from "@/app/appContext";
import { qk, useAction, useEntities } from "@/app/queries";
import { useInventory } from "@/components/InventoryPanel";
import { Badge, Button, Field, Select } from "@/components/ui";
import { assessWithRules, type BudgetRules, type EncounterBand, type EncounterBudget } from "@/domain/statblock";
import type { Entity } from "@/domain/types";

export const BAND_TONE: Record<EncounterBand, "blood" | "ember" | "moss" | "gold"> = {
  deadly: "blood",
  hard: "ember",
  medium: "gold",
  easy: "moss",
  trivial: "moss",
};

const BAND_LABEL_2024: Record<EncounterBand, string> = {
  trivial: "below low",
  easy: "low",
  medium: "moderate",
  hard: "high",
  deadly: "beyond high",
};

export function bandLabel(rules: BudgetRules, band: EncounterBand): string {
  return rules === "2024" ? BAND_LABEL_2024[band] : band;
}

export interface EncounterBudgetInfo {
  rules: BudgetRules;
  partyId: string;
  partyLevels: number[];
  partyNames: string[];
  budget: EncounterBudget;
  enemyCount: number;
  loading: boolean;
}

/**
 * Difficulty of an encounter template against a party. Only the enemy side counts towards monster XP;
 * the party is either a chosen party record (its current members) or every PC in the campaign.
 */
export function useEncounterBudget(encounter: Entity): EncounterBudgetInfo {
  const repos = useRepos();
  const rules: BudgetRules = encounter.fields.budget_rules === "2024" ? "2024" : "2014";
  const partyId = typeof encounter.fields.budget_party_id === "string" ? encounter.fields.budget_party_id : "";
  const participants = useQuery({ queryKey: qk.participants(encounter.id), queryFn: () => repos.encounters.participants(encounter.id) });
  const ids = (participants.data ?? []).map((p) => p.entity_id).filter((x): x is string => !!x);
  const defs = useQuery({ queryKey: ["entities", "many", ids], queryFn: () => repos.entities.getMany(ids), enabled: ids.length > 0 });
  const allPcs = useEntities({ kinds: ["pc"] });
  const members = useQuery({
    queryKey: ["entities", "partyMembers", partyId],
    queryFn: async () => {
      const memberships = await repos.journeys.activeMemberships(partyId);
      return repos.entities.getMany(memberships.map((m) => m.entity_id));
    },
    enabled: !!partyId,
  });
  const party = partyId ? (members.data ?? []) : (allPcs.data ?? []);
  const partyLevels = party.filter((p) => p.kind === "pc" || p.kind === "npc").map((p) => Number(p.fields.level ?? 1) || 1);
  const enemies = (participants.data ?? []).filter((p) => p.side === "enemy");
  const monsterXp = enemies.reduce((sum, p) => sum + p.count * Number(defs.data?.find((e) => e.id === p.entity_id)?.fields.xp ?? 0), 0);
  const enemyCount = enemies.reduce((s, p) => s + p.count, 0);
  return {
    rules,
    partyId,
    partyLevels,
    partyNames: party.map((p) => p.name),
    budget: assessWithRules(rules, monsterXp, enemyCount, partyLevels),
    enemyCount,
    loading: participants.isLoading || defs.isLoading || members.isLoading,
  };
}

export function DifficultyPanel({ encounter }: { encounter: Entity }) {
  const repos = useRepos();
  const info = useEncounterBudget(encounter);
  const parties = useEntities({ kinds: ["party"] });
  const { budget, rules } = info;
  const setFields = useAction((patch: Record<string, unknown>) => repos.entities.update(encounter.id, { fields: { ...encounter.fields, ...patch } }), {});
  const saved = encounter.fields.difficulty === budget.band && Number(encounter.fields.xp_total ?? 0) === budget.adjustedXp;
  return (
    <div className="space-y-2 rounded border border-border bg-bg-elevated p-2 text-[12px]">
      <div className="flex flex-wrap items-end gap-2">
        <div className="font-semibold text-ember-soft">Difficulty</div>
        <Field label="Rules" className="ml-auto w-28">
          <Select value={rules} onChange={(e) => setFields.mutate({ budget_rules: e.target.value })}>
            <option value="2014">2014 DMG</option>
            <option value="2024">2024 DMG</option>
          </Select>
        </Field>
        <Field label="Against" className="w-48">
          <Select value={info.partyId} onChange={(e) => setFields.mutate({ budget_party_id: e.target.value || null })}>
            <option value="">All PCs in the campaign</option>
            {(parties.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="text-ink-muted">
        {info.partyLevels.length === 0 ? (
          <span className="text-gold">No party members with a level — add PCs or pick a party.</span>
        ) : (
          <>
            {info.partyLevels.length} character(s), levels {info.partyLevels.join(", ")}
            {info.partyNames.length > 0 && <span className="text-ink-faint"> · {info.partyNames.join(", ")}</span>}
          </>
        )}
      </div>
      <div className="text-ink-muted">
        Enemy XP {budget.monsterXp}
        {rules === "2014" && (
          <>
            {" "}× {budget.multiplier} ({info.enemyCount} enemies) = <span className="text-ink">{budget.adjustedXp} adjusted</span>
          </>
        )}
        {" · "}
        {rules === "2014"
          ? `easy ${budget.party.easy} / medium ${budget.party.medium} / hard ${budget.party.hard} / deadly ${budget.party.deadly}`
          : `low ${budget.party.easy} / moderate ${budget.party.medium} / high ${budget.party.hard}`}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={BAND_TONE[budget.band]}>{bandLabel(rules, budget.band)}</Badge>
        {budget.party.hard > 0 && <BudgetBar budget={budget} />}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={saved || info.loading}
          onClick={() => setFields.mutate({ difficulty: budget.band, xp_total: budget.adjustedXp })}
          title="Write this difficulty and XP onto the template"
        >
          <Save size={11} /> {saved ? "Saved on template" : "Save to template"}
        </Button>
      </div>
      <p className="text-[11px] text-ink-faint">Only the enemy side counts. Catalog XP only — changing a combatant mid-fight does not rewrite this template.</p>
    </div>
  );
}

function BudgetBar({ budget }: { budget: EncounterBudget }) {
  const top = Math.max(budget.party.deadly, budget.adjustedXp) || 1;
  const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`;
  return (
    <div className="relative h-2 flex-1 overflow-hidden rounded bg-bg" title={`${budget.adjustedXp} XP`}>
      <div className="absolute inset-y-0 left-0 bg-ember/70" style={{ width: pct(budget.adjustedXp) }} />
      {[budget.party.easy, budget.party.medium, budget.party.hard, budget.party.deadly].map((t, i) => (
        <div key={i} className="absolute inset-y-0 w-px bg-ink-faint" style={{ left: pct(t) }} />
      ))}
    </div>
  );
}

/** One-line summary of an encounter's treasure hoard, for headers. */
export function HoardSummary({ encounterId }: { encounterId: string }) {
  const hoard = useInventory({ owner_type: "hoard", owner_id: encounterId });
  const items = hoard.data ?? [];
  if (items.length === 0) return <span className="text-ink-faint">No hoard</span>;
  const gp = items.reduce((s, i) => s + i.quantity * Number(i.definition.fields.value_gp ?? 0), 0);
  return (
    <span className="flex items-center gap-1 text-gold" title={items.map((i) => `${i.quantity}× ${i.definition.name}`).join(", ")}>
      <Gem size={11} /> {items.length} hoard item{items.length === 1 ? "" : "s"}
      {gp > 0 ? ` · ${gp} gp` : ""}
    </span>
  );
}
