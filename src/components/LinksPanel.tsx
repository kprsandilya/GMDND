import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useRepos } from "@/app/appContext";
import { qk, useAction, useLinks } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { ENTITY_KINDS, KIND_LABELS, type Entity } from "@/domain/types";
import { EntityPicker } from "./EntityPicker";
import { Badge, Button, Input } from "./ui";

const RELATIONS = ["related", "located_in", "member_of", "leader_of", "owns", "knows", "enemy_of", "ally_of", "worships", "gives_quest", "involves", "mentions", "guards", "contains", "occurs_at", "sells"];

/** Explicit relations (both directions) plus implicit `[[Name]]` mentions. */
export function LinksPanel({ entity }: { entity: Entity }) {
  const repos = useRepos();
  const links = useLinks(entity.id);
  const mentions = useQuery({ queryKey: ["mentions", entity.id, entity.name], queryFn: () => repos.entities.mentions(entity) });
  const [target, setTarget] = useState<string | null>(null);
  const [relation, setRelation] = useState("related");
  const [note, setNote] = useState("");
  const add = useAction(() => repos.entities.link(entity.id, target!, relation, note), {
    success: "Link added",
    invalidate: [qk.links(entity.id), qk.links(target ?? "")],
    onSuccess: () => {
      setTarget(null);
      setNote("");
    },
  });
  const remove = useAction((id: string) => repos.entities.unlink(id), { invalidate: [["entities", "links"]] });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded border border-border bg-bg p-2">
        <div className="label">Add relation</div>
        <EntityPicker kinds={[...ENTITY_KINDS]} value={target} onChange={(id) => setTarget(id)} exclude={[entity.id]} placeholder="Choose an entity…" />
        <div className="flex gap-1.5">
          <Input list="relations" value={relation} onChange={(e) => setRelation(e.target.value)} className="w-40" />
          <datalist id="relations">
            {RELATIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          <Button variant="primary" size="md" disabled={!target || add.isPending} onClick={() => add.mutate(undefined as never)}>
            <Link2 size={13} /> Link
          </Button>
        </div>
      </div>
      <div>
        <div className="label">Relations</div>
        {(links.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">No explicit links yet.</div>}
        <ul className="divide-y divide-border">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-1 text-[12.5px]">
              {l.direction === "out" ? <ArrowUpRight size={12} className="text-ink-faint" /> : <ArrowDownLeft size={12} className="text-ink-faint" />}
              <span className="w-24 shrink-0 truncate text-[11px] text-ink-muted">{l.relation.replace(/_/g, " ")}</span>
              <Link to={routeForEntity(l.entity)} className="truncate text-ember-soft hover:underline">
                {l.entity.name}
              </Link>
              <Badge className="ml-1">{KIND_LABELS[l.entity.kind]}</Badge>
              {l.note && <span className="truncate text-[11px] text-ink-faint">— {l.note}</span>}
              <button className="ml-auto text-ink-faint hover:text-blood" onClick={() => remove.mutate(l.id)} aria-label="Remove link">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="label">Mentioned in</div>
        {(mentions.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">No entity text mentions [[{entity.name}]].</div>}
        <ul className="space-y-0.5">
          {(mentions.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-[12.5px]">
              <Link to={routeForEntity(m)} className="truncate text-ember-soft hover:underline">
                {m.name}
              </Link>
              <Badge>{KIND_LABELS[m.kind]}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
