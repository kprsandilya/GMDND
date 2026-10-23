import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useRepos } from "@/app/appContext";
import { qk, useAction } from "@/app/queries";
import { EntityWorkspace } from "@/components/EntityWorkspace";
import { Badge, Button, Checkbox, Input } from "@/components/ui";
import type { Entity, QuestObjective } from "@/domain/types";
import { cn } from "@/lib/utils";

export function QuestsPage() {
  return (
    <EntityWorkspace
      title="Quests & Events"
      kinds={["quest", "event"]}
      basePath="/quests"
      description="Quests with objectives, givers, rewards and consequences; events that shape the campaign."
      rowMeta={(e) => (e.kind === "quest" ? `${e.status ?? "draft"} · ${e.fields.priority ?? "side"}` : e.summary)}
      extras={{
        tabs: [{ value: "objectives", label: "Objectives", render: (e) => (e.kind === "quest" ? <Objectives quest={e} /> : <div className="text-ink-faint">Events have no objectives.</div>) }],
        banner: (e) =>
          e.kind === "quest" ? (
            <div className="flex items-center gap-2 border-b border-border bg-bg-elevated px-4 py-2 text-[12px]">
              <Badge tone={e.status === "active" ? "ember" : e.status === "completed" ? "moss" : e.status === "failed" ? "blood" : "default"}>{e.status ?? "draft"}</Badge>
              <Badge>{String(e.fields.priority ?? "side")}</Badge>
              {e.fields.level_range ? <span className="text-ink-muted">Levels {String(e.fields.level_range)}</span> : null}
              {e.fields.reward ? <span className="ml-auto text-ink-muted">Reward: {String(e.fields.reward)}</span> : null}
            </div>
          ) : null,
      }}
    />
  );
}

export function Objectives({ quest, compact }: { quest: Entity; compact?: boolean }) {
  const repos = useRepos();
  const objectives = useQuery({ queryKey: qk.objectives(quest.id), queryFn: () => repos.quests.objectives(quest.id) });
  const [title, setTitle] = useState("");
  const [optional, setOptional] = useState(false);
  const invalidate = [qk.objectives(quest.id)];
  const add = useAction(() => repos.quests.addObjective(quest.id, title.trim(), optional), { invalidate, onSuccess: () => setTitle("") });
  const update = useAction(({ id, patch }: { id: string; patch: Partial<QuestObjective> }) => repos.quests.updateObjective(id, patch), { invalidate });
  const remove = useAction((id: string) => repos.quests.deleteObjective(id), { invalidate });
  const cycle = (o: QuestObjective) => update.mutate({ id: o.id, patch: { status: o.status === "open" ? "done" : o.status === "done" ? "failed" : "open" } });
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {(objectives.data ?? []).map((o) => (
          <li key={o.id} className="flex items-center gap-2 text-[13px]">
            <button onClick={() => cycle(o)} className={cn("rounded p-0.5", o.status === "done" ? "text-moss" : o.status === "failed" ? "text-blood" : "text-ink-faint hover:text-ink")} title="Cycle open → done → failed">
              {o.status === "done" ? <Check size={14} /> : o.status === "failed" ? <X size={14} /> : <Circle size={14} />}
            </button>
            <span className={cn(o.status === "done" && "line-through text-ink-faint", o.status === "failed" && "text-blood")}>{o.title}</span>
            {o.optional && <Badge>optional</Badge>}
            {!compact && (
              <button className="ml-auto text-ink-faint hover:text-blood" onClick={() => remove.mutate(o.id)} aria-label="Delete objective">
                <Trash2 size={12} />
              </button>
            )}
          </li>
        ))}
        {(objectives.data ?? []).length === 0 && <li className="text-[12px] text-ink-faint">No objectives yet.</li>}
      </ul>
      {!compact && (
        <div className="flex items-center gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New objective…" onKeyDown={(e) => e.key === "Enter" && title.trim() && add.mutate(undefined as never)} />
          <Checkbox label="Optional" checked={optional} onChange={setOptional} />
          <Button size="sm" variant="primary" disabled={!title.trim()} onClick={() => add.mutate(undefined as never)}>
            <Plus size={12} /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
