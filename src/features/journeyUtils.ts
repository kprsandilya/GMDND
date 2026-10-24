/**
 * Pure helper functions shared by JourneyTimelineTab and PartiesPage.
 * Extracted so they can be unit-tested in a node environment without React.
 */

import type { EnrichedSegment, ExtendedTimelineEvent, Journey } from "@/domain/journeyTypes";

// ── Date formatting ──

/** Format a partial calendar date as "YYYY-MM-DD", omitting missing parts. Returns "" when year is null. */
export function formatCalendarDate(year: number | null, month: number | null, day: number | null): string {
  if (year == null) return "";
  const parts: string[] = [String(year)];
  if (month != null) parts.push(String(month).padStart(2, "0"));
  if (day != null) parts.push(String(day).padStart(2, "0"));
  return parts.join("-");
}

/** Format a start→end date range. Returns null when both dates are absent. */
export function dateRange(
  sy: number | null, sm: number | null, sd: number | null,
  ey: number | null, em: number | null, ed: number | null,
): string | null {
  const start = formatCalendarDate(sy, sm, sd);
  const end = formatCalendarDate(ey, em, ed);
  if (!start && !end) return null;
  if (start && end) return `${start} → ${end}`;
  if (start) return `from ${start}`;
  return `until ${end}`;
}

/** Format a partial date as "YYYY/MM/DD" (slash-separated), used in party membership display. Returns "unknown date" when year is null. */
export function formatPartialDate(year: number | null, month: number | null, day: number | null): string {
  if (year == null) return "unknown date";
  const parts = [String(year)];
  if (month != null) parts.push(String(month).padStart(2, "0"));
  if (day != null) parts.push(String(day).padStart(2, "0"));
  return parts.join("/");
}

/** Format a Journey's start/end date range. Returns null when both are absent. */
export function formatJourneyDateRange(j: Journey): string | null {
  const start = formatPartialDate(j.start_year, j.start_month, j.start_day);
  const end = formatPartialDate(j.end_year, j.end_month, j.end_day);
  if (start === "unknown date" && end === "unknown date") return null;
  if (start === "unknown date") return `until ${end}`;
  if (end === "unknown date") return `from ${start}`;
  return `${start} — ${end}`;
}

// ── Data derivation ──

/** Derive the current/last known location from the latest segment destination (Req 7.6). */
export function deriveCurrentLocation(segments: EnrichedSegment[]): { id: string; name: string } | null {
  if (segments.length === 0) return null;
  // Segments are already sorted by date ascending — pick the last one with a destination
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.destination_entity_id && seg.destination_name) {
      return { id: seg.destination_entity_id, name: seg.destination_name };
    }
  }
  return null;
}

/** Group timeline events by session (Req 7.3). Groups with a session come first, "No session" group last. */
export function groupEventsBySession(
  events: ExtendedTimelineEvent[],
  sessionNames: Map<string, string>,
): { sessionLabel: string; sessionId: string | null; events: ExtendedTimelineEvent[] }[] {
  const groups = new Map<string, { sessionLabel: string; sessionId: string | null; events: ExtendedTimelineEvent[] }>();
  const NO_SESSION = "__no_session__";

  for (const ev of events) {
    const key = ev.session_id ?? NO_SESSION;
    if (!groups.has(key)) {
      const label = ev.session_id ? (sessionNames.get(ev.session_id) ?? "Unknown session") : "No session";
      groups.set(key, { sessionLabel: label, sessionId: ev.session_id, events: [] });
    }
    groups.get(key)!.events.push(ev);
  }

  // Put groups with a session first, then "No session" last
  const result = [...groups.values()];
  const noSession = result.findIndex((g) => g.sessionId === null);
  if (noSession >= 0 && noSession < result.length - 1) {
    const [ns] = result.splice(noSession, 1);
    result.push(ns);
  }
  return result;
}

// ── Filtering ──

/** Filter enriched segments to only those with a specific member as participant. No-op when memberFilter is empty. */
export function filterSegmentsByMember(segments: EnrichedSegment[], memberFilter: string): EnrichedSegment[] {
  if (!memberFilter) return segments;
  return segments.filter((s) => s.participants.some((p) => p.entity_id === memberFilter));
}
