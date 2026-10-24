import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { migrate } from "@/persistence/migrations";
import { createRepositories, type Repositories } from "@/persistence/repositories";
import { TauriSqlDriver } from "@/persistence/tauriDriver";
import { findDemoCampaign, seedDemoCampaign } from "@/seed/demoCampaign";
import { seedSrdLibrary } from "@/seed/srdLibrary";
import { errorMessage } from "@/lib/utils";
import { useAppStore } from "./appStore";
import { isTauri, platform, type AppPaths } from "./platform";

interface AppContextValue {
  repos: Repositories;
  paths: AppPaths | null;
  appVersion: string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useRepos(): Repositories {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useRepos must be used inside AppProvider");
  return ctx.repos;
}

export function useAppInfo(): Pick<AppContextValue, "paths" | "appVersion"> {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppInfo must be used inside AppProvider");
  return { paths: ctx.paths, appVersion: ctx.appVersion };
}

type Boot = { status: "loading"; step: string } | { status: "ready"; value: AppContextValue } | { status: "error"; message: string };

/** Opens the database, runs migrations, seeds the demo campaign on first launch and takes a startup snapshot. */
export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ status: "loading", step: "Starting" });
  const settings = useAppStore((s) => s.settings);
  const campaignId = useAppStore((s) => s.campaignId);
  const setCampaignId = useAppStore((s) => s.setCampaignId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isTauri()) {
          setBoot({ status: "error", message: "DM Workbench must run inside its desktop window. Start it with `npm run desktop:dev` or launch the installed application." });
          return;
        }
        setBoot({ status: "loading", step: "Opening database" });
        const driver = new TauriSqlDriver();
        const migration = await migrate(driver);
        const repos = createRepositories(driver);
        const paths = await platform.paths();
        const appVersion = await platform.appVersion();

        // Install / refresh the bundled SRD-2024 standard library (campaign-independent records
        // shared by every campaign). Idempotent and versioned, so this is a no-op after the first run.
        setBoot({ status: "loading", step: "Loading standard rules library" });
        await seedSrdLibrary(repos).catch((error) => console.warn("SRD library seeding failed", error));

        setBoot({ status: "loading", step: "Checking campaigns" });
        const campaigns = await repos.entities.list({ kinds: ["campaign"] });
        // Seed Embers of Hollowmere only on the first launch of a fresh database. Deleting the
        // last campaign (including the demo) must not recreate it on the next start — use
        // Campaigns → Reset demo campaign if you want it back.
        const firstRunComplete = await repos.settings.get<boolean>("first_run_complete", false);
        if (campaigns.length === 0 && !firstRunComplete) {
          setBoot({ status: "loading", step: "Seeding the demo campaign" });
          const ids = await seedDemoCampaign(repos);
          setCampaignId(ids.campaign);
        } else if (campaigns.length === 0) {
          setCampaignId(null);
        } else if (!campaignId || !campaigns.some((c) => c.id === campaignId)) {
          const demo = await findDemoCampaign(repos);
          setCampaignId((demo ?? campaigns[0]!).id);
        }
        await repos.settings.set("first_run_complete", true);
        const sessionId = useAppStore.getState().activeSessionId;
        const activeCampaign = useAppStore.getState().campaignId;
        if (sessionId) {
          const session = await repos.entities.find(sessionId);
          if (!session || session.kind !== "session" || (session.campaign_id && session.campaign_id !== activeCampaign)) {
            useAppStore.getState().setActiveSessionId(null);
          }
        }
        if (settings.autoBackupOnStart && migration.to > 0) {
          setBoot({ status: "loading", step: "Creating startup snapshot" });
          await platform.autoBackup(settings.autoBackupKeep).catch((error) => console.warn("auto backup failed", error));
        }
        if (!cancelled) setBoot({ status: "ready", value: { repos, paths, appVersion } });
      } catch (error) {
        if (!cancelled) setBoot({ status: "error", message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => (boot.status === "ready" ? boot.value : null), [boot]);

  if (boot.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
        <div className="font-display text-2xl text-ember-soft">DM Workbench</div>
        <div className="text-sm">{boot.step}…</div>
      </div>
    );
  }
  if (boot.status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="panel max-w-xl p-6">
          <h1 className="mb-2 text-lg text-blood">Could not start</h1>
          <p className="selectable text-ink-muted">{boot.message}</p>
        </div>
      </div>
    );
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
