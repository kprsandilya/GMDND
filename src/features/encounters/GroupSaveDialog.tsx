import { Dices } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { Button, Checkbox, Dialog, Field, Input, Select } from "@/components/ui";
import { parseDice, roll } from "@/domain/dice";
import { finalizeRow, rollGroupSave, summarizeGroupSave, type GroupSaveOptions, type GroupSaveRow } from "@/domain/groupCombat";
import { SAVE_ABILITY_NAMES } from "@/domain/statblock";
import type { Combatant } from "@/domain/types";
import { syncCombatantToToken } from "@/domain/workflows/encounterWorkflow";
import { cn, errorMessage } from "@/lib/utils";

export interface GroupSavePreset {
  ability?: string;
  dc?: number;
  damage?: string | null;
  source?: string;
}

/**
 * Group saving throw and/or mass damage. Damage is rolled once for the group; each target rolls its own
 * save with the bonus from its instance sheet. Every die stays editable before anything is applied.
 */
export function GroupSaveDialog({
  open,
  onOpenChange,
  runId,
  combatants,
  initialTargets,
  preset,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  combatants: Combatant[];
  initialTargets: string[];
  preset: GroupSavePreset | null;
  onDone: () => void;
}) {
  const repos = useRepos();
  const [targets, setTargets] = useState<Set<string>>(new Set(initialTargets));
  const [ability, setAbility] = useState("dexterity");
  const [dc, setDc] = useState("13");
  const [damageText, setDamageText] = useState("");
  const [damage, setDamage] = useState(0);
  const [half, setHalf] = useState(true);
  const [saveRoll, setSaveRoll] = useState(true);
  const [rows, setRows] = useState<GroupSaveRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargets(new Set(initialTargets));
    setAbility(preset?.ability ?? "dexterity");
    setDc(String(preset?.dc ?? 13));
    setDamageText(preset?.damage ?? "");
    setDamage(0);
    setHalf(true);
    setSaveRoll(true);
    setRows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options: GroupSaveOptions = { ability, dc: Number(dc) || 0, damage, halfOnSuccess: half };
  const resolveDamage = (): number => {
    const text = damageText.trim();
    if (!text) return 0;
    const parsed = parseDice(text);
    if (!parsed) throw new Error(`Not a number or dice expression: ${text}`);
    return Math.max(0, roll(parsed).total);
  };

  const rollAll = () => {
    try {
      const amount = resolveDamage();
      setDamage(amount);
      const chosen = combatants.filter((c) => targets.has(c.id));
      const opts = { ...options, damage: amount };
      setRows(
        saveRoll
          ? rollGroupSave(chosen, opts)
          : chosen.map((c) => ({ id: c.id, name: c.name, roll: 0, bonus: 0, total: 0, success: false, damage: amount })),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const editRow = (id: string, patch: Partial<GroupSaveRow>) =>
    setRows((current) => (current ?? []).map((r) => (r.id === id ? (saveRoll ? finalizeRow({ ...r, ...patch }, options) : { ...r, ...patch }) : r)));

  const spendLegendaryResistance = async (row: GroupSaveRow) => {
    try {
      await repos.encounters.adjustResource(row.id, "legres", -1, "legendary resistance to succeed instead");
      editRow(row.id, { roll: Math.max(row.roll, options.dc - row.bonus) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const summary = saveRoll ? summarizeGroupSave(rows, options, preset?.source) : `${preset?.source ? `${preset.source}: ` : ""}${damage} damage to ${rows.map((r) => r.name).join(", ")}.`;
      const updated = await repos.encounters.applyGroupSave(runId, rows, summary);
      for (const c of updated) await syncCombatantToToken(repos, c);
      const concentrating = updated.filter((c) => c.hp > 0 && c.conditions.some((x) => x.name === "concentrating"));
      if (concentrating.length) toast.warning(`Concentration checks: ${concentrating.map((c) => c.name).join(", ")}`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const alive = combatants.filter((c) => !c.defeated);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={preset?.source ? `Group save — ${preset.source}` : "Group save / mass damage"}
      description="Damage is rolled once for everyone. Each target rolls its own save using its instance sheet. Edit any die before applying."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={rollAll} disabled={targets.size === 0}>
            <Dices size={12} /> {rows ? "Re-roll" : "Roll"}
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={!rows || busy}>
            Apply to {rows?.length ?? 0} target(s)
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12.5px]">
        <div className="grid grid-cols-4 gap-2">
          <Field label="Saving throw">
            <Select value={ability} disabled={!saveRoll} onChange={(e) => setAbility(e.target.value)}>
              {SAVE_ABILITY_NAMES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="DC">
            <Input type="number" value={dc} disabled={!saveRoll} onChange={(e) => setDc(e.target.value)} />
          </Field>
          <Field label="Damage (number or dice)">
            <Input value={damageText} placeholder="8d6" onChange={(e) => setDamageText(e.target.value)} />
          </Field>
          <div className="space-y-1 pt-4">
            <Checkbox label="Roll saves" checked={saveRoll} onChange={setSaveRoll} />
            <Checkbox label="Half on success" checked={half} onChange={setHalf} className={cn(!saveRoll && "opacity-50")} />
          </div>
        </div>
        <div>
          <div className="label flex items-center gap-2">
            Targets
            <button className="text-[11px] normal-case text-ink-faint hover:text-ink" onClick={() => setTargets(new Set(alive.filter((c) => c.side === "enemy").map((c) => c.id)))}>
              all enemies
            </button>
            <button className="text-[11px] normal-case text-ink-faint hover:text-ink" onClick={() => setTargets(new Set(alive.filter((c) => c.side === "party").map((c) => c.id)))}>
              all party
            </button>
            <button className="text-[11px] normal-case text-ink-faint hover:text-ink" onClick={() => setTargets(new Set())}>
              none
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {alive.map((c) => (
              <button
                key={c.id}
                className={cn("chip", targets.has(c.id) && "border-ember text-ember-soft")}
                onClick={() => {
                  const next = new Set(targets);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  setTargets(next);
                  setRows(null);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {rows && (
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] text-ink-faint">
              <tr>
                <th className="py-1">Target</th>
                {saveRoll && (
                  <>
                    <th>d20</th>
                    <th>Bonus</th>
                    <th>Total</th>
                    <th>Result</th>
                  </>
                )}
                <th>Damage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = combatants.find((x) => x.id === r.id);
                const legres = Number(c?.resources.legres ?? 0);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1">{r.name}</td>
                    {saveRoll && (
                      <>
                        <td>
                          <Input type="number" className="h-6 w-14" value={r.roll} onChange={(e) => editRow(r.id, { roll: Number(e.target.value) || 0 })} />
                        </td>
                        <td>
                          <Input type="number" className="h-6 w-14" value={r.bonus} onChange={(e) => editRow(r.id, { bonus: Number(e.target.value) || 0 })} />
                        </td>
                        <td className="font-mono">{r.total}</td>
                        <td className={r.success ? "text-moss" : "text-blood"}>{r.success ? "saved" : "failed"}</td>
                      </>
                    )}
                    <td>
                      <Input type="number" className="h-6 w-16" value={r.damage} onChange={(e) => setRows((cur) => (cur ?? []).map((x) => (x.id === r.id ? { ...x, damage: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                    </td>
                    <td>
                      {saveRoll && !r.success && legres > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => void spendLegendaryResistance(r)} title="Spend a legendary resistance to succeed">
                          LR ({legres})
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {rows && damage > 0 && <p className="text-[11px] text-ink-faint">Rolled damage: {damage}{half && saveRoll ? ` (half: ${Math.floor(damage / 2)})` : ""}</p>}
      </div>
    </Dialog>
  );
}
