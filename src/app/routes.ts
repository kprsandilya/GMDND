import type { Entity, EntityKind } from "@/domain/types";

export const MODULE_FOR_KIND: Record<EntityKind, string> = {
  campaign: "campaigns",
  world: "locations",
  continent: "locations",
  region: "locations",
  kingdom: "locations",
  settlement: "locations",
  district: "locations",
  building: "locations",
  location: "locations",
  dungeon: "dungeons",
  room: "dungeons",
  pc: "characters",
  npc: "characters",
  creature: "creatures",
  item: "items",
  spell: "items",
  faction: "lore",
  religion: "lore",
  deity: "lore",
  quest: "quests",
  event: "lore",
  trap: "lore",
  shop: "lore",
  secret: "lore",
  article: "lore",
  document: "lore",
  encounter: "encounters",
  session: "sessions",
};

export function routeForEntity(entity: Pick<Entity, "id" | "kind" | "parent_id">): string {
  const module = MODULE_FOR_KIND[entity.kind];
  if (entity.kind === "room") return `/dungeons/${entity.parent_id ?? ""}?room=${entity.id}`;
  if (entity.kind === "campaign") return "/campaigns";
  return `/${module}/${entity.id}`;
}

export const NAV_ITEMS: { to: string; label: string; icon: string; shortcut?: string }[] = [
  { to: "/", label: "Dashboard", icon: "LayoutDashboard", shortcut: "1" },
  { to: "/campaigns", label: "Campaigns", icon: "BookOpen", shortcut: "2" },
  { to: "/atlas", label: "World Atlas", icon: "Globe2", shortcut: "3" },
  { to: "/locations", label: "Locations", icon: "MapPin", shortcut: "4" },
  { to: "/dungeons", label: "Dungeons & Maps", icon: "Grid3x3", shortcut: "5" },
  { to: "/encounters", label: "Encounters", icon: "Swords", shortcut: "6" },
  { to: "/characters", label: "Characters & NPCs", icon: "Users", shortcut: "7" },
  { to: "/items", label: "Items & Equipment", icon: "Package", shortcut: "8" },
  { to: "/creatures", label: "Creatures", icon: "Skull", shortcut: "9" },
  { to: "/quests", label: "Quests & Events", icon: "ScrollText" },
  { to: "/lore", label: "Lore & Documents", icon: "Library" },
  { to: "/timeline", label: "Timeline", icon: "CalendarClock" },
  { to: "/sessions", label: "Session Manager", icon: "Play" },
  { to: "/search", label: "Global Search", icon: "Search" },
  { to: "/settings", label: "Settings & Data", icon: "Settings" },
];
