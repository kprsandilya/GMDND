import { useEffect, useState } from "react";
import { useRepos } from "@/app/appContext";
import { useAction, useEntities, useRequiredCampaignId } from "@/app/queries";
import { entityInputSchema, normalizeFields } from "@/domain/schemas";
import { GEOGRAPHIC_KINDS, KIND_LABELS, type Entity, type EntityInput, type EntityKind } from "@/domain/types";
import { MarkdownEditor } from "./Markdown";
import { FieldsEditor } from "./FieldsEditor";
import { EntityPicker } from "./EntityPicker";
import { Button, Dialog, Field, Input, Select, TabPanel, Tabs, Textarea } from "./ui";

export interface EntityDraft {
  kind: EntityKind;
  name: string;
  subtype: string;
  summary: string;
  body_md: string;
  read_aloud_md: string;
  dm_notes_md: string;
  secret_md: string;
  tags: string;
  status: string;
  parent_id: string | null;
  fields: Record<string, unknown>;
}

export function draftFrom(entity: Partial<Entity> & { kind: EntityKind }): EntityDraft {
  return {
    kind: entity.kind,
    name: entity.name ?? "",
    subtype: entity.subtype ?? "",
    summary: entity.summary ?? "",
    body_md: entity.body_md ?? "",
    read_aloud_md: entity.read_aloud_md ?? "",
    dm_notes_md: entity.dm_notes_md ?? "",
    secret_md: entity.secret_md ?? "",
    tags: (entity.tags ?? []).join(", "),
    status: entity.status ?? "",
    parent_id: entity.parent_id ?? null,
    fields: normalizeFields(entity.kind, entity.fields ?? {}),
  };
}

export function draftToInput(draft: EntityDraft, campaignId: string, worldId: string | null): EntityInput {
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    campaign_id: campaignId,
    world_id: worldId,
    subtype: draft.subtype.trim() || null,
    summary: draft.summary,
    body_md: draft.body_md,
    read_aloud_md: draft.read_aloud_md,
    dm_notes_md: draft.dm_notes_md,
    secret_md: draft.secret_md,
    tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
    status: draft.status.trim() || null,
    parent_id: draft.parent_id,
    fields: draft.fields,
  };
}

const PARENT_KINDS: Partial<Record<EntityKind, EntityKind[]>> = {
  continent: ["world"],
  region: ["world", "continent", "kingdom"],
  kingdom: ["world", "continent", "region"],
  settlement: ["region", "kingdom", "continent", "world"],
  district: ["settlement"],
  building: ["settlement", "district", "location"],
  location: ["world", "continent", "region", "kingdom", "settlement", "district", "location"],
  dungeon: ["world", "continent", "region", "kingdom", "settlement", "district", "location", "building"],
  shop: ["settlement", "district", "building"],
  npc: ["settlement", "district", "building", "location", "dungeon", "faction"],
  encounter: ["dungeon", "location", "settlement", "region", "room"],
  article: ["world", "article"],
  document: ["world", "article", "location", "dungeon"],
  secret: ["npc", "pc", "faction", "location", "settlement", "dungeon", "quest", "article"],
  trap: ["dungeon", "location", "building"],
  event: ["world", "region", "kingdom", "settlement"],
  session: ["campaign"],
  spell: [],
};

/** Form body shared by the create dialog and the edit mode of the detail view. */
export function EntityFormBody({ draft, onChange, kinds, allowKindChange }: { draft: EntityDraft; onChange: (d: EntityDraft) => void; kinds?: EntityKind[]; allowKindChange?: boolean }) {
  const [tab, setTab] = useState("overview");
  const set = <K extends keyof EntityDraft>(key: K, value: EntityDraft[K]) => onChange({ ...draft, [key]: value });
  const parentKinds = PARENT_KINDS[draft.kind] ?? (GEOGRAPHIC_KINDS.includes(draft.kind) ? GEOGRAPHIC_KINDS : []);
  return (
    <div className="flex min-h-[420px] flex-col gap-2">
      <div className="grid grid-cols-[1fr_160px_160px] gap-2">
        <Field label="Name">
          <Input autoFocus value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={`${KIND_LABELS[draft.kind]} name`} />
        </Field>
        <Field label="Kind">
          <Select value={draft.kind} disabled={!allowKindChange} onChange={(e) => { const kind = e.target.value as EntityKind; onChange({ ...draft, kind, fields: normalizeFields(kind, draft.fields) }); }}>
            {(kinds ?? [draft.kind]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Input value={draft.status} onChange={(e) => set("status", e.target.value)} placeholder="draft, active, dead…" />
        </Field>
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "details", label: "Details" },
          { value: "read", label: "Read-aloud" },
          { value: "dm", label: "DM notes" },
          { value: "secret", label: "Secrets" },
        ]}
      >
        <TabPanel value="overview" className="space-y-2 px-0">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Subtype" hint="Free text, e.g. city, port, merchant, undead">
              <Input value={draft.subtype} onChange={(e) => set("subtype", e.target.value)} />
            </Field>
            <Field label="Tags" hint="Comma separated">
              <Input value={draft.tags} onChange={(e) => set("tags", e.target.value)} />
            </Field>
            {parentKinds.length > 0 && (
              <Field label="Parent / located in" className="col-span-2">
                <EntityPicker kinds={parentKinds} value={draft.parent_id} onChange={(id) => set("parent_id", id)} allowNone />
              </Field>
            )}
          </div>
          <Field label="Summary">
            <Textarea rows={2} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Description">
            <MarkdownEditor value={draft.body_md} onChange={(v) => set("body_md", v)} rows={10} />
          </Field>
        </TabPanel>
        <TabPanel value="details" className="px-0">
          <FieldsEditor kind={draft.kind} value={draft.fields} onChange={(fields) => set("fields", fields)} />
        </TabPanel>
        <TabPanel value="read" className="px-0">
          <MarkdownEditor variant="read-aloud" value={draft.read_aloud_md} onChange={(v) => set("read_aloud_md", v)} rows={12} placeholder="Boxed text to read to the players." />
        </TabPanel>
        <TabPanel value="dm" className="px-0">
          <MarkdownEditor value={draft.dm_notes_md} onChange={(v) => set("dm_notes_md", v)} rows={12} placeholder="Private notes, tactics, reminders." />
        </TabPanel>
        <TabPanel value="secret" className="px-0">
          <MarkdownEditor variant="secret" value={draft.secret_md} onChange={(v) => set("secret_md", v)} rows={12} placeholder="Hidden truths, never shown to players." />
        </TabPanel>
      </Tabs>
    </div>
  );
}

export function CreateEntityDialog({ open, onOpenChange, kinds, defaultKind, defaults, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; kinds: EntityKind[]; defaultKind?: EntityKind; defaults?: Partial<Entity>; onCreated?: (entity: Entity) => void }) {
  const repos = useRepos();
  const campaignId = useRequiredCampaignId();
  const worlds = useEntities({ kinds: ["world"] });
  const [draft, setDraft] = useState<EntityDraft>(() => draftFrom({ kind: defaultKind ?? kinds[0]!, ...defaults }));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(draftFrom({ kind: defaultKind ?? kinds[0]!, ...defaults }));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = useAction(
    async () => {
      const input = draftToInput(draft, campaignId, worlds.data?.[0]?.id ?? null);
      const parsed = entityInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      return repos.entities.create(input);
    },
    {
      success: (e) => `Created ${e.name}`,
      onSuccess: (entity) => {
        onOpenChange(false);
        onCreated?.(entity);
      },
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`New ${KIND_LABELS[draft.kind]}`}
      width="max-w-3xl"
      footer={
        <>
          {error && <span className="mr-auto text-[12px] text-blood">{error}</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={create.isPending || !draft.name.trim()}
            onClick={() => {
              setError(null);
              create.mutate(undefined as never);
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <EntityFormBody draft={draft} onChange={setDraft} kinds={kinds} allowKindChange={kinds.length > 1} />
    </Dialog>
  );
}
