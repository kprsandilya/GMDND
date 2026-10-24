import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Copy, Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { qk, useAction, useEntity, useRequiredCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { KIND_LABELS, type Entity, type EntityKind } from "@/domain/types";
import { formatDateTime } from "@/lib/utils";
import { draftFrom, draftToInput, EntityFormBody, type EntityDraft } from "./EntityForm";
import { FieldsSummary } from "./FieldsEditor";
import { InventoryPanel } from "./InventoryPanel";
import { LinksPanel } from "./LinksPanel";
import { MarkdownView } from "./Markdown";
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, TabPanel, Tabs } from "./ui";

const INVENTORY_KINDS = new Set<EntityKind>(["pc", "npc", "shop", "room", "encounter"]);

export interface DetailExtras {
  /** Additional tabs rendered after the standard ones. */
  tabs?: { value: string; label: string; render: (entity: Entity) => ReactNode }[];
  /** Extra header actions. */
  actions?: (entity: Entity) => ReactNode;
  /** Content placed above the tabs. */
  banner?: (entity: Entity) => ReactNode;
}

/** Detail view for any entity: read mode with tabs, inline edit mode, delete and duplicate. */
export function EntityDetail({ id, kinds, extras, afterDelete }: { id: string; kinds: EntityKind[]; extras?: DetailExtras; afterDelete?: () => void }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const navigate = useNavigate();
  const pushRecent = useAppStore((s) => s.pushRecent);
  const entity = useEntity(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EntityDraft | null>(null);
  const [tab, setTab] = useState("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ancestors = useQuery({ queryKey: ["ancestors", id], queryFn: () => repos.entities.ancestors(id), enabled: !!entity.data });
  const children = useQuery({ queryKey: ["children", id], queryFn: () => repos.entities.children(id), enabled: !!entity.data });

  useEffect(() => {
    if (entity.data) pushRecent({ id: entity.data.id, name: entity.data.name, kind: entity.data.kind });
  }, [entity.data, pushRecent]);
  useEffect(() => {
    setEditing(false);
    setDraft(null);
  }, [id]);

  const save = useAction(
    async () => {
      // Preserve the record's existing scope: shared library records (campaign_id === null, e.g.
      // the SRD standard set) stay shared when edited rather than being pulled into this campaign.
      const scope = entity.data!.campaign_id ?? null;
      const input = draftToInput(draft!, scope ?? campaignId, entity.data!.world_id);
      if (scope === null) input.campaign_id = null;
      return repos.entities.update(id, input);
    },
    { success: "Saved", invalidate: [["entities"], ["ancestors", id], ["children"]], onSuccess: () => setEditing(false) },
  );
  const remove = useAction(() => repos.entities.delete(id), {
    success: "Deleted",
    onSuccess: () => (afterDelete ? afterDelete() : navigate("..")),
  });
  const duplicate = useAction(
    async () => {
      const e = entity.data!;
      // A copy always belongs to the current campaign and is "custom": clearing the source marker
      // turns a duplicated standard (SRD) record into an editable campaign-owned record.
      const fields = { ...(e.fields as Record<string, unknown>) };
      if ("source" in fields) fields.source = "";
      return repos.entities.create({ ...e, id: undefined, campaign_id: campaignId, fields, name: `${e.name} (copy)` } as never);
    },
    { success: "Duplicated", onSuccess: (created) => navigate(routeForEntity(created)) },
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing) {
        e.preventDefault();
        save.mutate(undefined as never);
      }
      if (e.key === "Escape" && editing) setEditing(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editing, save]);

  if (entity.isLoading) return <EmptyState title="Loading…" />;
  if (!entity.data) return <EmptyState title="Not found" body="This entity no longer exists." />;
  const e = entity.data;

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "details", label: "Details" },
    { value: "read", label: "Read-aloud" },
    { value: "dm", label: "DM notes" },
    { value: "secret", label: "Secrets" },
    { value: "links", label: "Links" },
    ...(INVENTORY_KINDS.has(e.kind) ? [{ value: "inventory", label: "Inventory" }] : []),
    ...(extras?.tabs ?? []).map((t) => ({ value: t.value, label: t.label })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {e.name}
            <Badge tone="ember">{KIND_LABELS[e.kind]}</Badge>
            {e.subtype && <Badge>{e.subtype}</Badge>}
            {e.status && <Badge tone="water">{e.status}</Badge>}
            {e.campaign_id === null && typeof e.fields.source === "string" && e.fields.source && (
              <Badge tone="gold">Standard (SRD) · shared by all campaigns</Badge>
            )}
          </span>
        }
        subtitle={
          <span className="flex items-center gap-1">
            {(ancestors.data ?? []).map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <Link to={routeForEntity(a)} className="hover:text-ink hover:underline">
                  {a.name}
                </Link>
                <ChevronRight size={11} />
              </span>
            ))}
            <span className="text-ink-faint">updated {formatDateTime(e.updated_at)}</span>
          </span>
        }
        actions={
          editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                <X size={13} /> Cancel
              </Button>
              <Button variant="primary" disabled={save.isPending || !draft?.name.trim()} onClick={() => save.mutate(undefined as never)}>
                <Save size={13} /> Save
              </Button>
            </>
          ) : (
            <>
              {extras?.actions?.(e)}
              <Button variant="ghost" size="sm" onClick={() => duplicate.mutate(undefined as never)} title="Duplicate">
                <Copy size={13} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} title="Delete">
                <Trash2 size={13} />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(draftFrom(e));
                  setEditing(true);
                }}
              >
                <Pencil size={13} /> Edit
              </Button>
            </>
          )
        }
      />
      {editing && draft ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EntityFormBody draft={draft} onChange={setDraft} kinds={kinds} allowKindChange={kinds.length > 1} />
        </div>
      ) : (
        <>
          {extras?.banner?.(e)}
          <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
            <TabPanel value="overview" className="space-y-4 p-4">
              {e.summary && <p className="text-[14px] text-ink-muted">{e.summary}</p>}
              {e.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {e.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <MarkdownView source={e.body_md} />
              {(children.data ?? []).length > 0 && (
                <div>
                  <div className="label">Contains</div>
                  <ul className="grid grid-cols-2 gap-1 md:grid-cols-3">
                    {children.data!.map((c) => (
                      <li key={c.id}>
                        <Link to={routeForEntity(c)} className="row-hover flex items-center justify-between rounded border border-border px-2 py-1 text-[12.5px]">
                          <span className="truncate">{c.name}</span>
                          <Badge>{KIND_LABELS[c.kind]}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabPanel>
            <TabPanel value="details" className="p-4">
              <FieldsSummary kind={e.kind} fields={e.fields} />
            </TabPanel>
            <TabPanel value="read" className="p-4">
              <MarkdownView source={e.read_aloud_md} variant="read-aloud" />
            </TabPanel>
            <TabPanel value="dm" className="p-4">
              <MarkdownView source={e.dm_notes_md} />
            </TabPanel>
            <TabPanel value="secret" className="p-4">
              <MarkdownView source={e.secret_md} variant="secret" />
            </TabPanel>
            <TabPanel value="links" className="p-4">
              <LinksPanel entity={e} />
            </TabPanel>
            {INVENTORY_KINDS.has(e.kind) && (
              <TabPanel value="inventory" className="p-4">
                <InventoryPanel owner={{ owner_type: e.kind === "shop" ? "shop" : e.kind === "room" ? "room" : e.kind === "encounter" ? "hoard" : "character", owner_id: e.id }} />
              </TabPanel>
            )}
            {(extras?.tabs ?? []).map((t) => (
              <TabPanel key={t.value} value={t.value} className="p-4">
                {t.render(e)}
              </TabPanel>
            ))}
          </Tabs>
        </>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${e.name}?`}
        body={
          <>
            This removes the {KIND_LABELS[e.kind].toLowerCase()} and its links. Children keep existing but lose their parent. Item instances, tokens and markers referencing it are detached or removed.
          </>
        }
        onConfirm={() => remove.mutateAsync(undefined as never).then(() => undefined)}
      />
    </div>
  );
}

export { qk };
