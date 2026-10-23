import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, FolderOpen, HardDriveDownload, HardDriveUpload, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAppInfo, useRepos } from "@/app/appContext";
import { DEFAULT_SETTINGS, useAppStore } from "@/app/appStore";
import { ALL_KEYS, useAction, useCampaign, useCampaigns } from "@/app/queries";
import { ARCHIVE_FILTER, platform, type BackupManifest } from "@/app/platform";
import { Badge, Button, Checkbox, Dialog, Field, Input, PageHeader, Panel, Select } from "@/components/ui";
import { errorMessage, formatBytes, formatDateTime, slugify } from "@/lib/utils";
import { applyImport, exportCampaign, findMissingReferences, planImport, type ImportPlan } from "@/persistence/exportImport";
import { CURRENT_SCHEMA_VERSION, getSchemaVersion } from "@/persistence/migrations";

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const { paths, appVersion } = useAppInfo();
  const repos = useRepos();
  const schema = useQuery({ queryKey: ["schemaVersion"], queryFn: () => getSchemaVersion(repos.driver) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings & Data Management" subtitle={`DM Workbench ${appVersion} · schema v${schema.data ?? "…"} (app expects v${CURRENT_SCHEMA_VERSION}) · all data is stored locally; nothing leaves this machine.`} />
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-3">
        <Panel title="Appearance & workspace">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Theme">
              <Select value={settings.theme} onChange={(e) => update({ theme: e.target.value as "ember" | "slate" })}>
                <option value="ember">Ember (warm dark)</option>
                <option value="slate">Slate (cool dark)</option>
              </Select>
            </Field>
            <Field label="List pane width (px)">
              <Input type="number" min={200} max={640} value={settings.listPanelWidth} onChange={(e) => update({ listPanelWidth: Number(e.target.value) })} />
            </Field>
            <Checkbox label="Ask before deleting" checked={settings.confirmDeletes} onChange={(v) => update({ confirmDeletes: v })} />
            <Checkbox label="Collapse sidebar" checked={settings.sidebarCollapsed} onChange={(v) => update({ sidebarCollapsed: v })} />
          </div>
        </Panel>
        <Panel title="Map & movement defaults">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Feet per cell">
              <Input type="number" min={1} value={settings.defaultCellFeet} onChange={(e) => update({ defaultCellFeet: Number(e.target.value) })} />
            </Field>
            <Field label="New floor width">
              <Input type="number" min={5} max={200} value={settings.defaultGridWidth} onChange={(e) => update({ defaultGridWidth: Number(e.target.value) })} />
            </Field>
            <Field label="New floor height">
              <Input type="number" min={5} max={200} value={settings.defaultGridHeight} onChange={(e) => update({ defaultGridHeight: Number(e.target.value) })} />
            </Field>
            <Field label="Diagonal rule" className="col-span-2">
              <Select value={settings.diagonalRule} onChange={(e) => update({ diagonalRule: e.target.value as "chebyshev" | "5-10-5" })}>
                <option value="chebyshev">Simple (every square 5 ft)</option>
                <option value="5-10-5">Variant (5-10-5 diagonals)</option>
              </Select>
            </Field>
            <Field label="Autosave map (min)">
              <Input type="number" min={0} value={settings.autosaveMapMinutes} onChange={(e) => update({ autosaveMapMinutes: Number(e.target.value) })} />
            </Field>
            <Checkbox label="Show grid" checked={settings.showGrid} onChange={(v) => update({ showGrid: v })} />
            <Checkbox label="Snap to grid" checked={settings.snapToGrid} onChange={(v) => update({ snapToGrid: v })} />
            <Checkbox label="Enforce movement budget" checked={settings.enforceMovementBudget} onChange={(v) => update({ enforceMovementBudget: v })} />
          </div>
          <div className="mt-3 text-right">
            <Button size="sm" variant="ghost" onClick={() => update(DEFAULT_SETTINGS)}>
              Reset to defaults
            </Button>
          </div>
        </Panel>
        <BackupPanel />
        <ExportImportPanel />
        <Panel title="Storage" className="col-span-2">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-ink-faint">Data folder</dt>
            <dd className="selectable font-mono text-[11.5px]">{paths?.data_dir}</dd>
            <dt className="text-ink-faint">Database</dt>
            <dd className="selectable font-mono text-[11.5px]">{paths?.db_path}</dd>
            <dt className="text-ink-faint">Assets</dt>
            <dd className="selectable font-mono text-[11.5px]">{paths?.assets_dir}</dd>
            <dt className="text-ink-faint">Backups</dt>
            <dd className="selectable font-mono text-[11.5px]">{paths?.backups_dir}</dd>
          </dl>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => paths && platform.revealInFolder(paths.db_path).catch((e) => toast.error(errorMessage(e)))}>
              <FolderOpen size={12} /> Reveal data folder
            </Button>
          </div>
          <p className="mt-3 text-[11.5px] text-ink-faint">
            Privacy: this application has no accounts, no telemetry and no network features. Files are stored unencrypted in your user profile; protect them with your operating system's disk encryption if needed.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function BackupPanel() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const qc = useQueryClient();
  const [inspect, setInspect] = useState<{ path: string; manifest: BackupManifest } | null>(null);
  const [busy, setBusy] = useState(false);

  const createBackup = async () => {
    const dest = await platform.pickSavePath({ title: "Save full backup", defaultPath: `dm-workbench-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: ARCHIVE_FILTER });
    if (!dest) return;
    setBusy(true);
    try {
      const info = await platform.createBackup(dest);
      toast.success(`Backup written (${formatBytes(info.size)}, ${info.asset_count} assets)`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pickRestore = async () => {
    const src = await platform.pickFile({ title: "Choose a backup to restore", filters: ARCHIVE_FILTER });
    if (!src) return;
    try {
      setInspect({ path: src, manifest: await platform.inspectBackup(src) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const restore = async () => {
    if (!inspect) return;
    setBusy(true);
    try {
      const result = await platform.restoreBackup(inspect.path);
      toast.success(`Restored. Previous database kept at ${result.previous_database}`);
      setInspect(null);
      await qc.invalidateQueries();
      window.location.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Backups (whole database + assets)">
      <p className="mb-2 text-[12px] text-ink-muted">A backup is a zip containing a consistent snapshot of the database and every asset. Restoring replaces all campaigns; the current database is kept next to the backups as a safety copy.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={createBackup}>
          <HardDriveDownload size={13} /> Create backup…
        </Button>
        <Button variant="outline" disabled={busy} onClick={pickRestore}>
          <HardDriveUpload size={13} /> Restore from backup…
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Checkbox label="Snapshot database on startup" checked={settings.autoBackupOnStart} onChange={(v) => update({ autoBackupOnStart: v })} />
        <Field label="Keep last N startup snapshots">
          <Input type="number" min={1} max={50} value={settings.autoBackupKeep} onChange={(e) => update({ autoBackupKeep: Number(e.target.value) })} />
        </Field>
      </div>
      {inspect && (
        <Dialog
          open
          onOpenChange={(o) => !o && setInspect(null)}
          title="Restore this backup?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setInspect(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busy} onClick={restore}>
                Replace everything and restore
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-ink-faint">File</dt>
            <dd className="selectable break-all font-mono text-[11px]">{inspect.path}</dd>
            <dt className="text-ink-faint">Created</dt>
            <dd>{formatDateTime(inspect.manifest.created_at)}</dd>
            <dt className="text-ink-faint">App version</dt>
            <dd>{inspect.manifest.app_version}</dd>
            <dt className="text-ink-faint">Assets</dt>
            <dd>{inspect.manifest.asset_count}</dd>
          </dl>
          <p className="mt-3 text-[12px] text-blood">All current campaigns are replaced. The current database is moved to the backups folder (pre-restore-*) so this can be undone manually. The app reloads afterwards.</p>
        </Dialog>
      )}
    </Panel>
  );
}

function ExportImportPanel() {
  const repos = useRepos();
  const qc = useQueryClient();
  const campaign = useCampaign();
  const campaigns = useCampaigns();
  const setCampaignId = useAppStore((s) => s.setCampaignId);
  const { appVersion } = useAppInfo();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ plan: ImportPlan; path: string; name: string } | null>(null);
  const [rename, setRename] = useState("");
  const missing = useQuery({ queryKey: ["missingRefs", campaign.data?.id], queryFn: () => findMissingReferences(repos.driver, campaign.data!.id), enabled: !!campaign.data });

  const doExport = async () => {
    if (!campaign.data) return;
    const dest = await platform.pickSavePath({ title: "Export campaign", defaultPath: `${slugify(campaign.data.name)}.zip`, filters: ARCHIVE_FILTER });
    if (!dest) return;
    setBusy(true);
    try {
      const bundle = await exportCampaign(repos.driver, campaign.data.id, appVersion);
      const size = await platform.writeCampaignArchive(dest, JSON.stringify(bundle), bundle.assets.map((a) => ({ rel_path: a.rel_path })));
      toast.success(`Exported ${campaign.data.name} (${formatBytes(size)})`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pickImport = async () => {
    const src = await platform.pickFile({ title: "Import campaign archive", filters: ARCHIVE_FILTER });
    if (!src) return;
    setBusy(true);
    try {
      const raw: unknown = JSON.parse(await platform.readArchiveText(src, "campaign.json"));
      const name = typeof raw === "object" && raw && "campaign_name" in raw ? String((raw as { campaign_name: unknown }).campaign_name) : "Imported campaign";
      const existing = (campaigns.data ?? []).some((c) => c.name === name);
      const planned = await planImport(repos.driver, raw, { renameTo: existing ? `${name} (imported)` : undefined });
      setRename(existing ? `${name} (imported)` : name);
      setPlan({ plan: planned, path: src, name });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = useAction(
    async () => {
      if (!plan) throw new Error("No import planned");
      const raw: unknown = JSON.parse(await platform.readArchiveText(plan.path, "campaign.json"));
      const finalPlan = await planImport(repos.driver, raw, { renameTo: rename.trim() || undefined });
      await applyImport(repos.driver, finalPlan);
      const extracted = await platform.extractArchiveAssets(plan.path, finalPlan.assetMap);
      return { id: finalPlan.newCampaignId, extracted, warnings: finalPlan.warnings };
    },
    {
      invalidate: ALL_KEYS,
      success: (r) => `Imported campaign with ${r.extracted} asset(s)${r.warnings.length ? ` · ${r.warnings.length} warning(s)` : ""}`,
      onSuccess: (r) => {
        setPlan(null);
        setCampaignId(r.id);
        void qc.invalidateQueries();
      },
    },
  );

  return (
    <Panel title="Campaign export / import">
      <p className="mb-2 text-[12px] text-ink-muted">Exports one campaign as a versioned archive (JSON + assets). Importing always creates a new campaign with fresh ids, so nothing existing is overwritten.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !campaign.data} onClick={doExport}>
          <Download size={13} /> Export “{campaign.data?.name ?? "…"}”
        </Button>
        <Button variant="outline" disabled={busy} onClick={pickImport}>
          <Upload size={13} /> Import campaign…
        </Button>
      </div>
      {(missing.data ?? []).length > 0 && (
        <div className="mt-3 text-[12px]">
          <div className="label">Integrity notes</div>
          {missing.data!.map((m) => (
            <div key={`${m.table}.${m.column}`} className="text-ink-muted">
              {m.count} row(s) in {m.table} have no {m.column} (references were removed; the app tolerates this).
            </div>
          ))}
        </div>
      )}
      {plan && (
        <Dialog
          open
          onOpenChange={(o) => !o && setPlan(null)}
          title={`Import “${plan.name}”`}
          footer={
            <Button variant="primary" disabled={apply.isPending} onClick={() => apply.mutate(undefined as never)}>
              <Archive size={13} /> Import as new campaign
            </Button>
          }
        >
          <Field label="Name for the imported campaign">
            <Input value={rename} onChange={(e) => setRename(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-1">
            {Object.entries(plan.plan.counts).map(([table, n]) => (
              <Badge key={table}>
                {n} {table}
              </Badge>
            ))}
          </div>
          {plan.plan.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-[12px] text-gold">
              {plan.plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </Panel>
  );
}
