import { describe, expect, it } from "vitest";
import { testRepos } from "@/persistence/testUtils";
import { SRD_LIBRARY_VERSION } from "@/domain/srd2024";
import { countStandardRecords, seedSrdLibrary, srdLibrarySize } from "./srdLibrary";

describe("SRD-2024 standard library", () => {
  it("seeds the bundled standard set into the shared (campaign-independent) space", async () => {
    const { repos } = await testRepos();
    const size = await srdLibrarySize();
    expect(size.creatures).toBeGreaterThan(100);
    expect(size.items).toBeGreaterThan(100);

    const result = await seedSrdLibrary(repos);
    expect(result.seeded).toBe(true);
    expect(result.version).toBe(SRD_LIBRARY_VERSION);

    // Every standard record lives with campaign_id = NULL.
    const total = await countStandardRecords(repos);
    expect(total).toBe(size.creatures + size.items);
    const campaignScoped = await repos.driver.select<{ n: number }>(
      "SELECT count(*) AS n FROM entities WHERE campaign_id IS NOT NULL AND json_extract(fields, '$.source') = 'srd-2024'",
    );
    expect(Number(campaignScoped[0]!.n)).toBe(0);
  });

  it("is idempotent and does not duplicate on a second run", async () => {
    const { repos } = await testRepos();
    await seedSrdLibrary(repos);
    const after1 = await countStandardRecords(repos);
    const second = await seedSrdLibrary(repos);
    expect(second.seeded).toBe(false);
    const after2 = await countStandardRecords(repos);
    expect(after2).toBe(after1);
  });

  it("exposes standard records in a campaign via include_shared and the source filter", async () => {
    const { repos } = await testRepos();
    await seedSrdLibrary(repos);
    const campaign = await repos.entities.create({ kind: "campaign", name: "My Campaign" });
    const custom = await repos.entities.create({ kind: "creature", name: "Homebrew Horror", campaign_id: campaign.id, fields: { cr: "5" } });

    // Campaign-only (default): just the custom creature, no standard ones.
    const own = await repos.entities.list({ campaign_id: campaign.id, kinds: ["creature"] });
    expect(own.map((e) => e.id)).toEqual([custom.id]);

    // Including the shared library: both custom and standard are visible.
    const all = await repos.entities.list({ campaign_id: campaign.id, kinds: ["creature"], include_shared: true });
    expect(all.length).toBeGreaterThan(own.length);
    expect(all.some((e) => e.id === custom.id)).toBe(true);
    expect(all.some((e) => e.fields.source === "srd-2024")).toBe(true);

    // source = "standard": only library records.
    const standard = await repos.entities.list({ campaign_id: campaign.id, kinds: ["creature"], include_shared: true, source: "standard" });
    expect(standard.length).toBeGreaterThan(0);
    expect(standard.every((e) => e.fields.source === "srd-2024")).toBe(true);
    expect(standard.some((e) => e.id === custom.id)).toBe(false);

    // source = "custom": only the campaign's own record.
    const customOnly = await repos.entities.list({ campaign_id: campaign.id, kinds: ["creature"], include_shared: true, source: "custom" });
    expect(customOnly.map((e) => e.id)).toEqual([custom.id]);
  });

  it("keeps standard records out of a campaign export", async () => {
    const { repos, driver } = await testRepos();
    await seedSrdLibrary(repos);
    const campaign = await repos.entities.create({ kind: "campaign", name: "Exported" });
    await repos.entities.create({ kind: "creature", name: "Local Beast", campaign_id: campaign.id });
    const { exportCampaign } = await import("@/persistence/exportImport");
    const bundle = await exportCampaign(driver, campaign.id, "test");
    const exportedCreatures = bundle.tables.entities.filter((r) => r.kind === "creature");
    expect(exportedCreatures.every((r) => r.campaign_id === campaign.id)).toBe(true);
    expect(exportedCreatures.some((r) => String(r.id).startsWith("srd::"))).toBe(false);
  });
});
