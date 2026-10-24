import { describe, expect, it } from "vitest";
import { testRepos } from "@/persistence/testUtils";
import { resetDemoCampaign, seedDemoCampaign } from "@/seed/demoCampaign";
import { advanceCampaignDate, createCampaign, loadCampaignState, promoteNote, setPartyLocation } from "./campaignWorkflow";
import { activateEncounter, finishEncounter } from "./encounterWorkflow";
import { moveToken, performDoorAction, performInteraction, tokenOwner } from "./interactionWorkflow";

describe("demo campaign workflow", () => {
  it("moves a character into the reliquary, finds the key, opens the chest and keeps the loot", async () => {
    const { repos } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const C = ids.campaign;
    let data = await repos.dungeons.loadFloor(ids.floor);
    const nyx = data.tokens.find((t) => t.name === "Nyx")!;
    const kaelen = data.tokens.find((t) => t.name === "Kaelen")!;
    const entryDoor = data.doors.find((d) => d.x === 6 && d.y === 10)!;
    const reliquaryDoor = data.doors.find((d) => d.x === 15 && d.y === 7)!;

    // The door out of the entry stair is closed: movement through it is refused until opened.
    expect((await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 7, y: 10 } })).ok).toBe(false);
    await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 5, y: 10 } });
    const opened = await performDoorAction(repos, { campaign_id: C, door_id: entryDoor.id, action: "open", actor_token_id: nyx.id });
    expect(opened.ok).toBe(true);
    const intoHall = await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 7, y: 10 }, rules: { enforceBudget: false } });
    expect(intoHall.ok).toBe(true);
    expect(intoHall.enteredRoom?.entity.name).toBe("Flooded Hall");
    expect((await repos.dungeons.getRoom(ids.rooms.hall!)).state.explored).toBe(true);

    // The reliquary door is locked: Nyx has thieves' tools, the DM enters a roll.
    await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 14, y: 7 }, rules: { enforceBudget: false } });
    const needsRoll = await performDoorAction(repos, { campaign_id: C, door_id: reliquaryDoor.id, action: "pick_lock", actor_token_id: nyx.id });
    expect(needsRoll.outcome).toBe("needs_roll");
    const picked = await performDoorAction(repos, { campaign_id: C, door_id: reliquaryDoor.id, action: "pick_lock", actor_token_id: nyx.id, roll: 12, modifier: 7 });
    expect(picked.ok).toBe(true);
    await performDoorAction(repos, { campaign_id: C, door_id: reliquaryDoor.id, action: "open", actor_token_id: nyx.id });
    const intoReliquary = await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 18, y: 4 }, rules: { enforceBudget: false } });
    expect(intoReliquary.enteredRoom?.entity.name).toBe("Saint's Reliquary");

    data = await repos.dungeons.loadFloor(ids.floor);
    const statue = data.objects.find((o) => o.name === "Statue of Saint Ilvane")!;
    const niche = data.objects.find((o) => o.name === "Offering Niche")!;
    const chest = data.objects.find((o) => o.id === ids.chest)!;
    expect(niche.hidden).toBe(true);

    // Investigate the statue: reveals the hidden niche with the key.
    const investigate = await performInteraction(repos, { campaign_id: C, object_id: statue.id, interaction_id: "investigate", actor_token_id: nyx.id, roll: 10, modifier: 5 });
    expect(investigate.outcome).toBe("success");
    expect((await repos.dungeons.getObject(niche.id)).hidden).toBe(false);

    // Open the niche and take the key (adjacent: niche at 16,4 and Nyx at 18,4 is two cells away -> move first).
    await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 17, y: 5 }, rules: { enforceBudget: false } });
    await performInteraction(repos, { campaign_id: C, object_id: niche.id, interaction_id: "open", actor_token_id: nyx.id });
    const loot = await performInteraction(repos, { campaign_id: C, object_id: niche.id, interaction_id: "loot", actor_token_id: nyx.id });
    expect(loot.messages.join(" ")).toMatch(/Verdigris Key/);
    const nyxItems = await repos.inventory.listByOwner(tokenOwner(nyx));
    expect(nyxItems.some((i) => i.definition.name === "Verdigris Key")).toBe(true);

    // The chest: "Open" is blocked while locked, "Unlock with key" now works, then loot.
    await moveToken(repos, { campaign_id: C, token_id: nyx.id, to: { x: 18, y: 4 }, rules: { enforceBudget: false } });
    const blocked = await performInteraction(repos, { campaign_id: C, object_id: chest.id, interaction_id: "open", actor_token_id: nyx.id });
    expect(blocked.outcome).toBe("blocked");
    const unlocked = await performInteraction(repos, { campaign_id: C, object_id: chest.id, interaction_id: "unlock-key", actor_token_id: nyx.id });
    expect(unlocked.outcome).toBe("success");
    await performInteraction(repos, { campaign_id: C, object_id: chest.id, interaction_id: "open", actor_token_id: nyx.id });
    const taken = await performInteraction(repos, { campaign_id: C, object_id: chest.id, interaction_id: "loot", actor_token_id: nyx.id });
    expect(taken.ok).toBe(true);

    const chestItems = await repos.inventory.listByOwner({ owner_type: "object", owner_id: chest.id });
    expect(chestItems).toHaveLength(0);
    const after = await repos.inventory.listByOwner(tokenOwner(nyx));
    const potions = after.find((i) => i.definition.name === "Potion of Healing");
    expect(potions?.quantity).toBe(2);
    const gold = after.find((i) => i.definition.name === "Gold Pieces");
    expect(gold?.quantity).toBe(8 + 35); // merged with her purse, nothing duplicated
    const everything = await repos.inventory.listForCampaign(C);
    expect(everything.filter((i) => i.definition.name === "Gold Pieces").reduce((s, i) => s + i.quantity, 0)).toBe(15 + 8 + 35);

    // Kaelen cannot interact from across the dungeon.
    const far = await performInteraction(repos, { campaign_id: C, object_id: chest.id, interaction_id: "close", actor_token_id: kaelen.id });
    expect(far.outcome).toBe("blocked");

    // Everything is in the campaign log.
    const log = await repos.campaignLog.list(C);
    expect(log.some((e) => e.kind === "interaction" && /Took/.test(e.message))).toBe(true);
    expect((await repos.dungeons.getObject(chest.id)).state).toMatchObject({ locked: false, open: true });
  });

  it("triggers traps and markers from movement", async () => {
    const { repos } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const data = await repos.dungeons.loadFloor(ids.floor);
    const kaelen = data.tokens.find((t) => t.name === "Kaelen")!;
    // teleport (DM override) onto the trap plate
    const onTrap = await moveToken(repos, { campaign_id: ids.campaign, token_id: kaelen.id, to: { x: 10, y: 11 }, force: true });
    expect(onTrap.messages.join(" ")).toMatch(/triggers Dart Trap Plate/);
    const trap = (await repos.dungeons.objects(ids.floor)).find((o) => o.name === "Dart Trap Plate")!;
    expect(trap.state.triggered).toBe(true);
    expect(trap.hidden).toBe(false);
    expect((await repos.dungeons.getToken(kaelen.id)).hp).toBeLessThan(20);
    const trapMarker = (await repos.dungeons.markers(ids.floor)).find((m) => m.title === "Dart trap")!;
    expect(trapMarker.activated).toBe(true);

    const intoGuard = await moveToken(repos, { campaign_id: ids.campaign, token_id: kaelen.id, to: { x: 16, y: 12 }, force: true });
    expect(intoGuard.triggeredMarkers.map((m) => m.title)).toContain("Guard Post Ambush");
  });

  it("runs an encounter from a room without touching the template and persists chosen outcomes", async () => {
    const { repos } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const ambush = (await repos.entities.list({ campaign_id: ids.campaign, kinds: ["encounter"] })).find((e) => e.name === "Guard Post Ambush")!;
    const templateBefore = JSON.stringify([await repos.entities.get(ambush.id), await repos.encounters.participants(ambush.id)]);

    const { run, combatants } = await activateEncounter(repos, { campaign_id: ids.campaign, encounter_id: ambush.id, room_id: ids.rooms.guard!, floor_id: ids.floor, placeTokens: true });
    expect(run.status).toBe("prepared");
    expect(combatants.filter((c) => c.side === "enemy")).toHaveLength(4);
    expect(combatants.filter((c) => c.side === "party")).toHaveLength(2);
    expect(combatants.filter((c) => c.side === "enemy").every((c) => c.token_id)).toBe(true);
    const tokens = await repos.dungeons.tokens(ids.floor);
    expect(tokens.filter((t) => t.kind === "creature")).toHaveLength(4);

    await repos.encounters.begin(run.id);
    for (const [i, c] of combatants.entries()) await repos.encounters.setInitiative(c.id, 20 - i);
    const adept = combatants.find((c) => c.name === "Cult Adept")!;
    await repos.encounters.setTempHp(adept.id, 5);
    await repos.encounters.damage(adept.id, 8); // 5 absorbed, 3 through
    expect((await repos.encounters.getCombatant(adept.id)).hp).toBe(19);
    await repos.encounters.addCondition(adept.id, { name: "frightened", duration: 1 });
    const turn = await repos.encounters.nextTurn(run.id);
    expect(turn.run.turn_index).toBe(1);
    for (let i = 0; i < combatants.length; i++) await repos.encounters.nextTurn(run.id);
    const afterRound = await repos.encounters.getRun(run.id);
    expect(afterRound.round).toBe(2);
    expect((await repos.encounters.getCombatant(adept.id)).conditions).toHaveLength(0); // ticked away
    await repos.encounters.damage(adept.id, 100);
    expect((await repos.encounters.getCombatant(adept.id)).defeated).toBe(true);
    for (const c of combatants.filter((x) => x.name.startsWith("Fen Cultist"))) await repos.encounters.damage(c.id, 50);

    const report = await finishEncounter(repos, run.id, "completed", { mark_defeated: true, room_cleared: true, award_treasure: true, remove_defeated_tokens: true });
    expect(report.run.status).toBe("completed");
    expect(report.applied).toEqual(expect.arrayContaining(["Guard Post cleared", "Cult Adept defeated"]));
    expect((await repos.dungeons.getRoom(ids.rooms.guard!)).state.cleared).toBe(true);
    expect((await repos.dungeons.tokens(ids.floor)).filter((t) => t.kind === "creature")).toHaveLength(0);
    const roomLoot = await repos.inventory.listByOwner({ owner_type: "room", owner_id: ids.rooms.guard! });
    expect(roomLoot.map((i) => i.definition.name)).toEqual(["Drowned Choir Medallion"]);

    const templateAfter = JSON.stringify([await repos.entities.get(ambush.id), await repos.encounters.participants(ambush.id)]);
    expect(templateAfter).toBe(templateBefore);
    const runs = await repos.encounters.runsForEncounter(ambush.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.log.length).toBeGreaterThan(5);
  });

  it("starts a run even when the stored session or map ids are gone", async () => {
    const { repos } = await testRepos();
    const ids = await seedDemoCampaign(repos);
    const ambush = (await repos.entities.list({ campaign_id: ids.campaign, kinds: ["encounter"] })).find((e) => e.name === "Guard Post Ambush")!;
    const { run } = await activateEncounter(repos, {
      campaign_id: ids.campaign,
      encounter_id: ambush.id,
      session_id: "missing-session",
      room_id: "missing-room",
      floor_id: "missing-floor",
    });
    expect(run.session_id).toBeNull();
    expect(run.room_id).toBeNull();
    expect(run.floor_id).toBeNull();
    expect(run.status).toBe("prepared");
  });

  it("creates campaigns, advances time, moves the party and promotes notes", async () => {
    const { repos } = await testRepos();
    const { campaign, world } = await createCampaign(repos, { name: "New Campaign" });
    expect(world.campaign_id).toBe(campaign.id);
    const town = await repos.entities.create({ kind: "settlement", name: "Town", campaign_id: campaign.id, parent_id: world.id });
    await setPartyLocation(repos, campaign.id, town.id);
    const dated = await advanceCampaignDate(repos, campaign.id, 40);
    const state = await loadCampaignState(repos, campaign.id);
    expect(state.partyLocation?.id).toBe(town.id);
    expect((dated.fields as { calendar: { month: number } }).calendar.month).toBe(5);
    const session = await repos.entities.create({ kind: "session", name: "S1", campaign_id: campaign.id });
    const note = await repos.sessionNotes.add(session.id, campaign.id, "The mayor is lying about the tax.", "consequence");
    const promoted = await promoteNote(repos, note, { kind: "secret", name: "The mayor lies", link_to: town.id });
    expect(promoted.kind).toBe("secret");
    expect((await repos.sessionNotes.list(session.id))[0]).toMatchObject({ resolved: true, promoted_to: promoted.id });
    expect((await repos.entities.linksFor(promoted.id)).map((l) => l.entity.id).sort()).toEqual([session.id, town.id].sort());
  });

  it("resets the demo campaign without deleting other campaigns", async () => {
    const { repos } = await testRepos();
    await seedDemoCampaign(repos);
    const other = await repos.entities.create({ kind: "campaign", name: "Keep me" });
    const ids = await resetDemoCampaign(repos);
    const campaigns = await repos.entities.list({ kinds: ["campaign"] });
    expect(campaigns).toHaveLength(2);
    expect(campaigns.map((c) => c.id)).toContain(other.id);
    expect(campaigns.map((c) => c.id)).toContain(ids.campaign);
    expect((await repos.entities.list({ kinds: ["room"] })).length).toBe(5); // old demo rooms gone
  });
});
