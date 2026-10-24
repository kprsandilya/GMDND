import { Route, Routes } from "react-router";
import { CampaignsPage } from "@/features/campaigns/CampaignsPage";
import { CharactersPage } from "@/features/characters/CharactersPage";
import { CreaturesPage } from "@/features/creatures/CreaturesPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DungeonsPage } from "@/features/dungeons/DungeonsPage";
import { EncountersPage } from "@/features/encounters/EncountersPage";
import { ItemsPage } from "@/features/items/ItemsPage";
import { PartiesPage } from "@/features/parties/PartiesPage";
import { LocationsPage } from "@/features/locations/LocationsPage";
import { LorePage } from "@/features/lore/LorePage";
import { QuestsPage } from "@/features/quests/QuestsPage";
import { SearchPage } from "@/features/search/SearchPage";
import { SessionsPage } from "@/features/sessions/SessionsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TimelinePage } from "@/features/timeline/TimelinePage";
import { Shell } from "./Shell";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="atlas" element={null} />
        <Route path="atlas/:mapId" element={null} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="locations/:id" element={<LocationsPage />} />
        <Route path="dungeons" element={<DungeonsPage />} />
        <Route path="dungeons/:id" element={<DungeonsPage />} />
        <Route path="encounters" element={<EncountersPage />} />
        <Route path="encounters/:id" element={<EncountersPage />} />
        <Route path="characters" element={<CharactersPage />} />
        <Route path="characters/:id" element={<CharactersPage />} />
        <Route path="parties" element={<PartiesPage />} />
        <Route path="parties/:id" element={<PartiesPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="items/:id" element={<ItemsPage />} />
        <Route path="creatures" element={<CreaturesPage />} />
        <Route path="creatures/:id" element={<CreaturesPage />} />
        <Route path="quests" element={<QuestsPage />} />
        <Route path="quests/:id" element={<QuestsPage />} />
        <Route path="lore" element={<LorePage />} />
        <Route path="lore/:id" element={<LorePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:id" element={<SessionsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  );
}
