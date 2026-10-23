import type { SqlDriver } from "../driver";
import { DungeonRepository } from "./dungeons";
import { EncounterRepository } from "./encounters";
import { EntityRepository } from "./entities";
import { InventoryRepository } from "./inventory";
import { AssetRepository, CampaignLogRepository, QuestRepository, SessionNoteRepository, SettingsRepository, TimelineRepository } from "./misc";
import { WorldMapRepository } from "./worldMaps";

/** Everything the application needs to read and write campaign data. */
export interface Repositories {
  driver: SqlDriver;
  entities: EntityRepository;
  worldMaps: WorldMapRepository;
  dungeons: DungeonRepository;
  inventory: InventoryRepository;
  encounters: EncounterRepository;
  quests: QuestRepository;
  timeline: TimelineRepository;
  sessionNotes: SessionNoteRepository;
  campaignLog: CampaignLogRepository;
  settings: SettingsRepository;
  assets: AssetRepository;
}

export function createRepositories(driver: SqlDriver): Repositories {
  return {
    driver,
    entities: new EntityRepository(driver),
    worldMaps: new WorldMapRepository(driver),
    dungeons: new DungeonRepository(driver),
    inventory: new InventoryRepository(driver),
    encounters: new EncounterRepository(driver),
    quests: new QuestRepository(driver),
    timeline: new TimelineRepository(driver),
    sessionNotes: new SessionNoteRepository(driver),
    campaignLog: new CampaignLogRepository(driver),
    settings: new SettingsRepository(driver),
    assets: new AssetRepository(driver),
  };
}

export { DungeonRepository, EncounterRepository, EntityRepository, InventoryRepository, WorldMapRepository };
export { AssetRepository, CampaignLogRepository, QuestRepository, SessionNoteRepository, SettingsRepository, TimelineRepository };
