import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRepos } from "@/app/appContext";
import { useAction } from "@/app/queries";
import { Button, Field, Input, Panel } from "@/components/ui";
import { formatDate } from "@/domain/calendar";
import { calendarSchema } from "@/domain/schemas";
import type { CampaignCalendar, Entity } from "@/domain/types";
import { campaignFields } from "@/domain/workflows/campaignWorkflow";

/** Configurable fantasy calendar: months, weekdays, era and the current in-world date. */
export function CalendarEditor({ campaign }: { campaign: Entity }) {
  const repos = useRepos();
  const [calendar, setCalendar] = useState<CampaignCalendar>(() => campaignFields(campaign).calendar!);
  const [weekdays, setWeekdays] = useState(calendar.weekdays.join(", "));
  const [error, setError] = useState<string | null>(null);
  const save = useAction(
    async () => {
      const parsed = calendarSchema.safeParse({ ...calendar, weekdays: weekdays.split(",").map((w) => w.trim()).filter(Boolean) });
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const month = parsed.data.months[parsed.data.month - 1];
      if (!month) throw new Error("Current month is out of range");
      if (parsed.data.day > month.days) throw new Error(`Current day exceeds the ${month.days} days of ${month.name}`);
      return repos.entities.update(campaign.id, { fields: { ...campaign.fields, calendar: parsed.data } });
    },
    { success: "Calendar saved", invalidate: [["entities"], ["campaignState"]], onSuccess: () => setError(null) },
  );
  const updateMonth = (i: number, patch: Partial<{ name: string; days: number }>) => setCalendar({ ...calendar, months: calendar.months.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });

  return (
    <Panel title="Calendar" actions={<span className="text-[11px] text-ink-faint">Today: {formatDate(calendar, { year: calendar.year, month: calendar.month, day: calendar.day })}</span>}>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Era">
          <Input value={calendar.era} onChange={(e) => setCalendar({ ...calendar, era: e.target.value })} />
        </Field>
        <Field label="Year">
          <Input type="number" value={calendar.year} onChange={(e) => setCalendar({ ...calendar, year: Number(e.target.value) })} />
        </Field>
        <Field label="Month (1-based)">
          <Input type="number" min={1} max={calendar.months.length} value={calendar.month} onChange={(e) => setCalendar({ ...calendar, month: Number(e.target.value) })} />
        </Field>
        <Field label="Day">
          <Input type="number" min={1} value={calendar.day} onChange={(e) => setCalendar({ ...calendar, day: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Weekdays" hint="Comma separated; leave empty for no week cycle." className="mt-2">
        <Input value={weekdays} onChange={(e) => setWeekdays(e.target.value)} />
      </Field>
      <div className="label mt-3">Months</div>
      <div className="grid grid-cols-2 gap-1">
        {calendar.months.map((m, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-5 text-right text-[11px] text-ink-faint">{i + 1}</span>
            <Input value={m.name} onChange={(e) => updateMonth(i, { name: e.target.value })} />
            <Input type="number" min={1} className="w-16" value={m.days} onChange={(e) => updateMonth(i, { days: Number(e.target.value) })} />
            <button className="text-ink-faint hover:text-blood" onClick={() => setCalendar({ ...calendar, months: calendar.months.filter((_, idx) => idx !== i) })} aria-label="Remove month">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setCalendar({ ...calendar, months: [...calendar.months, { name: `Month ${calendar.months.length + 1}`, days: 30 }] })}>
          <Plus size={12} /> Add month
        </Button>
        <span className="flex-1 text-[12px] text-blood">{error ?? (save.error ? String(save.error.message) : "")}</span>
        <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate(undefined as never)}>
          Save calendar
        </Button>
      </div>
    </Panel>
  );
}
