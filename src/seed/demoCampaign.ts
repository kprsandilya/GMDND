import { containerInteractions, investigateInteractions, trapInteractions } from "@/domain/interactions";
import { campaignFieldsSchema } from "@/domain/schemas";
import type { Entity, EntityInput } from "@/domain/types";
import { rectWalls } from "@/domain/geometry";
import type { Repositories } from "@/persistence/repositories";
import { newId } from "@/persistence/repositories/common";

/**
 * "Embers of Hollowmere": a small original campaign that exercises the whole workflow —
 * world → settlement → dungeon → rooms → locked chest, trap, encounter, NPC secrets, quest.
 */
export const DEMO_CAMPAIGN_NAME = "Embers of Hollowmere";
export const DEMO_MAP_SEED = "734215890";

export interface DemoIds {
  campaign: string;
  world: string;
  dungeon: string;
  floor: string;
  rooms: Record<string, string>;
  chest: string;
  pcs: string[];
}

export async function findDemoCampaign(repos: Repositories): Promise<Entity | null> {
  const campaigns = await repos.entities.list({ kinds: ["campaign"] });
  return campaigns.find((c) => (c.fields as { is_demo?: boolean }).is_demo) ?? null;
}

/** Deletes only the demo campaign (if present) and seeds it again. Other campaigns are untouched. */
export async function resetDemoCampaign(repos: Repositories): Promise<DemoIds> {
  const existing = await findDemoCampaign(repos);
  if (existing) await repos.entities.delete(existing.id);
  return seedDemoCampaign(repos);
}

export async function seedDemoCampaign(repos: Repositories): Promise<DemoIds> {
  const E = repos.entities;
  const make = (input: EntityInput) => E.create(input);

  const campaign = await make({
    kind: "campaign",
    name: DEMO_CAMPAIGN_NAME,
    summary: "A lakeside town, a drowned saint, and a cult that sings beneath the water.",
    body_md: `Hollowmere sits on the edge of the Greyfen, where the old cistern of Saint Ilvane floods every spring. Lately the townsfolk hear singing from the drains at night, and the priest Brother Oswick has vanished.

The party is hired at the **[[The Drowned Lantern]]** by **[[Tamsin Reed]]** to find him.`,
    dm_notes_md: "Demo campaign. Use **Settings → Reset demo campaign** to restore it at any time.",
    fields: campaignFieldsSchema.parse({ is_demo: true, edition: "5e (2014)" }),
    tags: ["demo"],
  });
  const C = campaign.id;

  // ---- geography ----
  const world = await make({ kind: "world", name: "Aethermoor", campaign_id: C, summary: "A wide, rain-soaked world of marsh kingdoms and drowned shrines.", body_md: "Aethermoor's northern reaches are dominated by the Varnlands, a lowland continent of fens and slow rivers." });
  await E.update(world.id, { world_id: world.id });
  const W = world.id;
  const continent = await make({ kind: "continent", name: "The Varnlands", campaign_id: C, world_id: W, parent_id: W, summary: "Lowland continent of fens, lakes and old river kingdoms." });
  const kingdom = await make({ kind: "kingdom", name: "Kingdom of Ostmark", campaign_id: C, world_id: W, parent_id: continent.id, summary: "A fading river kingdom ruled from distant Ostkeep.", fields: { government: "Hereditary monarchy", population: "~400,000" } });
  const region = await make({ kind: "region", name: "The Greyfen Marches", campaign_id: C, world_id: W, parent_id: kingdom.id, summary: "Marshland frontier dotted with stilt villages and sunken ruins.", fields: { climate: "Cool, wet, foggy", rumors: "Something sings in the water at night." } });
  const town = await make({
    kind: "settlement",
    name: "Hollowmere",
    campaign_id: C,
    world_id: W,
    parent_id: region.id,
    summary: "A lakeside market town built over the flooded cistern of Saint Ilvane.",
    body_md: `Hollowmere's houses lean over canals that were once streets. The **Harbor Ward** is the busiest district; the old cistern beneath the chapel square is sealed... officially.

Notable places: [[The Drowned Lantern]], [[Cistern of the Drowned Saint]].`,
    read_aloud_md: "Mist hangs over Hollowmere like wet linen. Bells ring somewhere across the water, and the smell of peat smoke and fish fills the air.",
    fields: { population: "1,800", government: "Town council led by Harbor Master Maelis Vorn", services: "Inn, chandler, chapel of Saint Ilvane, town watch", discovered: true },
    tags: ["town", "start"],
  });
  const harbor = await make({ kind: "district", name: "Harbor Ward", campaign_id: C, world_id: W, parent_id: town.id, summary: "Docks, warehouses and the harbor master's counting house." });
  const tavern = await make({
    kind: "building",
    name: "The Drowned Lantern",
    campaign_id: C,
    world_id: W,
    parent_id: harbor.id,
    summary: "Tavern and inn run by Tamsin Reed; the party's starting point.",
    read_aloud_md: "A green glass lantern hangs over the door, lit even by day. Inside, nets and oars hang from the rafters, and a dozen locals fall silent as you enter.",
    dm_notes_md: "Tamsin offers 50 gp to find Brother Oswick. Maelis Vorn drinks here on Fireday evenings.",
  });
  const dungeon = await make({
    kind: "dungeon",
    name: "Cistern of the Drowned Saint",
    campaign_id: C,
    world_id: W,
    parent_id: town.id,
    summary: "The flooded cistern beneath Hollowmere's chapel square, now a hideout of the Drowned Choir.",
    body_md: "Built when Hollowmere was founded, the cistern was consecrated after Saint Ilvane drowned here in 1204 AR saving the town from the Great Flood. It has been sealed for forty years.",
    read_aloud_md: "Stone steps descend into darkness. Water drips somewhere ahead, and beneath it, faint and many-voiced, something is singing.",
    fields: { dungeon_type: "cistern / shrine", threat_level: "Levels 1–3", inhabitants: "Fen cultists of the Drowned Choir, a marsh lurker", entrance: "Grate behind the chapel of Saint Ilvane" },
    tags: ["dungeon"],
  });

  // ---- factions, religion, deity ----
  const cult = await make({
    kind: "faction",
    name: "The Drowned Choir",
    campaign_id: C,
    summary: "A cult that believes the drowned saint still sings beneath Hollowmere and wants to flood the town to wake her.",
    secret_md: "The Choir is financed by **[[Maelis Vorn]]**, who wants the town flooded so the harbor can be rebuilt on land he owns.",
    fields: { faction_type: "cult", goals: "Open the old sluice gates and flood Hollowmere during the spring rite.", influence: 4 },
  });
  const watch = await make({ kind: "faction", name: "Hollowmere Town Watch", campaign_id: C, summary: "Twelve guards under Captain Hessa Dunmore. Underpaid and under-informed.", fields: { faction_type: "militia", influence: 5 } });
  const saint = await make({
    kind: "deity",
    name: "Saint Ilvane of the Still Waters",
    campaign_id: C,
    summary: "Local saint of calm waters and quiet deaths, venerated in Hollowmere's chapel.",
    body_md: "Ilvane was a chapel warden who drowned closing the cistern gates during the Great Flood of 1203. Her relic, a verdigris signet ring, was sealed in the cistern reliquary.",
  });
  const rite = await make({ kind: "article", name: "The Still Waters Rite", campaign_id: C, summary: "Annual ceremony in which the town floats lanterns on the mere to honour Saint Ilvane.", body_md: "Held on the 20th of Seedtide. The Drowned Choir intends to use the rite's gathering as cover for opening the sluices. See [[The Drowned Choir]]." });
  await make({ kind: "article", name: "History of Hollowmere", campaign_id: C, summary: "From stilt village to market town.", body_md: "Founded in 980 AR as a fishing village. The cistern was built in 1012 AR. The Great Flood of 1203 AR drowned the lower town; [[Saint Ilvane of the Still Waters]] died sealing the gates the following spring." });

  // ---- NPCs & PCs ----
  const tamsin = await make({
    kind: "npc",
    name: "Tamsin Reed",
    campaign_id: C,
    parent_id: tavern.id,
    summary: "Keeper of the Drowned Lantern, quest giver. Brisk, kind, worried.",
    body_md: "Tamsin grew up with Brother Oswick and refuses to believe he simply left town.",
    fields: { race: "Human", class: "Commoner", level: 1, occupation: "Tavern keeper", motive: "Find Oswick; keep the town safe", voice: "Quick, clipped, calls everyone 'love'", attitude: "friendly", ac: 10, hp: 6, max_hp: 6 },
  });
  const vorn = await make({
    kind: "npc",
    name: "Maelis Vorn",
    campaign_id: C,
    parent_id: harbor.id,
    summary: "Harbor Master and council leader. Polished, generous, patient.",
    body_md: "Vorn owns the high ground east of the harbor. A flood would make his land the only buildable shore.",
    secret_md: "Vorn secretly funds [[The Drowned Choir]]. His ledger, hidden in the cistern shrine, proves it.",
    fields: { race: "Human", class: "Noble", level: 3, occupation: "Harbor Master", motive: "Wealth through controlled catastrophe", voice: "Warm baritone, never raises it", attitude: "neutral", ac: 12, hp: 18, max_hp: 18 },
  });
  const oswick = await make({
    kind: "npc",
    name: "Brother Oswick",
    campaign_id: C,
    parent_id: dungeon.id,
    summary: "Priest of Saint Ilvane, kidnapped by the Choir. Knows the cistern's history.",
    body_md: "Oswick discovered the Choir's plan and was taken when he tried to warn the council.",
    secret_md: "Oswick recognised Vorn's seal on the cult's supply crates.",
    fields: { race: "Halfling", class: "Acolyte", level: 2, occupation: "Priest", motive: "Protect the relic and the town", voice: "Soft, wheezing, quotes scripture", attitude: "friendly", ac: 10, hp: 9, max_hp: 9 },
    status: "captive",
  });
  const hessa = await make({ kind: "npc", name: "Captain Hessa Dunmore", campaign_id: C, parent_id: town.id, summary: "Captain of the Town Watch. Suspicious of outsiders, loyal to the town.", fields: { race: "Human", class: "Veteran", level: 4, occupation: "Watch captain", attitude: "neutral", ac: 16, hp: 32, max_hp: 32 } });
  const kaelen = await make({
    kind: "pc",
    name: "Kaelen Ashvale",
    campaign_id: C,
    summary: "Human fighter, former Ostmark levy. Steady and literal.",
    fields: { race: "Human", class: "Fighter", level: 2, alignment: "Lawful Neutral", ac: 15, hp: 20, max_hp: 20, speed: 30, abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 9 }, skills: "Athletics +5, Perception +2", attacks: "Longsword +5 (1d8+3 slashing)", player_name: "Player 1", passive_perception: 12 },
  });
  const nyx = await make({
    kind: "pc",
    name: "Nyx Thornwood",
    campaign_id: C,
    summary: "Half-elf rogue who grew up on Hollowmere's canals.",
    fields: { race: "Half-elf", class: "Rogue", level: 2, alignment: "Chaotic Good", ac: 14, hp: 15, max_hp: 15, speed: 30, abilities: { str: 9, dex: 17, con: 12, int: 13, wis: 12, cha: 14 }, skills: "Stealth +7, Thieves' Tools +7, Investigation +5, Perception +3", attacks: "Rapier +5 (1d8+3 piercing), Shortbow +5 (1d6+3)", player_name: "Player 2", passive_perception: 13 },
  });

  // ---- creatures ----
  const cultist = await make({
    kind: "creature",
    name: "Fen Cultist",
    campaign_id: C,
    summary: "Robed townsfolk with waterlogged lungs and reed-knives.",
    fields: { size: "Medium", type: "humanoid", alignment: "neutral evil", cr: "1/8", xp: 25, ac: 12, hp: 9, hp_formula: "2d8", speed: "30 ft., swim 20 ft.", abilities: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 }, skills: "Religion +2", senses: "passive Perception 10", languages: "Common", traits: "Drowned Lungs. Can hold breath for 30 minutes.", actions: "Reed Knife. Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d4+1) slashing damage." },
  });
  const adept = await make({
    kind: "creature",
    name: "Cult Adept of the Choir",
    campaign_id: C,
    summary: "A choir leader whose hymn churns the water.",
    fields: { size: "Medium", type: "humanoid", alignment: "neutral evil", cr: "1/2", xp: 100, ac: 13, hp: 22, hp_formula: "4d8+4", speed: "30 ft.", abilities: { str: 10, dex: 12, con: 12, int: 12, wis: 14, cha: 15 }, saves: "Wis +4", skills: "Religion +3, Persuasion +4", senses: "passive Perception 12", languages: "Common, Aquan", actions: "Hymn of the Deep (Recharge 5–6). Each creature within 15 ft. must succeed on a DC 12 Wisdom saving throw or be frightened until the end of its next turn.\nStaff. Melee Weapon Attack: +2 to hit, 5 ft., one target. Hit: 3 (1d6) bludgeoning damage.", legendary_actions: 0 },
  });
  const lurker = await make({
    kind: "creature",
    name: "Marsh Lurker",
    campaign_id: C,
    summary: "A pale, eyeless amphibian the size of a pony that hunts by vibration.",
    fields: { size: "Large", type: "monstrosity", alignment: "unaligned", cr: "1", xp: 200, ac: 13, hp: 30, hp_formula: "4d10+8", speed: "20 ft., swim 40 ft.", abilities: { str: 15, dex: 13, con: 14, int: 2, wis: 12, cha: 4 }, senses: "blindsight 30 ft., passive Perception 11", traits: "Amphibious. Can breathe air and water.", actions: "Bite. Melee Weapon Attack: +4 to hit, 5 ft., one target. Hit: 9 (2d6+2) piercing damage, and the target is grappled (escape DC 12)." },
  });

  // ---- item definitions ----
  const item = (name: string, summary: string, fields: Record<string, unknown>, extra: Partial<EntityInput> = {}) =>
    make({ kind: "item", name, campaign_id: C, summary, fields, ...extra });
  const potion = await item("Potion of Healing", "A red liquid that glimmers when shaken. Heals 2d4+2.", { category: "potion", rarity: "common", weight: 0.5, value_gp: 50, effects: "Regain 2d4+2 hit points.", magical: true });
  const key = await item("Verdigris Key", "A green-crusted bronze key shaped like a reed.", { category: "key", rarity: "common", weight: 0.1, value_gp: 1, stackable: false, restrictions: "Opens the reliquary chest in the Cistern." });
  const signet = await item("Saint Ilvane's Signet", "The saint's relic: a verdigris ring carved with ripples.", { category: "quest", rarity: "rare", weight: 0, value_gp: 500, stackable: false, magical: true, effects: "While worn, the bearer can breathe water for 10 minutes once per day." });
  const gold = await item("Gold Pieces", "Ostmark crowns.", { category: "currency", rarity: "common", weight: 0.02, value_gp: 1 });
  const longsword = await item("Longsword", "A soldier's longsword with a worn grip.", { category: "weapon", rarity: "common", weight: 3, value_gp: 15, damage: "1d8", damage_type: "slashing", properties: "Versatile (1d10)", stackable: false });
  const leather = await item("Leather Armor", "Boiled leather cuirass.", { category: "armor", rarity: "common", weight: 10, value_gp: 10, armor_class: "11 + Dex", stackable: false });
  const tools = await item("Thieves' Tools", "Picks, files and a small mirror in a roll of oilcloth.", { category: "tool", rarity: "common", weight: 1, value_gp: 25, stackable: false });
  const rapier = await item("Rapier", "Slim and quick.", { category: "weapon", rarity: "common", weight: 2, value_gp: 25, damage: "1d8", damage_type: "piercing", properties: "Finesse", stackable: false });
  const journal = await item("Waterlogged Journal", "A ledger bound in sealskin. The ink has run, but the seal on the first page is intact.", { category: "document", rarity: "common", weight: 1, value_gp: 0, stackable: false }, { secret_md: "Lists payments from [[Maelis Vorn]] to the Drowned Choir. Reading it reveals the secret **Vorn funds the Choir**." });
  const medallion = await item("Drowned Choir Medallion", "A lead disc stamped with a wave and an open mouth.", { category: "treasure", rarity: "common", weight: 0.3, value_gp: 5, stackable: false });

  // ---- quest, secret, events ----
  const quest = await make({
    kind: "quest",
    name: "The Missing Priest",
    campaign_id: C,
    status: "active",
    summary: "Find Brother Oswick, last seen near the sealed cistern.",
    body_md: "Tamsin Reed offers 50 gp. The trail leads through the chapel grate into the [[Cistern of the Drowned Saint]].",
    fields: { giver_id: tamsin.id, reward: "50 gp, Tamsin's gratitude, free lodging", level_range: "1–3", hook: "Singing from the drains; a priest gone missing", priority: "main", consequences: "If Oswick dies, the Choir learns the party is coming." },
  });
  const obj1 = await repos.quests.addObjective(quest.id, "Learn where Brother Oswick was taken");
  await repos.quests.updateObjective(obj1.id, { status: "done" });
  const obj2 = await repos.quests.addObjective(quest.id, "Enter the Cistern of the Drowned Saint");
  const obj3 = await repos.quests.addObjective(quest.id, "Rescue Brother Oswick");
  const obj4 = await repos.quests.addObjective(quest.id, "Recover Saint Ilvane's Signet", true);
  void obj2;
  void obj4;
  const secret = await make({
    kind: "secret",
    name: "Vorn funds the Drowned Choir",
    campaign_id: C,
    summary: "The Harbor Master is paying the cult to flood the town.",
    secret_md: "Proof is in the Waterlogged Journal in the Sunken Shrine. Oswick also recognised Vorn's seal.",
    fields: { reveal_condition: "A character reads the Waterlogged Journal, or Oswick is rescued and questioned.", importance: "campaign" },
  });
  await make({ kind: "trap", name: "Reliquary Dart Trap", campaign_id: C, parent_id: dungeon.id, summary: "Pressure plate in the Flooded Hall fires rusted darts.", fields: { trigger: "Pressure plate (hidden under silt)", effect: "Darts from the east wall", detect_dc: 13, disarm_dc: 13, save: "DC 12 Dexterity, half damage", damage: "2d4 piercing", severity: "setback" } });
  await make({ kind: "shop", name: "Greyfen Chandlery", campaign_id: C, parent_id: harbor.id, summary: "Rope, lamp oil, salted fish and the occasional potion.", body_md: "Run by a taciturn dwarf named Brannoc Tarr." });

  await repos.timeline.create({ campaign_id: C, entity_id: town.id, title: "Hollowmere founded", body_md: "Fishing village on stilts.", year: 980, month: 5, day: 1, kind: "history", secret: false });
  await repos.timeline.create({ campaign_id: C, entity_id: dungeon.id, title: "The cistern is built", body_md: "", year: 1012, month: 8, day: 14, kind: "history", secret: false });
  await repos.timeline.create({ campaign_id: C, entity_id: null, title: "The Great Flood", body_md: "The lower town drowns.", year: 1203, month: 3, day: 22, kind: "history", secret: false });
  await repos.timeline.create({ campaign_id: C, entity_id: saint.id, title: "Saint Ilvane drowns sealing the gates", body_md: "", year: 1204, month: 3, day: 2, kind: "history", secret: false });
  await repos.timeline.create({ campaign_id: C, entity_id: oswick.id, title: "Brother Oswick disappears", body_md: "Last seen near the chapel grate.", year: 1247, month: 4, day: 9, kind: "campaign", secret: false });
  await repos.timeline.create({ campaign_id: C, entity_id: rite.id, title: "The Still Waters Rite (the Choir's deadline)", body_md: "The cult plans to open the sluices during the rite.", year: 1247, month: 4, day: 20, kind: "scheduled", secret: true });

  // ---- links ----
  const L = (a: Entity, b: Entity, rel: string, note = "") => E.link(a.id, b.id, rel, note);
  await L(vorn, cult, "secretly_funds", "Hidden motive");
  await L(oswick, saint, "serves");
  await L(tamsin, quest, "gives");
  await L(quest, oswick, "concerns");
  await L(quest, dungeon, "takes_place_in");
  await L(secret, vorn, "about");
  await L(secret, journal, "clue");
  await L(hessa, watch, "leads");
  await L(cult, dungeon, "occupies");
  await L(cult, saint, "venerates");
  await L(rite, saint, "honours");
  await L(adept, cult, "member_of");
  await L(cultist, cult, "member_of");
  await L(lurker, dungeon, "lairs_in");
  await L(kaelen, nyx, "ally");

  // ---- world map (Azgaar) ----
  await repos.worldMaps.create({ campaign_id: C, world_id: W, name: "Aethermoor — Varnlands", seed: DEMO_MAP_SEED, notes: "Generated from a fixed seed in the World Atlas. Open the atlas and press 'Save map to campaign' to store the .map file." });

  // ---- dungeon geometry ----
  const floor = await repos.dungeons.createFloor({ dungeon_id: dungeon.id, name: "Cistern level", level: -1, width: 30, height: 20, cell_feet: 5 });
  const roomSpecs = [
    { key: "entry", number: "1", name: "Entry Stair", x: 2, y: 9, w: 4, h: 4, lighting: "dim (daylight from above)", read: "Slick steps descend to a landing of green stone. Water laps at the bottom step.", body: "Spiral stair from the chapel grate.", dm: "Safe room. Passive Perception 12+ hears singing from the east." },
    { key: "hall", number: "2", name: "Flooded Hall", x: 6, y: 6, w: 9, h: 10, lighting: "dark", terrain: "ankle-deep water, silt", read: "A long vaulted hall, flooded ankle-deep. Pillars carved as reeds rise from the water. Something glints beneath the silt near the middle of the room.", body: "The hall's floor hides a pressure-plate dart trap near its centre.", dm: "Trap at the centre (DC 13 to spot). Doors: north-east to the Reliquary, south-east to the Guard Post." },
    { key: "reliquary", number: "3", name: "Saint's Reliquary", x: 15, y: 3, w: 7, h: 6, lighting: "dark", terrain: "dry stone", read: "A dry chamber. A statue of a drowned woman holds out cupped hands. Before her stands an iron-bound chest streaked with verdigris.", body: "The reliquary holds Saint Ilvane's signet in a locked chest.", dm: "Chest locked (DC 15) — the Verdigris Key is hidden in the statue's offering niche (Investigation DC 12). Nyx can pick the lock." },
    { key: "guard", number: "4", name: "Guard Post", x: 15, y: 10, w: 8, h: 6, lighting: "dim (lantern)", terrain: "wet stone", read: "Lantern light flickers on three robed figures hunched over a brazier. A fourth, taller, hums a slow tune.", body: "The Drowned Choir's picket. Encounter: Guard Post Ambush.", dm: "Encounter marker fires when a token enters. Secret door in the east wall (Perception DC 15) leads to the Sunken Shrine." },
    { key: "shrine", number: "5", name: "Sunken Shrine", x: 23, y: 9, w: 5, h: 7, lighting: "dark", terrain: "knee-deep water", read: "A half-drowned shrine. A small figure is tied to the altar rail — Brother Oswick, pale but breathing. A rotting bookshelf stands against the far wall.", body: "Where the Choir keeps Oswick and Vorn's ledger.", dm: "Oswick (captive). Bookshelf holds the Waterlogged Journal (clue to the campaign secret)." },
  ];
  const rooms: Record<string, string> = {};
  const walls = [] as ReturnType<typeof rectWalls>;
  for (const spec of roomSpecs) {
    const room = await repos.dungeons.createRoom({
      floor_id: floor.id,
      campaign_id: C,
      dungeon_id: dungeon.id,
      name: spec.name,
      number: spec.number,
      x: spec.x,
      y: spec.y,
      w: spec.w,
      h: spec.h,
      lighting: spec.lighting,
      terrain: spec.terrain ?? "stone floor",
      read_aloud_md: spec.read,
      body_md: spec.body,
      dm_notes_md: spec.dm,
      state: spec.key === "entry" ? { explored: true, discovered: true } : spec.key === "hall" ? { trapped: true } : {},
    });
    rooms[spec.key] = room.id;
    walls.push(...rectWalls({ x: spec.x, y: spec.y, w: spec.w, h: spec.h }, newId));
  }
  await repos.dungeons.updateFloor(floor.id, { walls });

  // doors: vertical doors sit on the left edge of cell (x, y)
  await repos.dungeons.createDoor({ floor_id: floor.id, x: 6, y: 10, orientation: "v", kind: "door", state: "closed", room_a: rooms.entry!, room_b: rooms.hall!, notes: "Warped oak, swollen shut but unlocked." });
  await repos.dungeons.createDoor({ floor_id: floor.id, x: 15, y: 7, orientation: "v", kind: "door", state: "locked", lock_dc: 13, room_a: rooms.hall!, room_b: rooms.reliquary!, notes: "Bronze door with a reed motif." });
  await repos.dungeons.createDoor({ floor_id: floor.id, x: 15, y: 12, orientation: "v", kind: "door", state: "closed", room_a: rooms.hall!, room_b: rooms.guard!, notes: "Ajar; lantern light leaks through." });
  const secretDoor = await repos.dungeons.createDoor({ floor_id: floor.id, x: 23, y: 12, orientation: "v", kind: "secret", state: "closed", hidden: true, discovered: false, room_a: rooms.guard!, room_b: rooms.shrine!, notes: "Perception DC 15 to notice the draft." });

  // objects
  const chest = await repos.dungeons.createObject({
    floor_id: floor.id,
    room_id: rooms.reliquary!,
    kind: "container",
    name: "Reliquary Chest",
    x: 19,
    y: 4,
    state: { locked: true, open: false, lock_dc: 15, key_item_id: key.id },
    interactions: containerInteractions({ lockDc: 15, keyItemId: key.id }),
    notes: "Iron-bound, verdigris-streaked. Holds the Signet.",
  });
  const niche = await repos.dungeons.createObject({
    floor_id: floor.id,
    room_id: rooms.reliquary!,
    kind: "container",
    name: "Offering Niche",
    x: 16,
    y: 4,
    hidden: true,
    discovered: false,
    state: { locked: false, open: false },
    interactions: containerInteractions({}),
    notes: "Hidden behind the statue's hands. Contains the Verdigris Key.",
  });
  await repos.dungeons.createObject({
    floor_id: floor.id,
    room_id: rooms.reliquary!,
    kind: "statue",
    name: "Statue of Saint Ilvane",
    x: 17,
    y: 4,
    interactions: investigateInteractions({ dc: 12, revealObjectId: niche.id, message: "Behind the cupped hands is a small niche holding a green key." }),
    notes: "Investigation DC 12 reveals the offering niche.",
  });
  const trap = await repos.dungeons.createObject({
    floor_id: floor.id,
    room_id: rooms.hall!,
    kind: "trap",
    name: "Dart Trap Plate",
    x: 10,
    y: 11,
    hidden: true,
    discovered: false,
    state: { trap_dc: 13, trap_damage: "2d4", detected: false, disarmed: false, triggered: false },
    interactions: trapInteractions({ detectDc: 13, disarmDc: 13, damage: "2d4", saveText: "DC 12 Dexterity save for half" }),
    notes: "Rusted darts from the east wall.",
  });
  await repos.dungeons.createObject({ floor_id: floor.id, room_id: rooms.guard!, kind: "furniture", name: "Brazier", x: 18, y: 12, interactions: [], notes: "Warm. Cult robes drying beside it." });
  const bookshelf = await repos.dungeons.createObject({
    floor_id: floor.id,
    room_id: rooms.shrine!,
    kind: "container",
    name: "Rotting Bookshelf",
    x: 27,
    y: 10,
    state: { locked: false, open: true },
    interactions: containerInteractions({}),
    notes: "Holds the Waterlogged Journal.",
  });
  await repos.dungeons.createObject({ floor_id: floor.id, room_id: rooms.shrine!, kind: "altar", name: "Drowned Altar", x: 25, y: 14, w: 2, h: 1, interactions: investigateInteractions({ dc: 10, message: "Fresh offerings: lead medallions and a harbor-master's tally stick." }), notes: "Oswick is tied to the rail." });

  // tokens
  await repos.dungeons.createToken({ floor_id: floor.id, entity_id: kaelen.id, name: "Kaelen", kind: "pc", x: 3, y: 10, hp: 20, max_hp: 20, speed: 30, color: "#3f7fbf" });
  await repos.dungeons.createToken({ floor_id: floor.id, entity_id: nyx.id, name: "Nyx", kind: "pc", x: 4, y: 11, hp: 15, max_hp: 15, speed: 30, color: "#5fa86a" });
  await repos.dungeons.createToken({ floor_id: floor.id, entity_id: oswick.id, name: "Oswick", kind: "npc", x: 25, y: 13, hp: 4, max_hp: 9, speed: 25, color: "#c9a44c" });

  // encounters
  const ambush = await make({
    kind: "encounter",
    name: "Guard Post Ambush",
    campaign_id: C,
    parent_id: dungeon.id,
    summary: "Three Fen Cultists and a Cult Adept guard the way to the shrine.",
    read_aloud_md: "The humming stops. Three hooded figures rise from the brazier, reed-knives dripping, as the tall one raises her staff and begins to sing.",
    dm_notes_md: "Adept uses Hymn of the Deep on round 1. Cultists flee at half strength if the Adept falls. Reinforcement: a Marsh Lurker surfaces on round 4 if the fight is loud.",
    fields: { encounter_type: "combat", difficulty: "medium", environment: "Dim light, wet stone (difficult terrain near the drains)", reinforcements: "Marsh Lurker on round 4 (optional)", treasure: "Drowned Choir Medallion on the Adept", alternative_outcomes: "Cultists may surrender if the Adept is captured alive.", conditional_events: "If the Adept finishes her hymn twice, the secret door opens on its own.", xp_total: 175 },
  });
  await repos.encounters.addParticipant({ encounter_id: ambush.id, entity_id: cultist.id, label: "Fen Cultist", count: 3, side: "enemy", notes: "", sort_order: 0 });
  await repos.encounters.addParticipant({ encounter_id: ambush.id, entity_id: adept.id, label: "Cult Adept", count: 1, side: "enemy", notes: "Leader", sort_order: 1 });
  const parley = await make({
    kind: "encounter",
    name: "Parley with Brother Oswick",
    campaign_id: C,
    parent_id: dungeon.id,
    summary: "A social encounter: free Oswick and learn what he knows.",
    read_aloud_md: "\"You came,\" the halfling croaks. \"Then listen — it was Vorn's seal on the crates. Vorn!\"",
    fields: { encounter_type: "social", difficulty: "easy", alternative_outcomes: "If the party is hostile, Oswick clams up until healed." },
  });
  await repos.encounters.addParticipant({ encounter_id: parley.id, entity_id: oswick.id, label: "Brother Oswick", count: 1, side: "ally", notes: "Captive", sort_order: 0 });
  await L(ambush, cult, "involves");
  await L(parley, secret, "may_reveal");

  // markers
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.guard!, kind: "encounter", title: "Guard Post Ambush", body_md: "Fires when a token enters the Guard Post.", x: 18, y: 11, w: 2, h: 2, trigger: "enter_room", trigger_ref: rooms.guard!, encounter_id: ambush.id });
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.hall!, kind: "trap", title: "Dart trap", body_md: "Pressure plate under the silt. 2d4 piercing, DC 12 Dex half.", x: 10, y: 11, trigger: "step_trap", trigger_ref: trap.id });
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.reliquary!, kind: "treasure", title: "The Saint's chest", body_md: "Locked (DC 15) or opened with the Verdigris Key hidden in the statue.", x: 19, y: 4, trigger: "manual", trigger_ref: chest.id, entity_id: signet.id });
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.shrine!, kind: "npc", title: "Oswick's plea", body_md: "Read the Parley encounter's read-aloud text when the party enters.", x: 25, y: 13, trigger: "enter_room", trigger_ref: rooms.shrine!, entity_id: oswick.id, encounter_id: parley.id });
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.shrine!, kind: "clue", title: "Vorn's ledger", body_md: "The Waterlogged Journal on the bookshelf proves Vorn funds the Choir.", x: 27, y: 10, trigger: "manual", trigger_ref: bookshelf.id, entity_id: secret.id });
  await repos.dungeons.createMarker({ floor_id: floor.id, room_id: rooms.guard!, kind: "secret", title: "Secret door to the shrine", body_md: "Perception DC 15. Use the door's 'Discover' action when found.", x: 22, y: 12, trigger: "discover_secret", trigger_ref: secretDoor.id });

  // item instances
  const inv = repos.inventory;
  await inv.grant(C, longsword.id, 1, { owner_type: "character", owner_id: kaelen.id }, { equipped: true }, "starting gear");
  await inv.grant(C, leather.id, 1, { owner_type: "character", owner_id: kaelen.id }, { equipped: true }, "starting gear");
  await inv.grant(C, gold.id, 15, { owner_type: "character", owner_id: kaelen.id }, {}, "starting gear");
  await inv.grant(C, rapier.id, 1, { owner_type: "character", owner_id: nyx.id }, { equipped: true }, "starting gear");
  await inv.grant(C, tools.id, 1, { owner_type: "character", owner_id: nyx.id }, {}, "starting gear");
  await inv.grant(C, gold.id, 8, { owner_type: "character", owner_id: nyx.id }, {}, "starting gear");
  await inv.grant(C, potion.id, 2, { owner_type: "object", owner_id: chest.id }, {}, "placed in chest");
  await inv.grant(C, signet.id, 1, { owner_type: "object", owner_id: chest.id }, {}, "placed in chest");
  await inv.grant(C, gold.id, 35, { owner_type: "object", owner_id: chest.id }, {}, "placed in chest");
  await inv.grant(C, key.id, 1, { owner_type: "object", owner_id: niche.id }, {}, "hidden in niche");
  await inv.grant(C, journal.id, 1, { owner_type: "object", owner_id: bookshelf.id }, {}, "on the shelf");
  await inv.grant(C, medallion.id, 1, { owner_type: "hoard", owner_id: ambush.id }, {}, "encounter treasure");
  await inv.grant(C, potion.id, 3, { owner_type: "shop", owner_id: (await E.findByName(C, "Greyfen Chandlery"))!.id }, {}, "shop stock");

  // session
  const session = await make({
    kind: "session",
    name: "Session 1: Whispers at the Drowned Lantern",
    campaign_id: C,
    summary: "The party takes Tamsin's job and descends into the cistern.",
    fields: {
      number: 1,
      status: "planned",
      outline_md: `1. Open at the [[The Drowned Lantern]]: Tamsin's plea, rumours of singing drains.
2. Optional: Captain Dunmore warns the party off; Vorn offers "help".
3. The chapel grate → [[Cistern of the Drowned Saint]].
4. Flooded Hall trap, Reliquary chest, Guard Post ambush.
5. Cliffhanger: Oswick's accusation.`,
      planned_encounter_ids: [ambush.id, parley.id],
      location_ids: [tavern.id, dungeon.id],
      rewards_md: "50 gp from Tamsin; the Signet; XP 175 + 50 (roleplay).",
    },
  });
  await repos.sessionNotes.add(session.id, C, "Remember: the singing gets louder the closer they are to the shrine.", "note");
  await repos.sessionNotes.add(session.id, C, "If Nyx searches the harbor master's office later, plant the second ledger.", "todo");

  const fields = campaignFieldsSchema.parse({ ...campaign.fields, party_location_id: town.id, active_session_id: session.id });
  await E.update(C, { fields });
  await repos.campaignLog.add(C, "campaign", "Demo campaign seeded.", {});
  void obj3;

  return { campaign: C, world: W, dungeon: dungeon.id, floor: floor.id, rooms, chest: chest.id, pcs: [kaelen.id, nyx.id] };
}
