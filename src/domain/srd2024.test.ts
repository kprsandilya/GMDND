import { describe, expect, it } from "vitest";
import { buildSrdLibrary, creatureToEntity, isSrdEntityId, itemToEntity, srdEntityId, SRD_SOURCE } from "./srd2024";

const aboleth = {
  model: "api_v2.creature",
  pk: "srd-2024_aboleth",
  fields: {
    name: "Aboleth",
    size: "large",
    type: "aberration",
    alignment: "lawful evil",
    challenge_rating: "10.000",
    armor_class: 17,
    armor_detail: "natural armor",
    hit_points: 150,
    hit_dice: "20d10 + 40",
    initiative_bonus: 7,
    walk: 10,
    swim: 40,
    darkvision_range: 120,
    passive_perception: 20,
    languages_desc: "Deep Speech; telepathy 120 ft.",
    ability_score_strength: 21,
    ability_score_dexterity: 9,
    ability_score_constitution: 15,
    ability_score_intelligence: 18,
    ability_score_wisdom: 15,
    ability_score_charisma: 18,
    saving_throw_constitution: 6,
    saving_throw_intelligence: 8,
    skill_bonus_history: 12,
    skill_bonus_perception: 10,
    damage_immunities_display: "",
  },
};

const abolethActions = [
  { model: "api_v2.creatureaction", pk: "a1", fields: { action_type: "ACTION", name: "Tentacle", desc: "Melee Attack Roll: +9.", parent: "srd-2024_aboleth", order_in_statblock: 1 } },
  { model: "api_v2.creatureaction", pk: "a2", fields: { action_type: "LEGENDARY_ACTION", name: "Lash", desc: "One Tentacle attack.", parent: "srd-2024_aboleth", legendary_action_cost: 1 } },
];
const abolethTraits = [
  { model: "api_v2.creaturetrait", pk: "t1", fields: { name: "Amphibious", desc: "Breathes air and water.", parent: "srd-2024_aboleth" } },
  { model: "api_v2.creaturetrait", pk: "t2", fields: { name: "Legendary Resistance (3/Day)", desc: "Succeeds instead.", parent: "srd-2024_aboleth" } },
];

describe("srd2024 ids", () => {
  it("derives a deterministic, kind-namespaced id from the pk", () => {
    expect(srdEntityId("srd-2024_aboleth", "creature")).toBe("srd::creature::srd-2024_aboleth");
    expect(srdEntityId("srd-2024_camel", "item")).toBe("srd::item::srd-2024_camel");
    // Same pk, different kind → different ids (no collision between a mount item and its stat block).
    expect(srdEntityId("srd-2024_camel", "creature")).not.toBe(srdEntityId("srd-2024_camel", "item"));
    expect(isSrdEntityId(srdEntityId("srd-2024_aboleth", "creature"))).toBe(true);
    expect(isSrdEntityId("some-campaign-uuid")).toBe(false);
  });
});

describe("creatureToEntity", () => {
  const actionsByParent = new Map([["srd-2024_aboleth", abolethActions]]);
  const traitsByParent = new Map([["srd-2024_aboleth", abolethTraits]]);
  const entity = creatureToEntity(aboleth, actionsByParent, traitsByParent);

  it("maps the core stat block", () => {
    expect(entity.kind).toBe("creature");
    expect(entity.campaign_id).toBeNull();
    expect(entity.id).toBe("srd::creature::srd-2024_aboleth");
    expect(entity.fields!.source).toBe(SRD_SOURCE);
    expect(entity.fields!.cr).toBe("10");
    expect(entity.fields!.xp).toBe(5900);
    expect(entity.fields!.ac).toBe(17);
    expect(entity.fields!.hp).toBe(150);
    expect(entity.fields!.size).toBe("Large");
  });

  it("formats speed, senses, saves and skills", () => {
    expect(entity.fields!.speed).toBe("10 ft., swim 40 ft.");
    expect(entity.fields!.senses).toContain("darkvision 120 ft.");
    expect(entity.fields!.senses).toContain("passive Perception 20");
    expect(String(entity.fields!.saves)).toContain("Constitution +6");
    expect(String(entity.fields!.skills)).toContain("Perception +10");
  });

  it("renders actions, traits and legendary data", () => {
    expect(String(entity.fields!.actions)).toContain("Tentacle.");
    expect(String(entity.fields!.legendary)).toContain("Lash.");
    expect(entity.fields!.legendary_actions).toBe(3);
    expect(entity.fields!.legendary_resistances).toBe(3);
    expect(String(entity.fields!.traits)).toContain("Amphibious.");
  });

  it("converts fractional challenge ratings", () => {
    const weak = creatureToEntity({ ...aboleth, pk: "srd-2024_rat", fields: { ...aboleth.fields, name: "Rat", challenge_rating: "0.125" } }, new Map(), new Map());
    expect(weak.fields!.cr).toBe("1/8");
    expect(weak.fields!.xp).toBe(25);
  });
});

describe("itemToEntity", () => {
  it("maps a mundane weapon with detail from the weapon table", () => {
    const item = {
      model: "api_v2.item",
      pk: "srd-2024_battleaxe",
      fields: { name: "Battleaxe", category: "weapon", cost: "10.00", weight: "4.000", weapon: "srd-2024_battleaxe-w", desc: "A martial axe." },
    };
    const weapons = new Map([["srd-2024_battleaxe-w", { model: "api_v2.weapon", pk: "srd-2024_battleaxe-w", fields: { damage_dice: "1d8", damage_type: "slashing", range: 0, long_range: 0 } }]]);
    const entity = itemToEntity(item, { magical: false, weaponsByPk: weapons });
    expect(entity.kind).toBe("item");
    expect(entity.campaign_id).toBeNull();
    expect(entity.fields!.source).toBe(SRD_SOURCE);
    expect(entity.fields!.category).toBe("weapon");
    expect(entity.fields!.damage).toBe("1d8");
    expect(entity.fields!.damage_type).toBe("slashing");
    expect(entity.fields!.value_gp).toBe(10);
    expect(entity.fields!.magical).toBe(false);
  });

  it("maps armor AC from the armor table", () => {
    const item = { model: "api_v2.item", pk: "srd-2024_chain-mail", fields: { name: "Chain Mail", category: "armor", cost: "75.00", armor: "srd-2024_chain-mail-a" } };
    const armor = new Map([["srd-2024_chain-mail-a", { model: "api_v2.armor", pk: "srd-2024_chain-mail-a", fields: { ac_base: 16, ac_add_dexmod: false, ac_cap_dexmod: null, grants_stealth_disadvantage: true } }]]);
    const entity = itemToEntity(item, { magical: false, armorByPk: armor });
    expect(entity.fields!.category).toBe("armor");
    expect(entity.fields!.armor_class).toBe("16");
    expect(String(entity.fields!.properties)).toContain("Stealth");
  });

  it("marks magic items magical", () => {
    const item = { model: "api_v2.magicitem", pk: "srd-2024_amulet-of-health", fields: { name: "Amulet of Health", type: "wondrous", rarity: "rare", desc: "Your Constitution is 19." } };
    const entity = itemToEntity(item, { magical: true });
    expect(entity.fields!.magical).toBe(true);
    expect(entity.fields!.category).toBe("wondrous");
    expect(entity.fields!.rarity).toBe("rare");
    expect(entity.fields!.stackable).toBe(false);
  });
});

describe("buildSrdLibrary", () => {
  it("combines creatures, mundane items and magic items with a version", () => {
    const lib = buildSrdLibrary({
      creatures: [aboleth],
      creatureActions: abolethActions,
      creatureTraits: abolethTraits,
      items: [{ model: "api_v2.item", pk: "srd-2024_rope", fields: { name: "Rope", category: "adventuring-gear", cost: "1.00", weight: "5.000" } }],
      magicItems: [{ model: "api_v2.magicitem", pk: "srd-2024_bag-of-holding", fields: { name: "Bag of Holding", type: "wondrous", rarity: "uncommon" } }],
    });
    expect(lib.version).toBeGreaterThan(0);
    expect(lib.creatures).toHaveLength(1);
    expect(lib.items).toHaveLength(2);
    expect(lib.items.every((i) => i.campaign_id === null)).toBe(true);
    expect(lib.items.find((i) => i.name === "Bag of Holding")!.fields!.magical).toBe(true);
  });
});
