import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, Play, Swords, Users } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { qk, useAction, useCampaign, useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { Badge, Button, EmptyState, PageHeader, Panel } from "@/components/ui";
import { formatDate, weekdayName } from "@/domain/calendar";
import { KIND_LABELS, type EntityKind } from "@/domain/types";
import { advanceCampaignDate, loadCampaignState } from "@/domain/workflows/campaignWorkflow";
import { relativeTime } from "@/lib/utils";

export function DashboardPage() {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const campaign = useCampaign();
  const navigate = useNavigate();
  const recent = useAppStore((s) => s.recent);
  const state = useQuery({ queryKey: qk.campaignState(campaignId), queryFn: () => loadCampaignState(repos, campaignId!), enabled: !!campaignId });
  const recentlyEdited = useQuery({ queryKey: ["entities", "recent", campaignId], queryFn: () => repos.entities.list({ campaign_id: campaignId, orderBy: "updated_at", limit: 10 }), enabled: !!campaignId });
  const log = useQuery({ queryKey: qk.campaignLog(campaignId), queryFn: () => repos.campaignLog.list(campaignId!, 15), enabled: !!campaignId });
  const advance = useAction((days: number) => advanceCampaignDate(repos, campaignId!, days), { success: "Time passes", invalidate: [["entities"], ["campaignState"], ["campaignLog"]] });

  if (!campaignId || !campaign.data) return <EmptyState title="No campaign selected" action={<Button variant="primary" onClick={() => navigate("/campaigns")}>Open campaigns</Button>} />;
  const s = state.data;
  const calendar = s?.fields.calendar;
  const date = calendar ? { year: calendar.year, month: calendar.month, day: calendar.day } : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={campaign.data.name}
        subtitle={campaign.data.summary || "Dungeon Master dashboard"}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/sessions")}>
              <Play size={13} /> {s?.activeSession ? `Continue ${s.activeSession.name}` : "Session manager"}
            </Button>
            <Button variant="primary" onClick={() => navigate("/dungeons")}>
              <Swords size={13} /> Open maps
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-y-auto p-3">
        <Panel title="Campaign clock" className="col-span-4">
          {calendar && date ? (
            <div className="space-y-2">
              <div className="font-display text-xl text-ember-soft">{formatDate(calendar, date)}</div>
              <div className="text-[12px] text-ink-muted">
                {weekdayName(calendar, date)} · {calendar.era} · {calendar.months.length} months / {calendar.months.reduce((a, m) => a + m.days, 0)} days per year
              </div>
              <div className="flex gap-1.5">
                {[1, 3, 7].map((d) => (
                  <Button key={d} size="sm" variant="outline" onClick={() => advance.mutate(d)}>
                    +{d}d
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => navigate("/timeline")}>
                  <CalendarClock size={12} /> Timeline
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-ink-faint">No calendar configured.</div>
          )}
        </Panel>
        <Panel title="Party" className="col-span-4">
          <div className="mb-2 flex items-center gap-2 text-[12.5px]">
            <MapPin size={13} className="text-ink-faint" />
            {s?.partyLocation ? (
              <Link to={routeForEntity(s.partyLocation)} className="text-ember-soft hover:underline">
                {s.partyLocation.name}
              </Link>
            ) : (
              <span className="text-ink-faint">Location unknown</span>
            )}
          </div>
          <ul className="space-y-1">
            {(s?.party ?? []).map((pc) => (
              <li key={pc.id} className="flex items-center justify-between text-[12.5px]">
                <Link to={routeForEntity(pc)} className="hover:underline">
                  {pc.name}
                </Link>
                <span className="text-[11px] text-ink-faint">
                  {String(pc.fields.race ?? "")} {String(pc.fields.class ?? "")} {pc.fields.level ? `L${pc.fields.level}` : ""} · HP {String(pc.fields.hp ?? "?")}/{String(pc.fields.max_hp ?? "?")}
                </span>
              </li>
            ))}
            {(s?.party ?? []).length === 0 && <li className="text-[12px] text-ink-faint">No player characters yet.</li>}
          </ul>
        </Panel>
        <Panel title="Status" className="col-span-4">
          <ul className="space-y-1 text-[12.5px]">
            <li className="flex justify-between">
              <span className="text-ink-muted">Active quests</span>
              <Link to="/quests" className="text-ember-soft">
                {s?.activeQuests.length ?? 0}
              </Link>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Encounters in progress</span>
              <Link to="/encounters" className="text-ember-soft">
                {s?.activeRuns ?? 0}
              </Link>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Unresolved session notes</span>
              <Link to="/sessions" className="text-ember-soft">
                {s?.openNotes.length ?? 0}
              </Link>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Active session</span>
              <span>{s?.activeSession?.name ?? "—"}</span>
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-1">
            {Object.entries(s?.counts ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([kind, n]) => (
                <Badge key={kind}>
                  {n} {KIND_LABELS[kind as EntityKind] ?? kind}
                </Badge>
              ))}
          </div>
        </Panel>
        <Panel title="Active quests" className="col-span-6">
          <ul className="space-y-1.5">
            {(s?.activeQuests ?? []).map((q) => (
              <li key={q.id}>
                <Link to={routeForEntity(q)} className="text-[13px] text-ember-soft hover:underline">
                  {q.name}
                </Link>
                <div className="truncate text-[11px] text-ink-faint">{q.summary}</div>
              </li>
            ))}
            {(s?.activeQuests ?? []).length === 0 && <li className="text-[12px] text-ink-faint">No active quests. Set a quest's status to "active" to track it here.</li>}
          </ul>
        </Panel>
        <Panel title="Recently edited" className="col-span-6">
          <ul className="space-y-1">
            {(recentlyEdited.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-[12.5px]">
                <Link to={routeForEntity(e)} className="truncate hover:underline">
                  {e.name}
                </Link>
                <Badge>{KIND_LABELS[e.kind]}</Badge>
                <span className="ml-auto text-[11px] text-ink-faint">{relativeTime(e.updated_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Campaign log" className="col-span-8">
          <ul className="space-y-1">
            {(log.data ?? []).map((entry) => (
              <li key={entry.id} className="flex gap-2 text-[12.5px]">
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">{entry.kind}</span>
                <span className="flex-1">{entry.message}</span>
                <span className="text-[11px] text-ink-faint">{relativeTime(entry.at)}</span>
              </li>
            ))}
            {(log.data ?? []).length === 0 && <li className="text-[12px] text-ink-faint">Nothing logged yet.</li>}
          </ul>
        </Panel>
        <Panel title="Recently viewed" className="col-span-4">
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
                <Users size={11} className="text-ink-faint" />
                <Link to={routeForEntity({ id: r.id, kind: r.kind as EntityKind, parent_id: null })} className="truncate hover:underline">
                  {r.name}
                </Link>
              </li>
            ))}
            {recent.length === 0 && <li className="text-[12px] text-ink-faint">Entities you open appear here.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
