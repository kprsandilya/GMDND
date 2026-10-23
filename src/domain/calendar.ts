import type { CampaignCalendar } from "./types";

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function daysInYear(calendar: CampaignCalendar): number {
  return calendar.months.reduce((sum, m) => sum + m.days, 0);
}

export function addDays(calendar: CampaignCalendar, date: CalendarDate, days: number): CalendarDate {
  let { year, month, day } = date;
  let remaining = days;
  while (remaining > 0) {
    const monthDays = calendar.months[month - 1]?.days ?? 30;
    if (day + remaining <= monthDays) {
      day += remaining;
      remaining = 0;
    } else {
      remaining -= monthDays - day + 1;
      day = 1;
      month += 1;
      if (month > calendar.months.length) {
        month = 1;
        year += 1;
      }
    }
  }
  while (remaining < 0) {
    if (day + remaining >= 1) {
      day += remaining;
      remaining = 0;
    } else {
      remaining += day;
      month -= 1;
      if (month < 1) {
        month = calendar.months.length;
        year -= 1;
      }
      day = calendar.months[month - 1]?.days ?? 30;
    }
  }
  return { year, month, day };
}

export function formatDate(calendar: CampaignCalendar, date: CalendarDate): string {
  const monthName = calendar.months[date.month - 1]?.name ?? `Month ${date.month}`;
  const weekday = weekdayName(calendar, date);
  return `${weekday ? `${weekday}, ` : ""}${ordinal(date.day)} of ${monthName}, ${date.year}${calendar.era ? ` ${calendar.era}` : ""}`;
}

export function dayOfYear(calendar: CampaignCalendar, date: CalendarDate): number {
  let total = 0;
  for (let i = 0; i < date.month - 1; i++) total += calendar.months[i]?.days ?? 30;
  return total + date.day;
}

export function weekdayName(calendar: CampaignCalendar, date: CalendarDate): string | null {
  if (!calendar.weekdays.length) return null;
  const absolute = date.year * daysInYear(calendar) + dayOfYear(calendar, date);
  return calendar.weekdays[((absolute % calendar.weekdays.length) + calendar.weekdays.length) % calendar.weekdays.length] ?? null;
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
