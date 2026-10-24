import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { Badge, Button, Select } from "@/components/ui";
import type { EnrichedMembership, EnrichedSegment, Journey } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS } from "@/domain/journeyTypes";
import type { Entity } from "@/domain/types";
import { formatPartialDate, formatJourneyDateRange, filterSegmentsByMember } from "@/features/journeyUtils";
import { JourneyEditor } from "@/features/journeys/JourneyEditor";

export function PartiesPage() {
  return (
    <EntityWorkspace
      title="Parties"
      kinds={["party"]}
      basePath="/parties"
      description="Named groups of characters whose membership can change over time."
      rowMeta={(e) => e.summary || "No summary"}
      extras={{
        tabs: [
          { value: "membership", label: "Membership", render: (e) => <MembershipTab entity={e} /> },
          { value: "journeys", label: "Journeys", render: (e) => <JourneysTab entity={e} /> },
        ],
      }}
    />
  );
}

// ── Membership Tab ──

function MembershipTab({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const memberships = useQuery({
    queryKey: ["journeys", "memberships", entity.id],
    queryFn: () => repos.journeys.membershipsForParty(entity.id),
  });

  const all = memberships.data ?? [];
  const current = all.filter((m) => m.left_session_id == null && m.left_year == null);
  const past = all.filter((m) => m.left_session_id != null || m.left_year != null);

  if (memberships.isLoading) return <div className="text-[12px] text-ink-faint">Loading…</div>;

  if (all.length === 0) {
    return (
      <div className="text-[12px] text-ink-faint">
        No members yet. Add characters to this party from the Links tab or through the journey editor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {current.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Current members</h3>
          <ul className="space-y-1">
            {current.map((m) => (
              <MemberRow key={m.id} membership={m} />
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Past members</h3>
          <ul className="space-y-1">
            {past.map((m) => (
              <MemberRow key={m.id} membership={m} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MemberRow({ membership }: { membership: EnrichedMembership }) {
  const m = membership;
  return (
    <li className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-[12.5px]">
      <Link
        to={`/${m.entity_kind === "pc" ? "characters" : "characters"}/${m.entity_id}`}
        className="font-medium text-ember-soft hover:underline"
      >
        {m.entity_name}
      </Link>
      <Badge tone={m.entity_kind === "pc" ? "water" : "default"}>{m.entity_kind.toUpperCase()}</Badge>
      {m.role && <span className="text-[11px] text-ink-muted">({m.role})</span>}
      <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-faint">
        {m.joined_session_name && <span>joined: {m.joined_session_name}</span>}
        {!m.joined_session_name && m.joined_year != null && <span>joined: {formatPartialDate(m.joined_year, m.joined_month, m.joined_day)}</span>}
        {m.left_session_name && <span className="text-blood">left: {m.left_session_name}</span>}
        {!m.left_session_name && m.left_year != null && <span className="text-blood">left: {formatPartialDate(m.left_year, m.left_month, m.left_day)}</span>}
      </span>
    </li>
  );
}

// ── Journeys Tab ──

function JourneysTab({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const [editorOpen, setEditorOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState<string>("");
  const [sessionFilter, setSessionFilter] = useState<string>("");

  const journeys = useQuery({
    queryKey: ["journeys", "forParty", entity.id],
    queryFn: () => repos.journeys.journeysForParty(entity.id),
  });

  const memberships = useQuery({
    queryKey: ["journeys", "memberships", entity.id],
    queryFn: () => repos.journeys.membershipsForParty(entity.id),
  });

  // Fetch segments for all journeys
  const journeyIds = (journeys.data ?? []).map((j) => j.id);
  const segments = useQuery({
    queryKey: ["journeys", "segments", "forParty", entity.id, journeyIds],
    queryFn: async () => {
      const all: Record<string, EnrichedSegment[]> = {};
      for (const j of journeys.data ?? []) {
        const segs = await repos.journeys.listSegments(j.id);
        // Enrich each segment with participant data
        const enriched: EnrichedSegment[] = [];
        for (const seg of segs) {
          const participants = await repos.journeys.participantsForSegment(seg.id);

          // Resolve entity names for participants
          const enrichedParticipants = participants.map((p) => ({
            ...p,
            entity_name: "", // Will resolve below
          }));

          // Resolve origin/destination names
          let originName: string | null = null;
          let destinationName: string | null = null;

          enriched.push({
            ...seg,
            journey: j,
            participants: enrichedParticipants,
            origin_name: originName,
            destination_name: destinationName,
            origin_coords: null,
            destination_coords: null,
            waypoint_coords: [],
          });
        }
        all[j.id] = enriched;
      }
      return all;
    },
    enabled: journeyIds.length > 0,
  });

  // Build unique member and session lists for filter dropdowns
  const members = memberships.data ?? [];
  const sessions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const j of journeys.data ?? []) {
      if (j.session_id) seen.set(j.session_id, j.session_id);
    }
    return [...seen.keys()];
  }, [journeys.data]);

  // Fetch session names for dropdown
  const sessionEntities = useQuery({
    queryKey: ["entities", "sessions", sessions],
    queryFn: async () => {
      const results: Record<string, string> = {};
      for (const sid of sessions) {
        const entity = await repos.entities.find(sid);
        if (entity) results[sid] = entity.name;
      }
      return results;
    },
    enabled: sessions.length > 0,
  });

  // Fetch entity names for participants (to resolve "" placeholders)
  const allParticipantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const segs of Object.values(segments.data ?? {})) {
      for (const seg of segs) {
        for (const p of seg.participants) ids.add(p.entity_id);
      }
    }
    return [...ids];
  }, [segments.data]);

  const participantNames = useQuery({
    queryKey: ["entities", "names", allParticipantIds],
    queryFn: async () => {
      const results: Record<string, string> = {};
      for (const id of allParticipantIds) {
        const entity = await repos.entities.find(id);
        if (entity) results[id] = entity.name;
      }
      return results;
    },
    enabled: allParticipantIds.length > 0,
  });

  // Fetch origin/destination entity names
  const allLocationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const segs of Object.values(segments.data ?? {})) {
      for (const seg of segs) {
        if (seg.origin_entity_id) ids.add(seg.origin_entity_id);
        if (seg.destination_entity_id) ids.add(seg.destination_entity_id);
      }
    }
    return [...ids];
  }, [segments.data]);

  const locationNames = useQuery({
    queryKey: ["entities", "locationNames", allLocationIds],
    queryFn: async () => {
      const results: Record<string, { id: string; name: string; kind: string }> = {};
      for (const id of allLocationIds) {
        const entity = await repos.entities.find(id);
        if (entity) results[id] = { id: entity.id, name: entity.name, kind: entity.kind };
      }
      return results;
    },
    enabled: allLocationIds.length > 0,
  });

  // Apply filters
  const filteredJourneys = useMemo(() => {
    let list = journeys.data ?? [];
    if (sessionFilter) {
      list = list.filter((j) => j.session_id === sessionFilter);
    }
    // Member filter: keep journeys that have at least one segment with the selected member
    if (memberFilter && segments.data) {
      list = list.filter((j) => {
        const segs = segments.data[j.id] ?? [];
        return segs.some((s) => s.participants.some((p) => p.entity_id === memberFilter));
      });
    }
    return list;
  }, [journeys.data, segments.data, sessionFilter, memberFilter]);

  const hasFilters = !!memberFilter || !!sessionFilter;

  if (journeys.isLoading) return <div className="text-[12px] text-ink-faint">Loading…</div>;

  const allJourneys = journeys.data ?? [];

  if (allJourneys.length === 0 && members.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-[12px] text-ink-faint">No journeys or members recorded for this party.</div>
        {campaignId && <Button size="sm" variant="primary" onClick={() => setEditorOpen(true)}><Plus size={12} /> New Journey</Button>}
        {campaignId && <JourneyEditor open={editorOpen} onOpenChange={setEditorOpen} campaignId={campaignId} defaultPartyId={entity.id} />}
      </div>
    );
  }

  if (allJourneys.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-[12px] text-ink-faint">No journeys recorded for this party yet.</div>
        {campaignId && <Button size="sm" variant="primary" onClick={() => setEditorOpen(true)}><Plus size={12} /> New Journey</Button>}
        {campaignId && <JourneyEditor open={editorOpen} onOpenChange={setEditorOpen} campaignId={campaignId} defaultPartyId={entity.id} />}
      </div>
    );
  }

  const pNames = participantNames.data ?? {};
  const lNames = locationNames.data ?? {};
  const sNames = sessionEntities.data ?? {};

  return (
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          className="w-auto min-w-[10rem]"
          title="Filter by member"
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.entity_id}>
              {m.entity_name}
            </option>
          ))}
        </Select>
        <Select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="w-auto min-w-[10rem]"
          title="Filter by session"
        >
          <option value="">All sessions</option>
          {sessions.map((sid) => (
            <option key={sid} value={sid}>
              {sNames[sid] ?? sid}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <button
            className="text-[11px] text-ink-faint hover:text-ink"
            onClick={() => {
              setMemberFilter("");
              setSessionFilter("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filtered journeys */}
      {filteredJourneys.length === 0 && (
        <div className="text-[12px] text-ink-faint">No journeys match the current filters.</div>
      )}
      {filteredJourneys.map((j) => (
        <JourneyCard
          key={j.id}
          journey={j}
          segments={filterSegmentsByMember(segments.data?.[j.id] ?? [], memberFilter)}
          participantNames={pNames}
          locationNames={lNames}
          sessionName={j.session_id ? sNames[j.session_id] ?? null : null}
        />
      ))}
    </div>
  );
}

function JourneyCard({
  journey,
  segments,
  participantNames,
  locationNames,
  sessionName,
}: {
  journey: Journey;
  segments: EnrichedSegment[];
  participantNames: Record<string, string>;
  locationNames: Record<string, { id: string; name: string; kind: string }>;
  sessionName: string | null;
}) {
  const dateRange = formatJourneyDateRange(journey);
  return (
    <div className="rounded border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-3 py-2">
        <span className="font-medium text-[13px]">{journey.name}</span>
        <Badge tone="ember">{JOURNEY_CATEGORY_LABELS[journey.category]}</Badge>
        {sessionName && <span className="text-[11px] text-ink-muted">Session: {sessionName}</span>}
        {dateRange && <span className="ml-auto text-[11px] text-ink-faint">{dateRange}</span>}
      </div>
      {segments.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-ink-faint">No travel segments in this journey.</div>
      ) : (
        <ul className="divide-y divide-border">
          {segments.map((seg) => (
            <SegmentRow
              key={seg.id}
              segment={seg}
              participantNames={participantNames}
              locationNames={locationNames}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SegmentRow({
  segment,
  participantNames,
  locationNames,
}: {
  segment: EnrichedSegment;
  participantNames: Record<string, string>;
  locationNames: Record<string, { id: string; name: string; kind: string }>;
}) {
  const origin = segment.origin_entity_id ? locationNames[segment.origin_entity_id] : null;
  const dest = segment.destination_entity_id ? locationNames[segment.destination_entity_id] : null;
  const travelers = segment.participants
    .map((p) => ({ id: p.entity_id, name: participantNames[p.entity_id] ?? "Unknown" }))
    .filter((t) => t.name);

  return (
    <li className="px-3 py-2 text-[12.5px]">
      <div className="flex items-center gap-1">
        {origin ? (
          <Link
            to={routeForEntity({ id: origin.id, kind: origin.kind as "location", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            {origin.name}
          </Link>
        ) : (
          <span className="text-ink-faint">Unknown origin</span>
        )}
        <span className="text-ink-faint">→</span>
        {dest ? (
          <Link
            to={routeForEntity({ id: dest.id, kind: dest.kind as "location", parent_id: null })}
            className="text-ember-soft hover:underline"
          >
            {dest.name}
          </Link>
        ) : (
          <span className="text-ink-faint">Unknown destination</span>
        )}
        {segment.notes && <span className="ml-2 text-[11px] text-ink-faint italic">— {segment.notes}</span>}
      </div>
      {travelers.length > 0 && (
        <div className="mt-0.5 text-[11px] text-ink-muted">
          Travelers:{" "}
          {travelers.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ", "}
              <Link to={`/characters/${t.id}`} className="text-ember-soft hover:underline">
                {t.name}
              </Link>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

