import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { platform } from "@/app/platform";
import { Button, Input } from "@/components/ui";
import { DEFAULT_TABLE_VIEW, TABLE_VIEW_SETTING, type TableViewSettings } from "@/domain/tableView";
import { errorMessage } from "@/lib/utils";

/** Toolbar control: send the current floor to the table display window and set what players see. */
export function TableControl({ floorId }: { floorId: string | null }) {
  const repos = useRepos();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const settings = useQuery({ queryKey: ["tableView", "settings"], queryFn: () => repos.settings.get<TableViewSettings>(TABLE_VIEW_SETTING, DEFAULT_TABLE_VIEW) });
  const view = { ...DEFAULT_TABLE_VIEW, ...(settings.data ?? {}) };
  const save = async (patch: Partial<TableViewSettings>) => {
    await repos.settings.set(TABLE_VIEW_SETTING, { ...view, ...patch });
    void qc.invalidateQueries({ queryKey: ["tableView", "settings"] });
  };
  const send = async () => {
    try {
      await save({ floor_id: floorId });
      await platform.openTableWindow();
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const showing = !!floorId && view.floor_id === floorId;
  return (
    <div className="relative">
      <Button size="sm" variant={open ? "secondary" : "ghost"} onClick={() => setOpen((o) => !o)} title="Player-facing table display on a second screen">
        <MonitorUp size={13} /> Table{showing ? " •" : ""}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 space-y-2 rounded border border-border-strong bg-bg-elevated p-2 text-[12px] shadow-xl">
          <p className="text-[11px] text-ink-faint">
            Opens a second window for a screen the players can see. Hidden objects, undiscovered doors, DM-only markers and enemy HP are never shown.
          </p>
          <Button size="sm" variant="primary" className="w-full" disabled={!floorId} onClick={() => void send()}>
            {showing ? "Show table window" : "Send this floor to the table"}
          </Button>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={view.fog} onChange={(e) => void save({ fog: e.target.checked })} className="accent-ember" />
            Fog of war (only explored rooms)
          </label>
          <label className="flex items-center gap-2">
            Light radius around PCs
            <Input type="number" min={0} max={12} className="h-6 w-14" value={view.light_radius} disabled={!view.fog} onChange={(e) => void save({ light_radius: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })} />
            cells
          </label>
          {view.floor_id && (
            <button className="text-[11px] text-ink-faint hover:text-blood" onClick={() => void save({ floor_id: null })}>
              Blank the table
            </button>
          )}
        </div>
      )}
    </div>
  );
}
