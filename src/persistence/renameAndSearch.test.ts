import { describe, expect, it } from "vitest";
import { renameWikiTarget } from "@/domain/markdown";
import { createCampaign } from "@/domain/workflows/campaignWorkflow";
import { scoreSearchHit } from "./repositories/entities";
import { testRepos } from "./testUtils";

describe("wiki links follow renames", () => {
  it("rewrites bare and labelled links, case-insensitively, and leaves others alone", () => {
    const md = "Meet [[Old Mill]] and [[old mill|the mill]] near [[Old Millpond]].";
    expect(renameWikiTarget(md, "Old Mill", "Grey Mill")).toBe("Meet [[Grey Mill]] and [[Grey Mill|the mill]] near [[Old Millpond]].");
  });

  it("updates every record in the campaign when a record is renamed", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    const mill = await repos.entities.create({ campaign_id: campaign.id, kind: "location", name: "Old Mill" });
    const npc = await repos.entities.create({ campaign_id: campaign.id, kind: "npc", name: "Miller", body_md: "Lives at [[Old Mill]].", secret_md: "Hides gold in [[Old Mill|the mill]]." });
    const session = await repos.entities.create({ campaign_id: campaign.id, kind: "session", name: "S1", fields: { recap_md: "We reached [[Old Mill]]." } });
    const other = await createCampaign(repos, { name: "Other" });
    const foreign = await repos.entities.create({ campaign_id: other.campaign.id, kind: "npc", name: "Far", body_md: "[[Old Mill]]" });

    await repos.entities.update(mill.id, { name: "Grey Mill" });

    expect((await repos.entities.get(npc.id)).body_md).toBe("Lives at [[Grey Mill]].");
    expect((await repos.entities.get(npc.id)).secret_md).toBe("Hides gold in [[Grey Mill|the mill]].");
    expect((await repos.entities.get(session.id)).fields.recap_md).toBe("We reached [[Grey Mill]].");
    expect((await repos.entities.get(foreign.id)).body_md).toBe("[[Old Mill]]");
  });

  it("does not rewrite when another record still has the old name", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    const a = await repos.entities.create({ campaign_id: campaign.id, kind: "location", name: "Tower" });
    await repos.entities.create({ campaign_id: campaign.id, kind: "location", name: "Tower" });
    const note = await repos.entities.create({ campaign_id: campaign.id, kind: "article", name: "Note", body_md: "See [[Tower]]." });
    await repos.entities.update(a.id, { name: "North Tower" });
    expect((await repos.entities.get(note.id)).body_md).toBe("See [[Tower]].");
  });
});

describe("ranked search", () => {
  const base = { summary: "", body_md: "", read_aloud_md: "", dm_notes_md: "", secret_md: "", tags: [] as string[] };

  it("ranks name matches above body matches and requires every word", () => {
    expect(scoreSearchHit({ ...base, name: "Fen Cultist" }, "cultist")).toBeGreaterThan(scoreSearchHit({ ...base, name: "Hut", body_md: "a cultist lives here" }, "cultist"));
    expect(scoreSearchHit({ ...base, name: "Cultist" }, "cultist")).toBeGreaterThan(scoreSearchHit({ ...base, name: "Fen Cultist" }, "cultist"));
    expect(scoreSearchHit({ ...base, name: "Fen Cultist" }, "fen dragon")).toBe(0);
  });

  it("finds records whose words are spread across fields and orders by relevance", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    await repos.entities.create({ campaign_id: campaign.id, kind: "npc", name: "Harbour Master", summary: "Keeps the docks", body_md: "Knows about the smuggler ring." });
    await repos.entities.create({ campaign_id: campaign.id, kind: "location", name: "Smuggler Docks" });
    await repos.entities.create({ campaign_id: campaign.id, kind: "item", name: "Rope", body_md: "Found at the docks." });
    const hits = await repos.entities.search(campaign.id, "smuggler docks");
    expect(hits.map((h) => h.entity.name)).toEqual(["Smuggler Docks", "Harbour Master"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });
});
