import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppSettings {
  theme: "ember" | "slate";
  defaultCellFeet: number;
  defaultGridWidth: number;
  defaultGridHeight: number;
  showGrid: boolean;
  snapToGrid: boolean;
  autosaveMapMinutes: number;
  autoBackupOnStart: boolean;
  autoBackupKeep: number;
  backupDirectory: string | null;
  diagonalRule: "chebyshev" | "5-10-5";
  enforceMovementBudget: boolean;
  confirmDeletes: boolean;
  sidebarCollapsed: boolean;
  rightPanelWidth: number;
  listPanelWidth: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "ember",
  defaultCellFeet: 5,
  defaultGridWidth: 30,
  defaultGridHeight: 20,
  showGrid: true,
  snapToGrid: true,
  autosaveMapMinutes: 5,
  autoBackupOnStart: true,
  autoBackupKeep: 7,
  backupDirectory: null,
  diagonalRule: "chebyshev",
  enforceMovementBudget: true,
  confirmDeletes: true,
  sidebarCollapsed: false,
  rightPanelWidth: 360,
  listPanelWidth: 300,
};

interface AppState {
  campaignId: string | null;
  setCampaignId: (id: string | null) => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  recent: { id: string; name: string; kind: string }[];
  pushRecent: (entry: { id: string; name: string; kind: string }) => void;
}

/** UI state that should survive restarts. Persisted via localStorage (origin-bound in the webview). */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      campaignId: null,
      setCampaignId: (campaignId) => set({ campaignId, selectedTokenId: null, activeSessionId: null }),
      settings: DEFAULT_SETTINGS,
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      activeSessionId: null,
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      selectedTokenId: null,
      setSelectedTokenId: (selectedTokenId) => set({ selectedTokenId }),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      recent: [],
      pushRecent: (entry) =>
        set((s) => ({ recent: [entry, ...s.recent.filter((r) => r.id !== entry.id)].slice(0, 12) })),
    }),
    {
      name: "dm-workbench-ui",
      partialize: (s) => ({ campaignId: s.campaignId, settings: s.settings, recent: s.recent, activeSessionId: s.activeSessionId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    },
  ),
);
