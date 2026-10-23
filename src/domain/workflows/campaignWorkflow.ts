import { campaignFieldsSchema } from "../schemas";
import { addDays } from "../calendar";
import type { CampaignFields, Entity, EntityKind, SessionNote } from "../types";
import type { Repositories } from "@/persistence/repositories";

export async function createCampaign(repos: Repositories, input: { name: string; summary?: string; worldName?: string; edition?: string }): Promise<{ campaign: Entity; world: Entity }> {
  const fields = campaignFieldsSchema.parse({ edition: input.edition ?? "5e (2014)" });
  const campaign = await repos.entities.create({ kind: "campaign", name: input.name, summary: input.summary ?? "", fields });
  const world = await repos.entities.create({ kind: "world", name: input.worldName ?? `${input.name} World`, campaign_id: campaign.id });
  await repos.entities.update(world.id, { world_id: world.id });
  await repos.campaignLog.add(campaign.id, "campaign", `Campaign "${campaign.name}" created.`);
  return { campaign, world };
}

export async function deleteCampaign(repos: Repositories, campaignId: string): Promise<void> {
  // Rooms are entities whose campaign_id cascades; floors cascade from the dungeon entity.
  await repos.entities.delete(campaignId);
}

export function campaignFields(campaign: Entity): CampaignFields {
  return campaignFieldsSchema.parse(campaign.fields ?? {}) as CampaignFields;
}

export async function advanceCampaignDate(repos: Repositories, campaignId: string, days: number, sessionId: string | null = null): Promise<Entity> {
  const campaign = await repos.entities.get(campaignId);
  const fields = campaignFields(campaign);
  const calendar = fields.calendar!;
  const next = addDays(calendar, { year: calendar.year, month: calendar.month, day: calendar.day }, days);
  const updated = await repos.entities.update(campaignId, { fields: { ...fields, calendar: { ...calendar, ...next } } });
  await repos.campaignLog.add(campaignId, "time", `${days} day(s) pass.`, {}, sessionId);
  return updated;
}

export async function setPartyLocation(repos: Repositories, campaignId: string, locationId: string | null, sessionId: string | null = null): Promise<Entity> {
  const campaign = await repos.entities.get(campaignId);
  const fields = campaignFields(campaign);
  const updated = await repos.entities.update(campaignId, { fields: { ...fields, party_location_id: locationId } });
  if (locationId) {
    const location = await repos.entities.get(locationId);
    const locFields = { ...(location.fields as Record<string, unknown>), discovered: true };
    await repos.entities.update(locationId, { fields: locFields });
    await repos.campaignLog.add(campaignId, "travel", `The party travels to ${location.name}.`, { location_id: locationId }, sessionId);
  }
  return updated;
}

export async function setActiveSession(repos: Repositories, campaignId: string, sessionId: string | null): Promise<Entity> {
  const campaign = await repos.entities.get(campaignId);
  const fields = campaignFields(campaign);
  return repos.entities.update(campaignId, { fields: { ...fields, active_session_id: sessionId } });
}

/** Turns a quick session note into a permanent record (lore article, event, secret, quest...). */
export async function promoteNote(
  repos: Repositories,
  note: SessionNote,
  target: { kind: EntityKind; name: string; link_to?: string | null },
): Promise<Entity> {
  const entity = await repos.entities.create({
    kind: target.kind,
    name: target.name,
    campaign_id: note.campaign_id,
    body_md: note.body,
    summary: note.body.length > 180 ? `${note.body.slice(0, 177)}…` : note.body,
    tags: ["from-session"],
  });
  if (target.link_to) await repos.entities.link(entity.id, target.link_to, "related", "promoted from session note");
  await repos.entities.link(entity.id, note.session_id, "recorded_in");
  await repos.sessionNotes.update(note.id, { promoted_to: entity.id, resolved: true });
  await repos.campaignLog.add(note.campaign_id, "note", `Session note promoted to ${target.kind}: ${target.name}`, { entity_id: entity.id }, note.session_id);
  return entity;
}

export interface CampaignState {
  campaign: Entity;
  fields: CampaignFields;
  partyLocation: Entity | null;
  activeSession: Entity | null;
  party: Entity[];
  activeQuests: Entity[];
  activeRuns: number;
  openNotes: SessionNote[];
  counts: Record<string, number>;
}

export async function loadCampaignState(repos: Repositories, campaignId: string): Promise<CampaignState> {
  const campaign = await repos.entities.get(campaignId);
  const fields = campaignFields(campaign);
  const [partyLocation, activeSession, party, activeQuests, runs, openNotes, counts] = await Promise.all([
    repos.entities.find(fields.party_location_id),
    repos.entities.find(fields.active_session_id),
    repos.entities.list({ campaign_id: campaignId, kinds: ["pc"] }),
    repos.entities.list({ campaign_id: campaignId, kinds: ["quest"], status: "active" }),
    repos.encounters.runs(campaignId, ["active", "prepared"]),
    repos.sessionNotes.unresolved(campaignId),
    repos.entities.countByKind(campaignId),
  ]);
  return { campaign, fields, partyLocation, activeSession, party, activeQuests, activeRuns: runs.length, openNotes, counts };
}
