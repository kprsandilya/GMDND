import type { Repositories } from "@/persistence/repositories";

const LOOT_PATTERN = /treasure|picks? up|loot|takes .* from|gives|receives|gold|gp\b/i;
const EVENT_KINDS = new Set(["movement", "door", "marker", "trap", "travel", "note", "time", "campaign", "quest"]);

export interface SessionRecapData {
  encounters: { name: string; status: string; rounds: number; defeated: string[]; fallen: string[] }[];
  loot: string[];
  events: string[];
}

/** Collects what happened in a session from its encounter runs and the campaign log. */
export async function collectSessionRecap(repos: Repositories, campaignId: string, sessionId: string): Promise<SessionRecapData> {
  const runs = (await repos.encounters.runs(campaignId)).filter((r) => r.session_id === sessionId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const encounters: SessionRecapData["encounters"] = [];
  for (const run of runs) {
    const combatants = await repos.encounters.combatants(run.id);
    encounters.push({
      name: run.name,
      status: run.status,
      rounds: run.round,
      defeated: combatants.filter((c) => c.defeated && c.side !== "party").map((c) => c.name),
      fallen: combatants.filter((c) => c.side === "party" && (c.defeated || c.hp === 0)).map((c) => c.name),
    });
  }
  const log = await repos.campaignLog.forSession(sessionId);
  const loot: string[] = [];
  const events: string[] = [];
  for (const entry of log) {
    if (entry.kind === "inventory" || (entry.kind === "encounter" && LOOT_PATTERN.test(entry.message))) loot.push(entry.message);
    else if (EVENT_KINDS.has(entry.kind) && entry.kind !== "movement") events.push(entry.message);
  }
  return { encounters, loot, events };
}

/** Markdown summary for the session recap: encounters with defeated foes, loot that changed hands, and notable events. */
export function formatSessionRecap(data: SessionRecapData): string {
  const lines: string[] = [];
  if (data.encounters.length) {
    lines.push("### Encounters");
    for (const e of data.encounters) {
      const rounds = e.rounds ? `, ${e.rounds} round${e.rounds === 1 ? "" : "s"}` : "";
      let line = `- **${e.name}** (${e.status}${rounds})`;
      if (e.defeated.length) line += ` — defeated ${e.defeated.join(", ")}`;
      if (e.fallen.length) line += `; fell: ${e.fallen.join(", ")}`;
      lines.push(line);
    }
  }
  if (data.loot.length) {
    if (lines.length) lines.push("");
    lines.push("### Loot");
    for (const l of data.loot) lines.push(`- ${l}`);
  }
  if (data.events.length) {
    if (lines.length) lines.push("");
    lines.push("### Events");
    for (const l of data.events.slice(0, 40)) lines.push(`- ${l}`);
  }
  return lines.length ? lines.join("\n") : "_Nothing was logged for this session yet._";
}
