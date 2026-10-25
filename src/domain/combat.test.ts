import { describe, expect, it } from "vitest";
import { testRepos } from "@/persistence/testUtils";
import { formatAttack, formatDamage } from "@/features/encounters/CombatantSheet";
import {
  groupedActions,
  initialResources,
  parseSpellSlots,
  rollAttack,
  rollDamage,
  rollRecharges,
  saveBonus,
  saveFromText,
  spendUse,
  toHitBonus,
  usageLimit,
  usesLeft,
} from "./statblock";
import { createCampaign } from "./workflows/campaignWorkflow";

/** Deterministic "random" that returns the given d-values in order for a die of `sides`. */
function dice(sides: number, ...values: number[]) {
  let i = 0;
  return () => {
    const v = values[i++ % values.length]!;
    return (v - 1) / sides + 1e-9;
  };
}

const DRAGON = {
  ac: 18,
  max_hp: 200,
  abilities: { str: 23, dex: 10, con: 21, int: 14, wis: 11, cha: 19 },
  saves: "Dexterity +5, Constitution +10, Wisdom +5",
  actions: "Bite. Melee Attack Roll: +11, reach 10 ft. 17 (2d10 + 6) Piercing damage.\n\nFire Breath (Recharge 5–6). Dexterity Saving Throw: DC 18, each creature in a 60-foot Cone. Failure: 56 (16d6) Fire damage.",
  bonus_actions: "Frightful Presence (1/Day). Wisdom Saving Throw: DC 16.",
  legendary: "Tail Swipe. The dragon makes one Bite attack.",
  legendary_actions: 3,
  legendary_resistances: 3,
};

describe("P1 statblock parsing", () => {
  it("reads both 2014 and 2024 attack bonus styles", () => {
    expect(toHitBonus("Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft.")).toBe(4);
    expect(toHitBonus("Bite. Melee Attack Roll: +11, reach 10 ft.")).toBe(11);
    expect(toHitBonus("Melee or Ranged Attack Roll: -1, range 20/60 ft.")).toBe(-1);
    expect(toHitBonus("No attack here")).toBeNull();
  });

  it("reads recharge and per-day limits", () => {
    expect(usageLimit("Fire Breath (Recharge 5–6). Dexterity...")).toEqual({ kind: "recharge", min: 5 });
    expect(usageLimit("Petrifying Gaze (Recharge 4-6) (4 recharge).")).toEqual({ kind: "recharge", min: 4 });
    expect(usageLimit("Lightning (Recharge 6).")).toEqual({ kind: "recharge", min: 6 });
    expect(usageLimit("Frightful Presence (1/Day).")).toEqual({ kind: "per_day", uses: 1 });
    expect(usageLimit("Bite. Melee Attack Roll")).toBeNull();
  });

  it("reads save DCs in both styles and save bonuses from the sheet", () => {
    expect(saveFromText("Dexterity Saving Throw: DC 18, each creature")).toEqual({ ability: "dexterity", dc: 18 });
    expect(saveFromText("must succeed on a DC 13 Constitution saving throw")).toEqual({ ability: "constitution", dc: 13 });
    expect(saveBonus(DRAGON, "constitution")).toBe(10);
    expect(saveBonus(DRAGON, "strength")).toBe(6); // falls back to the ability modifier
  });

  it("groups actions, bonus actions and legendary actions", () => {
    const grouped = groupedActions(DRAGON);
    expect(grouped.map((a) => [a.group, a.title])).toEqual([
      ["action", "Bite"],
      ["action", "Fire Breath"],
      ["bonus", "Frightful Presence"],
      ["legendary", "Tail Swipe"],
    ]);
    expect(grouped[0]!.toHit).toBe(11);
    expect(grouped[1]!.save).toEqual({ ability: "dexterity", dc: 18 });
  });

  it("parses spell slots in several formats", () => {
    expect(parseSpellSlots("1st: 4, 2nd: 3, 3rd: 2")).toEqual({ 1: 4, 2: 3, 3: 2 });
    expect(parseSpellSlots("1:4 2:2")).toEqual({ 1: 4, 2: 2 });
    expect(parseSpellSlots("4/3/2")).toEqual({ 1: 4, 2: 3, 3: 2 });
    expect(parseSpellSlots("")).toEqual({});
  });

  it("builds per-run counters from a sheet", () => {
    const res = initialResources({ ...DRAGON, spell_slots: "1st: 2" });
    expect(res).toMatchObject({ legendary: 3, legendary_max: 3, legres: 3, legres_max: 3, slot_1: 2, slot_1_max: 2, "recharge:fire-breath": 1, "uses:frightful-presence": 1 });
  });

  it("spends limited uses and recharges on a high enough d6", () => {
    const breath = groupedActions(DRAGON)[1]!;
    let res = initialResources(DRAGON);
    const first = spendUse(res, breath);
    expect(first.ok).toBe(true);
    res = first.resources;
    expect(usesLeft(res, breath)).toBe(0);
    expect(spendUse(res, breath).ok).toBe(false);
    const miss = rollRecharges(DRAGON, res, dice(6, 3));
    expect(usesLeft(miss.resources, breath)).toBe(0);
    expect(miss.messages[0]).toMatch(/does not recharge \(rolled 3/);
    const hit = rollRecharges(DRAGON, res, dice(6, 5));
    expect(usesLeft(hit.resources, breath)).toBe(1);
    expect(hit.messages[0]).toMatch(/recharges \(rolled 5\)/);
  });

  it("rolls attacks with advantage/disadvantage and doubles dice on a crit", () => {
    expect(rollAttack(5, "advantage", dice(20, 4, 17))).toMatchObject({ d20: 17, total: 22, rolls: [4, 17] });
    expect(rollAttack(5, "disadvantage", dice(20, 4, 17))).toMatchObject({ d20: 4, total: 9 });
    expect(rollAttack(0, "normal", dice(20, 20)).crit).toBe(true);
    expect(rollDamage("2d6+3", false, dice(6, 2, 5))).toEqual({ total: 10, rolls: [2, 5], modifier: 3 });
    expect(rollDamage("2d6+3", true, dice(6, 1, 2, 3, 4))).toEqual({ total: 13, rolls: [1, 2, 3, 4], modifier: 3 });
    expect(formatAttack("Goblin", { title: "Scimitar" }, 4, "normal", dice(20, 20))).toMatch(/critical hit/);
    expect(formatDamage("Goblin", { title: "Scimitar" }, "1d6+2", true, dice(6, 3, 4))).toBe("Goblin Scimitar damage (critical): 1d6+2 = 9 [3, 4] +2.");
  });
});

describe("P1 combat run behaviour", () => {
  async function setup() {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "Test" });
    const dragon = await repos.entities.create({ campaign_id: campaign.id, kind: "creature", name: "Red Dragon", fields: DRAGON });
    const fighter = await repos.entities.create({ campaign_id: campaign.id, kind: "pc", name: "Arin", fields: { hp: 12, max_hp: 12, ac: 16, spell_slots: "1st: 2" } });
    const encounter = await repos.entities.create({ campaign_id: campaign.id, kind: "encounter", name: "Lair", fields: {} });
    await repos.encounters.addParticipant({ encounter_id: encounter.id, entity_id: dragon.id, label: null, count: 1, side: "enemy", notes: "", sort_order: 0 });
    const { run, combatants } = await repos.encounters.startRun({ campaign_id: campaign.id, encounter_id: encounter.id, party: [fighter] });
    return { repos, run, dragon: combatants.find((c) => c.side === "enemy")!, arin: combatants.find((c) => c.side === "party")! };
  }

  it("seeds legendary resistance, spell slots and limited uses on spawn", async () => {
    const { dragon, arin } = await setup();
    expect(dragon.resources).toMatchObject({ legendary: 3, legres: 3, "recharge:fire-breath": 1 });
    expect(arin.resources).toMatchObject({ slot_1: 2, slot_1_max: 2 });
  });

  it("spends a recharge ability, refuses a second use and re-rolls it at the start of the turn", async () => {
    const { repos, run, dragon } = await setup();
    const breath = groupedActions(dragon.sheet)[1]!;
    await repos.encounters.useAbility(dragon.id, breath, "Red Dragon uses Fire Breath.");
    await expect(repos.encounters.useAbility(dragon.id, breath, "again")).rejects.toThrow(/no uses/);
    await repos.encounters.setInitiative(dragon.id, 20);
    await repos.encounters.begin(run.id);
    // dragon acts first (index 0); advance a full round back to the dragon with a 6 on the d6
    await repos.encounters.nextTurn(run.id, dice(6, 6));
    const back = await repos.encounters.nextTurn(run.id, dice(6, 6));
    const updated = back.combatants.find((c) => c.id === dragon.id)!;
    expect(updated.resources["recharge:fire-breath"]).toBe(1);
    expect(back.run.log.some((l) => /Fire Breath recharges/.test(l.message))).toBe(true);
  });

  it("clamps counters to their max and logs the change", async () => {
    const { repos, dragon } = await setup();
    await repos.encounters.adjustResource(dragon.id, "legres", -1, "legendary resistance");
    const after = await repos.encounters.adjustResource(dragon.id, "legres", 5, "legendary resistance");
    expect(after.resources.legres).toBe(3);
    const run = await repos.encounters.getRun(dragon.run_id);
    expect(run.log.some((l) => /uses legendary resistance \(2\/3 left\)/.test(l.message))).toBe(true);
  });

  it("logs a concentration DC when a concentrating creature takes damage", async () => {
    const { repos, dragon } = await setup();
    await repos.encounters.addCondition(dragon.id, { name: "concentrating", duration: null });
    await repos.encounters.damage(dragon.id, 30);
    const run = await repos.encounters.getRun(dragon.run_id);
    expect(run.log.at(-1)!.message).toMatch(/Constitution save DC 15/);
  });

  it("tracks exhaustion levels and kills at level 6", async () => {
    const { repos, arin } = await setup();
    let c = await repos.encounters.setExhaustion(arin.id, 2);
    expect(c.conditions.find((x) => x.name === "exhaustion")?.level).toBe(2);
    c = await repos.encounters.setExhaustion(arin.id, 0);
    expect(c.conditions.some((x) => x.name === "exhaustion")).toBe(false);
    c = await repos.encounters.setExhaustion(arin.id, 9);
    expect(c.defeated).toBe(true);
  });

  it("marks a dying PC stable after three successes and clears it on damage", async () => {
    const { repos, arin } = await setup();
    await repos.encounters.damage(arin.id, 12);
    for (const v of [12, 15, 18]) await repos.encounters.rollDeathSave(arin.id, v);
    let c = await repos.encounters.getCombatant(arin.id);
    expect(c.conditions.some((x) => x.name === "stable")).toBe(true);
    c = await repos.encounters.damage(arin.id, 1);
    expect(c.conditions.some((x) => x.name === "stable")).toBe(false);
    expect(c.resources.death_fail).toBe(1);
  });
});
