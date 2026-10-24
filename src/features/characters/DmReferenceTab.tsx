import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { MarkdownView } from "@/components/Markdown";
import { EmptyState } from "@/components/ui";
import type { ExtendedTimelineEvent } from "@/domain/journeyTypes";
import { TIMELINE_EVENT_CATEGORY_LABELS } from "@/domain/journeyTypes";
import type { Entity, LinkedEntity } from "@/domain/types";

export function DmReferenceTab({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();

  const ref = useQuery({
    queryKey: ["journey", "dmRef", entity.id],
    queryFn: () => repos.journeys.dmReferenceData(entity.id, campaignId!),
    enabled: !!campaignId,
  });

  if (ref.isLoading) return <EmptyState title="Loading…" />;
  if (!ref.data) return <EmptyState title="No data available" />;

  const data = ref.data;

  return (
    <div className="space-y-5 p-4">
      {/* Character Summary */}
      <Section title="Character Summary">
        {data.characterSummary ? (
          <MarkdownView source={data.characterSummary} />
        ) : (
          <NoData />
        )}
      </Section>

      {/* Origin & Current Location */}
      <div className="grid grid-cols-2 gap-4">
        <Section title="Origin Location">
          {data.originLocation ? (
            <EntityLink id={data.originLocation.id} name={data.originLocation.name} kind="location" />
          ) : (
            <NoData />
          )}
        </Section>

        <Section title="Most Recent Location">
          {data.mostRecentLocation ? (
            <EntityLink id={data.mostRecentLocation.id} name={data.mostRecentLocation.name} kind="location" />
          ) : (
            <NoData label="No known location" />
          )}
        </Section>
      </div>

      {/* Last Session Appeared */}
      <Section title="Last Session Appeared">
        {data.lastSessionAppeared ? (
          <EntityLink id={data.lastSessionAppeared.id} name={data.lastSessionAppeared.name} kind="session" />
        ) : (
          <NoData />
        )}
      </Section>

      {/* Backstory Events */}
      <Section title="Backstory Events">
        {data.backstoryEvents.length > 0 ? (
          <EventList events={data.backstoryEvents} />
        ) : (
          <NoData label="No backstory events recorded" />
        )}
      </Section>

      {/* NPC Relationships */}
      <Section title="NPC Relationships">
        {data.npcRelationships.length > 0 ? (
          <LinkedEntityList links={data.npcRelationships} />
        ) : (
          <NoData label="No NPC relationships" />
        )}
      </Section>

      {/* Faction Affiliations */}
      <Section title="Faction Affiliations">
        {data.factionAffiliations.length > 0 ? (
          <LinkedEntityList links={data.factionAffiliations} />
        ) : (
          <NoData label="No faction affiliations" />
        )}
      </Section>

      {/* Active Quests */}
      <Section title="Active Quests">
        {data.activeQuests.length > 0 ? (
          <LinkedEntityList links={data.activeQuests} />
        ) : (
          <NoData label="No active quests" />
        )}
      </Section>

      {/* Items */}
      <Section title="Items">
        {data.items.length > 0 ? (
          <ul className="space-y-1">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-[13px]">
                <Link to={routeForEntity(item.definition)} className="text-ember-soft hover:underline">
                  {item.definition.name}
                </Link>
                {item.quantity > 1 && <span className="text-ink-faint">×{item.quantity}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <NoData label="No items" />
        )}
      </Section>

      {/* Known Secrets */}
      <Section title="Known Secrets">
        {data.knownSecrets ? (
          <MarkdownView source={data.knownSecrets} variant="secret" />
        ) : (
          <NoData label="No secrets recorded" />
        )}
      </Section>

      {/* Unresolved Plot Hooks */}
      <Section title="Unresolved Plot Hooks">
        {data.unresolvedPlotHooks.length > 0 ? (
          <EventList events={data.unresolvedPlotHooks} />
        ) : (
          <NoData label="No unresolved plot hooks" />
        )}
      </Section>
    </div>
  );
}

/* ── Internal sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      {children}
    </div>
  );
}

function NoData({ label = "No data available" }: { label?: string }) {
  return <p className="text-[12.5px] italic text-ink-faint">{label}</p>;
}

function EntityLink({ id, name, kind }: { id: string; name: string; kind: string }) {
  return (
    <Link to={routeForEntity({ id, kind: kind as Entity["kind"], parent_id: null })} className="text-[13px] text-ember-soft hover:underline">
      {name}
    </Link>
  );
}

function LinkedEntityList({ links }: { links: LinkedEntity[] }) {
  return (
    <ul className="space-y-1">
      {links.map((link) => (
        <li key={link.id} className="flex items-center gap-2 text-[13px]">
          <Link to={routeForEntity(link.entity)} className="text-ember-soft hover:underline">
            {link.entity.name}
          </Link>
          {link.relation && <span className="text-ink-faint">({link.relation})</span>}
          {link.note && <span className="text-ink-muted">— {link.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function EventList({ events }: { events: ExtendedTimelineEvent[] }) {
  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="rounded border border-border bg-bg px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{event.title}</span>
            <span className="text-[11px] text-ink-faint">{TIMELINE_EVENT_CATEGORY_LABELS[event.category]}</span>
            {event.year != null && (
              <span className="ml-auto text-[11px] text-ink-faint">
                {[event.year, event.month, event.day].filter((v) => v != null).join("/")}
              </span>
            )}
          </div>
          {event.body_md && (
            <div className="mt-1 text-[12px] text-ink-muted line-clamp-2">{event.body_md}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
