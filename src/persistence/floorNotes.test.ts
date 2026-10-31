import { describe, expect, it } from "vitest";
import { playerView } from "@/domain/tableView";
import { createCampaign } from "@/domain/workflows/campaignWorkflow";
import { applyImport, exportCampaign, planImport } from "./exportImport";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrate } from "./migrations";
import { NodeSqlDriver } from "./nodeDriver";
import { createRepositories } from "./repositories";
import { testRepos } from "./testUtils";

async function setup() {
  const { repos, driver } = await testRepos();
  const { campaign } = await createCampaign(repos, { name: "T" });
  const dungeon = await repos.entities.create({ campaign_id: campaign.id, kind: "dungeon", name: "Crypt" });
  const floor = await repos.dungeons.createFloor({ dungeon_id: dungeon.id, name: "Upper Vault", width: 10, height: 10 });
  return { repos, driver, campaign, floor };
}

describe("floor notes", () => {
  it("start empty and save Markdown with wiki links", async () => {
    const { repos, floor } = await setup();
    expect(floor.notes_md).toBe("");
    const saved = await repos.dungeons.updateFloor(floor.id, { notes_md: "Stairs lead down to [[The Ossuary]]." });
    expect(saved.notes_md).toBe("Stairs lead down to [[The Ossuary]].");
    expect((await repos.dungeons.loadFloor(floor.id)).floor.notes_md).toBe("Stairs lead down to [[The Ossuary]].");
  });

  it("upgrades an existing database: old floors get empty notes", async () => {
    const driver = new NodeSqlDriver(":memory:");
    // build a schema-v3 database by hand, add a floor, then run the real migration
    await driver.executeScript("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    for (const m of MIGRATIONS.filter((x) => x.version <= 3)) {
      await driver.executeScript(m.sql);
      await driver.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [m.version, m.name, "x"]);
    }
    const repos = createRepositories(driver);
    const { campaign } = await createCampaign(repos, { name: "Old" });
    const dungeon = await repos.entities.create({ campaign_id: campaign.id, kind: "dungeon", name: "Old Keep" });
    await driver.execute(
      "INSERT INTO dungeon_floors (id, dungeon_id, name, level, width, height, cell_feet, walls, terrain, sort_order, created_at, updated_at) VALUES ('f1', ?, 'Ground', 1, 10, 10, 5, '[]', '[]', 0, 'x', 'x')",
      [dungeon.id],
    );
    expect(await migrate(driver)).toEqual({ from: 3, to: CURRENT_SCHEMA_VERSION });
    expect((await repos.dungeons.getFloor("f1")).notes_md).toBe("");
  });

  it("follow a renamed record", async () => {
    const { repos, campaign, floor } = await setup();
    const ossuary = await repos.entities.create({ campaign_id: campaign.id, kind: "location", name: "The Ossuary" });
    await repos.dungeons.updateFloor(floor.id, { notes_md: "See [[The Ossuary]] and [[the ossuary|the bone pit]]." });
    await repos.entities.update(ossuary.id, { name: "Bone Hall" });
    expect((await repos.dungeons.getFloor(floor.id)).notes_md).toBe("See [[Bone Hall]] and [[Bone Hall|the bone pit]].");
  });

  it("travel with campaign export and import", async () => {
    const { repos, driver, campaign, floor } = await setup();
    await repos.dungeons.updateFloor(floor.id, { notes_md: "Flooded at high tide." });
    const bundle = JSON.parse(JSON.stringify(await exportCampaign(driver, campaign.id, "test")));
    const plan = await planImport(driver, bundle, { renameTo: "Copy" });
    await applyImport(driver, plan);
    expect((await repos.dungeons.getFloor(plan.idMap.get(floor.id)!)).notes_md).toBe("Flooded at high tide.");
  });

  it("never reach the player table window", async () => {
    const { repos, floor } = await setup();
    await repos.dungeons.updateFloor(floor.id, { notes_md: "The lich hides behind the altar." });
    const view = playerView(await repos.dungeons.loadFloor(floor.id), { fog: true, light_radius: 2 });
    expect(view.data.floor.notes_md).toBe("");
  });
});

describe("pop-out notes targets", () => {
  it("load and save dungeon notes (the dungeon's DM notes) and floor notes", async () => {
    const { loadNotes, saveNotes } = await import("@/features/dungeons/NotesWindow");
    const { repos, campaign, floor } = await setup();
    const dungeonId = floor.dungeon_id;
    expect(await loadNotes(repos, { scope: "dungeon", id: dungeonId })).toEqual({ title: "Crypt", subtitle: "Dungeon notes", notes: "" });
    expect(await saveNotes(repos, { scope: "dungeon", id: dungeonId }, "Five hours on the [[Clock]].")).toBe("Five hours on the [[Clock]].");
    expect((await repos.entities.get(dungeonId)).dm_notes_md).toBe("Five hours on the [[Clock]].");

    await saveNotes(repos, { scope: "floor", id: floor.id }, "Flooded.");
    expect(await loadNotes(repos, { scope: "floor", id: floor.id })).toEqual({ title: "Upper Vault", subtitle: "Crypt · floor notes", notes: "Flooded." });

    // dungeon notes follow renames like any record's notes
    const clock = await repos.entities.create({ campaign_id: campaign.id, kind: "article", name: "Clock" });
    await repos.entities.update(clock.id, { name: "The Five-Hour Clock" });
    expect((await repos.entities.get(dungeonId)).dm_notes_md).toBe("Five hours on the [[The Five-Hour Clock]].");
  });

  it("report a missing target", async () => {
    const { loadNotes } = await import("@/features/dungeons/NotesWindow");
    const { repos } = await setup();
    await expect(loadNotes(repos, { scope: "floor", id: "nope" })).rejects.toThrow();
    await expect(loadNotes(repos, { scope: "dungeon", id: "nope" })).rejects.toThrow();
  });
});
