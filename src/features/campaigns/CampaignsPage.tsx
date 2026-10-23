import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { ALL_KEYS, useAction, useCampaigns } from "@/app/queries";
import { Badge, Button, ConfirmDialog, Dialog, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { campaignFieldsSchema } from "@/domain/schemas";
import { createCampaign, deleteCampaign } from "@/domain/workflows/campaignWorkflow";
import { cn, formatDateTime } from "@/lib/utils";
import { DEMO_CAMPAIGN_NAME, resetDemoCampaign } from "@/seed/demoCampaign";
import { CalendarEditor } from "./CalendarEditor";

export function CampaignsPage() {
  const repos = useRepos();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const campaigns = useCampaigns();
  const campaignId = useAppStore((s) => s.campaignId);
  const setCampaignId = useAppStore((s) => s.setCampaignId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [form, setForm] = useState({ name: "", worldName: "", summary: "" });

  const create = useAction(() => createCampaign(repos, { name: form.name.trim(), worldName: form.worldName.trim() || undefined, summary: form.summary }), {
    success: "Campaign created",
    invalidate: ALL_KEYS,
    onSuccess: ({ campaign }) => {
      setCampaignId(campaign.id);
      setCreating(false);
      setForm({ name: "", worldName: "", summary: "" });
      navigate("/");
    },
  });
  const remove = useAction((id: string) => deleteCampaign(repos, id), {
    success: "Campaign deleted",
    invalidate: ALL_KEYS,
    onSuccess: (_r, id) => {
      if (campaignId === id) setCampaignId(null);
      void qc.invalidateQueries();
    },
  });
  const reset = useAction(() => resetDemoCampaign(repos), {
    success: "Demo campaign reset",
    invalidate: ALL_KEYS,
    onSuccess: (ids) => {
      setCampaignId(ids.campaign);
      void qc.invalidateQueries();
    },
  });

  const selected = campaigns.data?.find((c) => c.id === campaignId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Campaigns"
        subtitle="Each campaign is isolated: its own world, entities, maps, sessions and item instances."
        actions={
          <>
            <Button variant="outline" onClick={() => setResetting(true)}>
              <RotateCcw size={13} /> Reset demo campaign
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={13} /> New campaign
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] overflow-hidden">
        <ul className="overflow-y-auto border-r border-border bg-bg-elevated p-2">
          {(campaigns.data ?? []).map((c) => {
            const fields = campaignFieldsSchema.safeParse(c.fields);
            const isDemo = fields.success && fields.data.is_demo;
            return (
              <li key={c.id} className={cn("mb-1 rounded border border-border p-2", c.id === campaignId && "border-ember/60 bg-bg-active")}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-[15px]">{c.name}</span>
                  {isDemo && <Badge tone="gold">demo</Badge>}
                  {c.id === campaignId && <Badge tone="ember">active</Badge>}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-muted">{c.summary}</div>
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
                  <span>edited {formatDateTime(c.updated_at)}</span>
                  <span className="ml-auto flex gap-1">
                    {c.id !== campaignId && (
                      <Button size="sm" variant="primary" onClick={() => { setCampaignId(c.id); void qc.invalidateQueries(); navigate("/"); }}>
                        <Check size={11} /> Open
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(c.id)} aria-label="Delete campaign">
                      <Trash2 size={11} />
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="overflow-y-auto p-4">
          {selected ? <CampaignSettings key={selected.id} campaignId={selected.id} /> : <div className="text-ink-faint">Select a campaign.</div>}
        </div>
      </div>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New campaign"
        footer={
          <Button variant="primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(undefined as never)}>
            Create
          </Button>
        }
      >
        <div className="space-y-2">
          <Field label="Campaign name">
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="World name" hint="A world entity is created as the root of your atlas.">
            <Input value={form.worldName} onChange={(e) => setForm({ ...form, worldName: e.target.value })} placeholder={form.name ? `${form.name} World` : ""} />
          </Field>
          <Field label="Premise">
            <Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={3} />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this campaign?"
        body="Everything inside it (world, locations, maps, characters, items, sessions) is removed. Other campaigns are untouched. A startup snapshot exists in the backups folder if you need to recover."
        onConfirm={() => remove.mutateAsync(deleting!).then(() => undefined)}
      />
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset "${DEMO_CAMPAIGN_NAME}"?`}
        body="The demo campaign is deleted and re-created from scratch with its original content. Your other campaigns are not affected."
        confirmLabel="Reset demo"
        onConfirm={() => reset.mutateAsync(undefined as never).then(() => undefined)}
      />
    </div>
  );
}

function CampaignSettings({ campaignId }: { campaignId: string }) {
  const repos = useRepos();
  const campaigns = useCampaigns();
  const campaign = campaigns.data?.find((c) => c.id === campaignId);
  const [draft, setDraft] = useState(() => ({ name: campaign?.name ?? "", summary: campaign?.summary ?? "", body_md: campaign?.body_md ?? "", edition: String(campaign?.fields.edition ?? "5e (2014)") }));
  const save = useAction(() => repos.entities.update(campaignId, { name: draft.name.trim(), summary: draft.summary, body_md: draft.body_md, fields: { ...campaign!.fields, edition: draft.edition } }), { success: "Campaign saved" });
  if (!campaign) return null;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid grid-cols-[1fr_180px] gap-2">
        <Field label="Name">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Edition">
          <Input value={draft.edition} onChange={(e) => setDraft({ ...draft, edition: e.target.value })} />
        </Field>
      </div>
      <Field label="Premise">
        <Textarea rows={2} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
      </Field>
      <Field label="Campaign notes (Markdown)">
        <Textarea rows={6} value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!draft.name.trim() || save.isPending} onClick={() => save.mutate(undefined as never)}>
          Save campaign
        </Button>
      </div>
      <CalendarEditor campaign={campaign} />
    </div>
  );
}
