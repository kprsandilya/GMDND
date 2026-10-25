import { describe, expect, it } from "vitest";
import { sortCombatants } from "@/persistence/repositories/encounters";
import { testRepos } from "@/persistence/testUtils";
import { finalizeRow, reassignInitiative, rollGroupSave, summarizeGroupSave } from "./groupCombat";
import type { Combatant } from "./types";
import { createCampaign } from "./workflows/campaignWorkflow";
import { finishEncounter } from "./workflows/encounterWorkflow";
import { collectSessionRecap, formatSessionRecap } from "./workflows/sessionRecap";

const d20 = (...values: number[]) => {
  let i = 0;
  return () => (values[i++ % values.length]! - 1) / 20 + 1e-9;
};

describe("group saves", () => {
  const opts = { ability: "dexterity", dc: 15, damage: 20, halfOnSuccess: true };
  const targets = [
    { id: "a", name: "Goblin", sheet: { abilities: { dex: 14 } } },
    { id: "b", name: "Rogue", sheet: { saves: "Dexterity +7" } },
  ];

  it("rolls each target's own save and halves damage on a success", () => {
    const rows = rollGroupSave(targets, opts, d20(10, 10));
    expect(rows.map((r) => [r.name, r.bonus, r.total, r.success, r.damage])).toEqual([
      ["Goblin", 2, 12, false, 20],
      ["Rogue", 7, 17, true, 10],
    ]);
    expect(summarizeGroupSave(rows, opts, "Fireball")).toBe("Fireball: DC 15 DEX save, 20 damage (half on success) — Goblin 12 ✗ (20), Rogue 17 ✓ (10).");
  });

  it("has no automatic success on a natural 20 and recomputes after an edit", () => {
    const row = finalizeRow({ id: "x", name: "Ooze", roll: 20, bonus: -6, total: 0, success: false, damage: 0 }, { ...opts, dc: 15 });
    expect(row.success).toBe(false);
    expect(finalizeRow({ ...row, roll: 1, bonus: 20 }, opts).success).toBe(true);
    expect(finalizeRow({ ...row, roll: 18, bonus: 0 }, { ...opts, halfOnSuccess: false }).damage).toBe(0);
  });
});

describe("initiative reordering", () => {
  const list = (pairs: [string, number | null][]) => pairs.map(([id, initiative]) => ({ id, initiative }));

  it("keeps values that already sort correctly and nudges the moved one", () => {
    const values = reassignInitiative(list([["a", 18], ["b", 12], ["c", 7]]), ["a", "c", "b"]);
    expect(Object.fromEntries(values)).toEqual({ a: 18, c: 7, b: 6.9 });
  });

  it("breaks ties in the requested order and handles missing initiative", () => {
    const values = reassignInitiative(list([["a", 10], ["b", 10], ["c", null]]), ["c", "b", "a"]);
    expect(values.get("c")).toBe(11);
    expect(values.get("b")).toBe(10);
    expect(values.get("a")).toBe(9.9);
  });

  it("produces the requested order through the repository and keeps the current turn", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    const { run } = await repos.encounters.startRun({ campaign_id: campaign.id, encounter_id: null, name: "Brawl" });
    const add = (name: string, initiative: number) => repos.encounters.addCombatant(run.id, { name, hp: 10, max_hp: 10, initiative });
    const a = await add("Aria", 20);
    const b = await add("Bandit", 15);
    const c = await add("Cultist", 10);
    await repos.encounters.begin(run.id);
    await repos.encounters.nextTurn(run.id); // Bandit's turn
    const result = await repos.encounters.reorderInitiative(run.id, [c.id, a.id, b.id]);
    const order = sortCombatants(result.combatants).map((x) => x.name);
    expect(order).toEqual(["Cultist", "Aria", "Bandit"]);
    expect(order[result.run.turn_index]).toBe("Bandit");
  });

  it("applies a group save to the targets that took damage", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    const { run } = await repos.encounters.startRun({ campaign_id: campaign.id, encounter_id: null });
    const x = await repos.encounters.addCombatant(run.id, { name: "X", hp: 10, max_hp: 10 });
    const y = await repos.encounters.addCombatant(run.id, { name: "Y", hp: 10, max_hp: 10 });
    await repos.encounters.applyGroupSave(run.id, [{ id: x.id, damage: 6, success: false }, { id: y.id, damage: 0, success: true }], "Trap: DC 12 DEX save");
    const after: Combatant[] = await repos.encounters.combatants(run.id);
    expect(after.find((c) => c.id === x.id)!.hp).toBe(4);
    expect(after.find((c) => c.id === y.id)!.hp).toBe(10);
    const log = (await repos.encounters.getRun(run.id)).log.map((l) => l.message);
    expect(log).toContain("Trap: DC 12 DEX save");
  });
});

describe("session recap", () => {
  it("summarises encounters, defeated foes and loot logged in the session", async () => {
    const { repos } = await testRepos();
    const { campaign } = await createCampaign(repos, { name: "T" });
    const session = await repos.entities.create({ campaign_id: campaign.id, kind: "session", name: "Session 1", fields: {} });
    const { run } = await repos.encounters.startRun({ campaign_id: campaign.id, encounter_id: null, name: "Bridge ambush", session_id: session.id });
    const g = await repos.encounters.addCombatant(run.id, { name: "Goblin 1", hp: 5, max_hp: 5 });
    await repos.encounters.begin(run.id);
    await repos.encounters.damage(g.id, 5);
    await finishEncounter(repos, run.id, "completed", { mark_defeated: true });
    await repos.campaignLog.add(campaign.id, "inventory", "Arin picks up 12 gp.", {}, session.id);
    await repos.campaignLog.add(campaign.id, "door", "The vault door is forced open.", {}, session.id);
    await repos.campaignLog.add(campaign.id, "door", "Other session event", {}, null);
    const data = await collectSessionRecap(repos, campaign.id, session.id);
    expect(data.encounters).toEqual([{ name: "Bridge ambush", status: "completed", rounds: 1, defeated: ["Goblin 1"], fallen: [] }]);
    const md = formatSessionRecap(data);
    expect(md).toContain("- **Bridge ambush** (completed, 1 round) — defeated Goblin 1");
    expect(md).toContain("### Loot\n- Arin picks up 12 gp.");
    expect(md).toContain("The vault door is forced open.");
    expect(md).not.toContain("Other session event");
  });

  it("says so when nothing was logged", () => {
    expect(formatSessionRecap({ encounters: [], loot: [], events: [] })).toMatch(/Nothing was logged/);
  });
});
