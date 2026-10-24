import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, getSchemaVersion, migrate } from "./migrations";
import { NodeSqlDriver } from "./nodeDriver";
import { createRepositories } from "./repositories";
import { tempDbFile, testRepos } from "./testUtils";
import { applyImport, exportCampaign, findMissingReferences, planImport } from "./exportImport";
import { seedDemoCampaign } from "@/seed/demoCampaign";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("migrations", () => {
  it("creates the schema from scratch and is idempotent", async () => {
    const driver = new NodeSqlDriver();
    expect(await getSchemaVersion(driver)).toBe(0);
    const first = await migrate(driver);
    expect(first).toEqual({ from: 0, to: CURRENT_SCHEMA_VERSION });
    const second = await migrate(driver);
    expect(second.from).toBe(CURRENT_SCHEMA_VERSION);
    const tables = await driver.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["entities", "entity_links", "rooms", "item_instances", "encounter_runs", "schema_migrations"]));
  });

  it("applies the combatant sheet column after a leftover BEGIN", async () => {
    const driver = new NodeSqlDriver();
    await driver.executeScript(MIGRATIONS[0]!.sql);
    await getSchemaVersion(driver);
    await driver.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'initial schema', ?)", [new Date().toISOString()]);
    driver.db.exec("BEGIN");
    const result = await migrate(driver);
    expect(result).toEqual({ from: 1, to: CURRENT_SCHEMA_VERSION });
    const cols = await driver.select<{ name: string }>("PRAGMA table_info(combatants)");
    expect(cols.map((c) => c.name)).toContain("sheet");
    await driver.batch([{ sql: "CREATE TABLE IF NOT EXISTS leftover_tx_check (id TEXT)", params: [] }]);
  });

  it("enforces foreign keys", async () => {
    const { driver } = await testRepos();
    await expect(
      driver.execute("INSERT INTO item_instances (id, campaign_id, definition_id, quantity, owner_type, owner_id, state, created_at, updated_at) VALUES ('x', 'nope', 'nope', 1, 'party', NULL, '{}', '', '')"),
    ).rejects.toThrow();
  });
});

describe("entities", () => {
  it("creates, edits and reloads an entity after reopening the database file", async () => {
    const { file, cleanup } = tempDbFile();
    cleanups.push(cleanup);
    let { repos, driver } = await testRepos(file);
    const campaign = await repos.entities.create({ kind: "campaign", name: "Test Campaign" });
    const town = await repos.entities.create({ kind: "settlement", name: "Riverbend", campaign_id: campaign.id, tags: ["port"], fields: { population: "900" } });
    await repos.entities.update(town.id, { summary: "A quiet river town", body_md: "Nothing ever happens here. See [[Old Mill]]." });
    driver.close();

    ({ repos, driver } = await testRepos(file));
    const reloaded = await repos.entities.get(town.id);
    expect(reloaded.name).toBe("Riverbend");
    expect(reloaded.summary).toBe("A quiet river town");
    expect(reloaded.tags).toEqual(["port"]);
    expect(reloaded.fields.population).toBe("900");
    expect(reloaded.fields.discovered).toBe(false); // schema default filled in
    driver.close();
  });

  it("links entities and reports backlinks and mentions", async () => {
    const { repos } = await testRepos();
    const campaign = await repos.entities.create({ kind: "campaign", name: "C" });
    const npc = await repos.entities.create({ kind: "npc", name: "Mara", campaign_id: campaign.id });
    const faction = await repos.entities.create({ kind: "faction", name: "Guild", campaign_id: campaign.id, body_md: "Led by [[Mara]]." });
    await repos.entities.link(npc.id, faction.id, "member_of");
    const fromNpc = await repos.entities.linksFor(npc.id);
    expect(fromNpc).toHaveLength(1);
    expect(fromNpc[0]!.direction).toBe("out");
    const fromFaction = await repos.entities.linksFor(faction.id);
    expect(fromFaction[0]!.direction).toBe("in");
    const mentions = await repos.entities.mentions(npc);
    expect(mentions.map((m) => m.id)).toEqual([faction.id]);
    const hits = await repos.entities.search(campaign.id, "mara");
    expect(hits.map((h) => h.entity.id)).toEqual(expect.arrayContaining([npc.id, faction.id]));
  });

  it("scopes list() to one campaign and only includes shared records on request", async () => {
    const { repos } = await testRepos();
    const campA = await repos.entities.create({ kind: "campaign", name: "A" });
    const campB = await repos.entities.create({ kind: "campaign", name: "B" });
    const goblinA = await repos.entities.create({ kind: "creature", name: "Goblin A", campaign_id: campA.id });
    await repos.entities.create({ kind: "creature", name: "Goblin B", campaign_id: campB.id });
    // A shared library record (campaign-independent, e.g. an SRD creature).
    await repos.entities.create({ kind: "creature", name: "SRD Orc", campaign_id: null, fields: { source: "srd-2024" } });

    // Default: only the active campaign's records — no other campaign, no shared library.
    const onlyA = await repos.entities.list({ campaign_id: campA.id, kinds: ["creature"] });
    expect(onlyA.map((e) => e.name)).toEqual(["Goblin A"]);

    // include_shared adds the library but still excludes other campaigns.
    const aPlusShared = await repos.entities.list({ campaign_id: campA.id, kinds: ["creature"], include_shared: true });
    expect(aPlusShared.map((e) => e.name).sort()).toEqual(["Goblin A", "SRD Orc"]);
    expect(aPlusShared.some((e) => e.name === "Goblin B")).toBe(false);

    // The same scoping holds for campaign B (consistency across campaigns).
    const onlyB = await repos.entities.list({ campaign_id: campB.id, kinds: ["creature"] });
    expect(onlyB.map((e) => e.name)).toEqual(["Goblin B"]);
    void goblinA;
  });

  it("walks the geographic hierarchy", async () => {
    const { repos } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    const world = await repos.entities.create({ kind: "world", name: "W", campaign_id: c.id });
    const region = await repos.entities.create({ kind: "region", name: "R", campaign_id: c.id, parent_id: world.id });
    const town = await repos.entities.create({ kind: "settlement", name: "T", campaign_id: c.id, parent_id: region.id });
    expect((await repos.entities.ancestors(town.id)).map((e) => e.name)).toEqual(["W", "R"]);
    expect((await repos.entities.children(world.id)).map((e) => e.id)).toEqual([region.id]);
  });
});

describe("world maps", () => {
  it("persists map annotations and feature references", async () => {
    const { repos } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    const town = await repos.entities.create({ kind: "settlement", name: "Port Vale", campaign_id: c.id });
    const map = await repos.worldMaps.create({ campaign_id: c.id, name: "Main", seed: "123" });
    const link = await repos.worldMaps.linkFeature({ map_id: map.id, feature_type: "burg", feature_id: 12, feature_name: "Port Vale", x: 100.5, y: 200.25, entity_id: town.id });
    expect(link.feature_id).toBe(12);
    const again = await repos.worldMaps.linkFeature({ map_id: map.id, feature_type: "burg", feature_id: 12, feature_name: "Port Vale (renamed)", x: 101, y: 201, entity_id: town.id });
    expect(again.id).toBe(link.id); // upsert, not duplicate
    expect(again.feature_name).toBe("Port Vale (renamed)");
    const annotation = await repos.worldMaps.addAnnotation({ map_id: map.id, x: 10, y: 20, kind: "secret", title: "Buried hoard", body_md: "", entity_id: null, color: null, hidden: true });
    expect((await repos.worldMaps.annotations(map.id))[0]!.hidden).toBe(true);
    await repos.worldMaps.updateAnnotation(annotation.id, { hidden: false, title: "Hoard" });
    expect((await repos.worldMaps.annotations(map.id))[0]).toMatchObject({ hidden: false, title: "Hoard" });
    await repos.entities.delete(town.id);
    expect(await repos.worldMaps.featureLinks(map.id)).toHaveLength(0); // cascade on deleted entity
  });
});

describe("dungeons", () => {
  it("persists geometry, rooms, doors, objects, tokens and markers", async () => {
    const { repos } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    const dungeon = await repos.entities.create({ kind: "dungeon", name: "Crypt", campaign_id: c.id });
    const floor = await repos.dungeons.createFloor({ dungeon_id: dungeon.id, name: "L1", width: 20, height: 20, walls: [{ id: "w1", x1: 0, y1: 0, x2: 5, y2: 0 }] });
    const room = await repos.dungeons.createRoom({ floor_id: floor.id, campaign_id: c.id, dungeon_id: dungeon.id, name: "Antechamber", number: "1", x: 1, y: 1, w: 4, h: 3, read_aloud_md: "Dust." });
    const door = await repos.dungeons.createDoor({ floor_id: floor.id, x: 5, y: 2, orientation: "v", state: "locked", lock_dc: 15, room_a: room.id });
    const chest = await repos.dungeons.createObject({ floor_id: floor.id, room_id: room.id, kind: "container", name: "Chest", x: 2, y: 2, state: { locked: true } });
    const token = await repos.dungeons.createToken({ floor_id: floor.id, name: "Hero", kind: "pc", x: 1, y: 1 });
    const marker = await repos.dungeons.createMarker({ floor_id: floor.id, room_id: room.id, kind: "event", title: "Whisper", x: 2, y: 1, trigger: "enter_room", trigger_ref: room.id });

    const data = await repos.dungeons.loadFloor(floor.id);
    expect(data.floor.walls).toEqual([{ id: "w1", x1: 0, y1: 0, x2: 5, y2: 0 }]);
    expect(data.rooms[0]).toMatchObject({ id: room.id, x: 1, y: 1, w: 4, h: 3, number: "1" });
    expect(data.rooms[0]!.entity.read_aloud_md).toBe("Dust.");
    expect(data.doors[0]).toMatchObject({ id: door.id, state: "locked", lock_dc: 15 });
    expect(data.objects[0]).toMatchObject({ id: chest.id, state: { locked: true } });
    expect(data.tokens[0]).toMatchObject({ id: token.id, x: 1, y: 1 });
    expect(data.markers[0]).toMatchObject({ id: marker.id, trigger: "enter_room" });

    await repos.dungeons.updateRoom(room.id, { x: 2, w: 5, state: { explored: true } }, { name: "Grand Antechamber" });
    const updated = await repos.dungeons.getRoom(room.id);
    expect(updated).toMatchObject({ x: 2, w: 5, state: { explored: true } });
    expect(updated.entity.name).toBe("Grand Antechamber");

    await repos.dungeons.deleteRoom(room.id);
    expect((await repos.dungeons.getObject(chest.id)).room_id).toBeNull(); // SET NULL, object survives
    expect(await repos.entities.find(room.id)).toBeNull();
  });

  it("removes room entities when a floor is deleted", async () => {
    const { repos } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    const dungeon = await repos.entities.create({ kind: "dungeon", name: "Crypt", campaign_id: c.id });
    const floor = await repos.dungeons.createFloor({ dungeon_id: dungeon.id, name: "L1", width: 10, height: 10 });
    const room = await repos.dungeons.createRoom({ floor_id: floor.id, campaign_id: c.id, dungeon_id: dungeon.id, name: "R", x: 0, y: 0, w: 2, h: 2 });
    await repos.dungeons.deleteFloor(floor.id);
    expect(await repos.entities.find(room.id)).toBeNull();
  });
});

describe("inventory", () => {
  it("transfers without duplication and merges stacks", async () => {
    const { repos } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    const potion = await repos.entities.create({ kind: "item", name: "Potion", campaign_id: c.id, fields: { category: "potion" } });
    const hero = await repos.entities.create({ kind: "pc", name: "Hero", campaign_id: c.id });
    const chest = { owner_type: "object" as const, owner_id: "chest-1" };
    const heroOwner = { owner_type: "character" as const, owner_id: hero.id };
    const stack = await repos.inventory.grant(c.id, potion.id, 3, chest);
    await repos.inventory.grant(c.id, potion.id, 1, heroOwner);

    const moved = await repos.inventory.transfer({ instance_id: stack.id, quantity: 2, to: heroOwner });
    expect(moved.quantity).toBe(3); // merged into the hero's existing stack
    expect((await repos.inventory.listByOwner(chest))[0]!.quantity).toBe(1);
    const total = (await repos.inventory.listForCampaign(c.id)).reduce((s, i) => s + i.quantity, 0);
    expect(total).toBe(4);

    await expect(repos.inventory.transfer({ instance_id: stack.id, quantity: 5, to: heroOwner })).rejects.toThrow(/only 1 available/);
    expect(await repos.inventory.consume(heroOwner, potion.id, 2)).toBe(true);
    expect(await repos.inventory.totalQuantity(heroOwner, potion.id)).toBe(1);
    expect(await repos.inventory.consume(heroOwner, potion.id, 5)).toBe(false);
    const log = await repos.inventory.log(c.id);
    expect(log.length).toBeGreaterThanOrEqual(4);
  });

  it("rolls back a batch when an expectation fails", async () => {
    const { repos, driver } = await testRepos();
    const c = await repos.entities.create({ kind: "campaign", name: "C" });
    await expect(
      driver.batch([
        { sql: "UPDATE entities SET name = 'changed' WHERE id = ?", params: [c.id], expect_changes: 1 },
        { sql: "UPDATE entities SET name = 'x' WHERE id = 'missing'", expect_changes: 1 },
      ]),
    ).rejects.toThrow(/rolled back/);
    expect((await repos.entities.get(c.id)).name).toBe("C");
  });
});

describe("export / import", () => {
  it("round-trips a campaign with remapped ids and reports missing references", async () => {
    const { repos, driver } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const bundle = await exportCampaign(driver, ids.campaign, "test");
    expect(bundle.tables.entities.length).toBeGreaterThan(20);
    expect(bundle.tables.rooms).toHaveLength(5);
    expect(bundle.tables.item_instances.length).toBeGreaterThan(5);

    const json = JSON.parse(JSON.stringify(bundle));
    const plan = await planImport(driver, json, { renameTo: "Imported Copy" });
    await applyImport(driver, plan);
    const copy = await repos.entities.get(plan.newCampaignId);
    expect(copy.name).toBe("Imported Copy");
    expect(copy.id).not.toBe(ids.campaign);
    const copyRooms = await repos.entities.list({ campaign_id: copy.id, kinds: ["room"] });
    expect(copyRooms).toHaveLength(5);
    const copyChestItems = await repos.inventory.listByOwner({ owner_type: "object", owner_id: plan.idMap.get(ids.chest)! });
    expect(copyChestItems).toHaveLength(3);
    // interactions JSON inside objects had the key item id remapped
    const copyChest = await repos.dungeons.getObject(plan.idMap.get(ids.chest)!);
    const keyPre = copyChest.interactions.flatMap((d) => d.preconditions ?? []).find((p) => p.type === "has_item");
    expect(keyPre && "definition_id" in keyPre ? keyPre.definition_id : null).toBe(copyChest.state.key_item_id);
    expect(await findMissingReferences(driver, copy.id)).toEqual([]);

    await expect(planImport(driver, { format: "other" })).rejects.toThrow(/Invalid campaign file/);
    // originals untouched
    expect((await repos.entities.get(ids.campaign)).name).toBe("Embers of Hollowmere");
    const both = await repos.entities.list({ kinds: ["campaign"] });
    expect(both).toHaveLength(2);
  });

  it("handles deleted references gracefully", async () => {
    const { repos, driver } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const data = await repos.dungeons.loadFloor(ids.floor);
    const oswick = data.tokens.find((t) => t.name === "Oswick")!;
    await repos.entities.delete(oswick.entity_id!);
    const after = await repos.dungeons.getToken(oswick.id);
    expect(after.entity_id).toBeNull();
    const missing = await findMissingReferences(driver, ids.campaign);
    expect(missing.find((m) => m.table === "tokens")?.count).toBe(1);
    const repos2 = createRepositories(driver);
    expect((await repos2.dungeons.loadFloor(ids.floor)).tokens.length).toBe(data.tokens.length);
  });
});
