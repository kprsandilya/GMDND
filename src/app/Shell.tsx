import {
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Grid3x3,
  LayoutDashboard,
  Library,
  MapPin,
  Package,
  Play,
  ScrollText,
  Search,
  Settings,
  Skull,
  Swords,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { AtlasPage } from "@/features/atlas/AtlasPage";
import { Kbd, Tooltip } from "@/components/ui";
import { cn, modKey } from "@/lib/utils";
import { useAppStore } from "./appStore";
import { CommandPalette } from "./CommandPalette";
import { useCampaign } from "./queries";
import { NAV_ITEMS } from "./routes";

const ICONS: Record<string, LucideIcon> = { LayoutDashboard, BookOpen, Globe2, MapPin, Grid3x3, Swords, Users, UsersRound, Package, Skull, ScrollText, Library, CalendarClock, Play, Search, Settings };

export function Shell() {
  const collapsed = useAppStore((s) => s.settings.sidebarCollapsed);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setPalette = useAppStore((s) => s.setCommandPaletteOpen);
  const campaign = useCampaign();
  const navigate = useNavigate();
  const location = useLocation();
  const atlasActive = location.pathname === "/atlas" || location.pathname.startsWith("/atlas/");
  const [atlasMounted, setAtlasMounted] = useState(atlasActive);

  useEffect(() => {
    if (atlasActive) setAtlasMounted(true);
  }, [atlasActive]);

  // Global shortcuts: Ctrl+K palette, Ctrl+1..9 navigation, Ctrl+Shift+F search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        navigate("/search");
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const item = NAV_ITEMS.find((n) => n.shortcut === e.key);
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, setPalette]);

  return (
    <div className="flex h-full">
      <nav className={cn("flex shrink-0 flex-col border-r border-border bg-bg-elevated transition-[width]", collapsed ? "w-12" : "w-56")}>
        <div className={cn("flex h-11 items-center border-b border-border px-3", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-[15px] leading-none text-ember-soft">DM Workbench</div>
              <div className="mt-1 truncate text-[10px] uppercase tracking-wider text-ink-faint">{campaign.data?.name ?? "No campaign"}</div>
            </div>
          )}
          <button className="rounded p-1 text-ink-faint hover:bg-bg-hover hover:text-ink" onClick={() => updateSettings({ sidebarCollapsed: !collapsed })} aria-label="Toggle sidebar">
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.icon]!;
            const link = (
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "mx-1.5 my-px flex items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] text-ink-muted hover:bg-bg-hover hover:text-ink",
                    isActive && "bg-bg-active text-ember-soft",
                    collapsed && "justify-center px-0",
                  )
                }
              >
                <Icon size={15} className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && item.shortcut && <Kbd>{modKey}{item.shortcut}</Kbd>}
              </NavLink>
            );
            return (
              <li key={item.to}>
                {collapsed ? (
                  <Tooltip content={item.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
        <button
          className={cn("m-1.5 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] text-ink-faint hover:bg-bg-hover hover:text-ink", collapsed && "justify-center")}
          onClick={() => setPalette(true)}
        >
          <Search size={13} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Command palette</span>
              <Kbd>{modKey}K</Kbd>
            </>
          )}
        </button>
      </nav>
      <main className="relative flex min-w-0 flex-1 flex-col bg-bg">
        {atlasMounted && (
          <div
            className={cn("min-h-0 flex-col", atlasActive ? "flex flex-1" : "pointer-events-none invisible absolute inset-0 flex")}
            aria-hidden={!atlasActive}
          >
            <AtlasPage key={campaign.data?.id ?? "none"} active={atlasActive} />
          </div>
        )}
        <div className={cn("min-h-0 flex-1 flex-col", atlasActive ? "hidden" : "flex")}>
          <Outlet />
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
