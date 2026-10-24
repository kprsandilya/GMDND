import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Download, ExternalLink, Eye, EyeOff, FolderOpen, Link2, Link2Off, Map as MapIcon, Pencil, Plus, RefreshCw, Route, Save, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { MAP_FILTER, platform } from "@/app/platform";
import { qk, useAction, useCampaignId, useEntities } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { EntityPicker } from "@/components/EntityPicker";
import { MarkdownView } from "@/components/Markdown";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, Spinner, Textarea, Tooltip } from "@/components/ui";
import type { EnrichedSegment, RouteFilters } from "@/domain/journeyTypes";
import { GEOGRAPHIC_KINDS, type Entity, type EntityKind, type MapAnnotation, type MapFeatureLink, type WorldMap } from "@/domain/types";
import { cn, errorMessage } from "@/lib/utils";
import { DEMO_MAP_SEED } from "@/seed/demoCampaign";
import { asMapFileText, fmgSrc, forgetMapText, looksLikeMapFile, recalledMapText, rememberMapText } from "./atlasCache";
import { dismissUpdateDialog, exportMapData, featureAt, iframeClientToMap, installExternalLinkHook, installMapLinkFetch, isReady, listFeatures, loadMapData, renderOverlay, waitForMap, waitForServices, zoomScaleFor, zoomTo, type FmgFeature, type FmgWindow } from "./fmgBridge";
import { JourneyFilterToolbar } from "./JourneyFilterToolbar";
import { clearRouteOverlay, renderRouteOverlay, RouteLegend } from "./RouteOverlay";
import { JourneyPlayback, usePlaybackStore } from "./JourneyPlayback";
import { RouteComparison } from "./RouteComparison";
import { SegmentDetailPanel } from "./SegmentDetailPanel";

const ANNOTATION_COLORS: Record<MapAnnotation["kind"], string> = { poi: "#d9a441", note: "#8fb3c9", secret: "#b58cf0", quest: "#e0893f", encounter: "#c4524a", danger: "#ff5a5a" };
const LINK_COLOR = "#f0c674";

export function AtlasPage({ active = true }: { active?: boolean }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const routeMapId = pathname.match(/^\/atlas\/([^/]+)/)?.[1];
  const [mapId, setMapId] = useState(routeMapId);
  useEffect(() => {
    if (routeMapId) setMapId(routeMapId);
  }, [routeMapId]);
  const listWidth = useAppStore((s) => s.settings.listPanelWidth);
  const maps = useQuery({ queryKey: qk.worldMaps(campaignId), queryFn: () => repos.worldMaps.list(campaignId!), enabled: !!campaignId });
  const [creating, setCreating] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    if (!mapId && maps.data?.length) navigate(`/atlas/${maps.data[0]!.id}`, { replace: true });
  }, [active, mapId, maps.data, navigate]);

  useEffect(() => {
    if (mapId) setOpenIds((ids) => (ids.includes(mapId) ? ids : [...ids, mapId]));
  }, [mapId]);

  if (!campaignId) return <EmptyState title="No campaign selected" />;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex shrink-0 flex-col border-r border-border bg-bg-panel" style={{ width: listWidth }}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div>
            <h1 className="text-sm font-semibold">World Atlas</h1>
            <p className="text-[11px] text-ink-faint">Azgaar's Fantasy Map Generator, embedded</p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus size={13} /> New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {maps.data?.length === 0 && <EmptyState title="No maps yet" body="Create a map from a seed, or import an existing .map file." />}
          {maps.data?.map((m) => (
            <button key={m.id} className={cn("row-hover mb-1 flex w-full flex-col rounded px-2 py-1.5 text-left", mapId === m.id && "row-active")} onClick={() => navigate(`/atlas/${m.id}`)}>
              <span className="flex items-center gap-2 text-sm">
                <MapIcon size={13} className="text-ink-faint" /> {m.name}
              </span>
              <span className="text-[11px] text-ink-faint">{m.map_asset ? "Saved map" : m.seed ? `Seed ${m.seed}` : "Random"}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {openIds.map((id) => (
          <div key={id} className={cn("min-h-0 flex-1 flex-col", id === mapId ? "flex" : "hidden")}>
            <MapView mapId={id} active={id === mapId} onDeleted={() => setOpenIds((ids) => ids.filter((x) => x !== id))} />
          </div>
        ))}
        {!mapId && <EmptyState title="Select or create a world map" />}
      </div>
      <CreateMapDialog open={creating} onOpenChange={setCreating} campaignId={campaignId} onCreated={(id) => navigate(`/atlas/${id}`)} />
    </div>
  );
}

function CreateMapDialog({ open, onOpenChange, campaignId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; campaignId: string; onCreated: (id: string) => void }) {
  const repos = useRepos();
  const [name, setName] = useState("New world map");
  const [seed, setSeed] = useState("");
  const [worldId, setWorldId] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const create = useAction(
    async () => {
      let mapAsset: string | null = null;
      if (importPath) {
        const text = await platform.readTextFile(importPath);
        const asset = await platform.writeTextAsset("maps", "map", text);
        mapAsset = asset.rel_path;
      }
      return repos.worldMaps.create({ campaign_id: campaignId, world_id: worldId, name: name.trim() || "World map", seed: importPath ? null : seed.trim() || String(Math.floor(Math.random() * 1e9)), map_asset: mapAsset });
    },
    { success: "Map created", invalidate: [["maps"]], onSuccess: (m) => { onOpenChange(false); onCreated(m.id); } },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New world map"
      description="Generate from a seed (reproducible) or import a .map file saved from Azgaar's generator."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="World (optional)"><EntityPicker kinds={["world"]} value={worldId} onChange={(id) => setWorldId(id)} allowNone placeholder="No world record" /></Field>
        {!importPath && (
          <Field label="Seed" hint="Leave blank for a random seed. Any seed is reproducible across machines with the same generator version.">
            <div className="flex gap-2">
              <Input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. 734215890" />
              <Button variant="outline" onClick={() => setSeed(DEMO_MAP_SEED)}>Demo seed</Button>
            </div>
          </Field>
        )}
        <Field label="Or import a .map file">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={async () => setImportPath(await platform.pickFile({ title: "Import Azgaar map", filters: MAP_FILTER }))}>
              <FolderOpen size={13} /> Choose file
            </Button>
            {importPath && (
              <span className="flex items-center gap-1 truncate text-xs text-ink-muted">
                {importPath}
                <button className="text-ink-faint hover:text-ink" onClick={() => setImportPath(null)}><X size={12} /></button>
              </span>
            )}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

type PickMode = null | "link" | "annotation";

function MapView({ mapId, active, onDeleted }: { mapId: string; active: boolean; onDeleted: () => void }) {
  const repos = useRepos();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const campaignId = useCampaignId();
  const panelWidth = useAppStore((s) => s.settings.rightPanelWidth);
  const map = useQuery({ queryKey: qk.worldMap(mapId), queryFn: () => repos.worldMaps.get(mapId) });
  const links = useQuery({ queryKey: [...qk.worldMap(mapId), "links"], queryFn: () => repos.worldMaps.featureLinks(mapId) });
  const annotations = useQuery({ queryKey: [...qk.worldMap(mapId), "annotations"], queryFn: () => repos.worldMaps.annotations(mapId) });
  const places = useEntities({ kinds: [...GEOGRAPHIC_KINDS] });
  // ── Entity lists for journey filter toolbar ──
  const characters = useEntities({ kinds: ["pc", "npc"] });
  const parties = useEntities({ kinds: ["party"] });
  const sessions = useEntities({ kinds: ["session"] });
  // ── Journey overlay state (Req 9.1, 9.10, 18.3) ──
  const [journeyOverlayActive, setJourneyOverlayActive] = useState(false);
  const [routeFilters, setRouteFilters] = useState<RouteFilters>({});
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedLocationName, setSelectedLocationName] = useState<string | null>(null);
  const [playbackVisibleSegs, setPlaybackVisibleSegs] = useState<EnrichedSegment[]>([]);
  const playbackActive = usePlaybackStore((s) => s.active);
  // ── Enriched segments for journey overlay ──
  const journeySegments = useQuery({
    queryKey: [...qk.worldMap(mapId), "journeySegments", routeFilters],
    queryFn: () => repos.journeys.enrichedSegmentsForMap(campaignId!, mapId, routeFilters),
    enabled: !!campaignId && journeyOverlayActive,
  });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [win, setWin] = useState<FmgWindow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusText, setStatusText] = useState("Starting the map generator…");
  const [features, setFeatures] = useState<FmgFeature[]>([]);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [picked, setPicked] = useState<FmgFeature | null>(null);
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [tab, setTab] = useState<"links" | "annotations" | "features" | "map">("links");
  const [dirty, setDirty] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<MapAnnotation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadedAssetRef = useRef<string | null>(null);
  const pendingMapTextRef = useRef<string | null>(null);
  const pickDownRef = useRef<{ x: number; y: number } | null>(null);
  const pickModeRef = useRef<PickMode>(null);
  pickModeRef.current = pickMode;
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [frameEpoch, setFrameEpoch] = useState(0);

  const invalidateMap = () => qc.invalidateQueries({ queryKey: qk.worldMap(mapId) });

  useEffect(() => {
    if (!map.data) return;
    let cancelled = false;
    (async () => {
      if (map.data!.map_asset) {
        setStatus("loading");
        setStatusText("Restoring saved world…");
        const cached = recalledMapText(map.data!.map_asset);
        const raw = cached ?? (await platform.readTextAsset(map.data!.map_asset));
        if (cancelled) return;
        const text = asMapFileText(raw);
        if (looksLikeMapFile(text)) {
          rememberMapText(map.data!.map_asset, text);
          pendingMapTextRef.current = text;
          setFrameSrc(fmgSrc({ mapId, saved: true }));
          return;
        }
        forgetMapText(map.data!.map_asset);
      }
      pendingMapTextRef.current = null;
      setStatus("loading");
      setStatusText("Generating world from seed…");
      setFrameSrc(fmgSrc({ seed: map.data!.seed }));
    })().catch((error) => {
      if (!cancelled) {
        setStatus("error");
        setStatusText(errorMessage(error));
      }
    });
    return () => {
      cancelled = true;
    };
    // map_asset is omitted: auto-cache writes it after first generate and must not remount the iframe.
  }, [map.data?.id, map.data?.seed, mapId, frameEpoch]);

  // Serve the .map through Azgaar's ?maplink= fetch before it can hit Vite and parse HTML as a save.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !frameSrc) return;
    const tick = () => {
      const w = frame.contentWindow as FmgWindow | null;
      const text = pendingMapTextRef.current;
      if (w && text) installMapLinkFetch(w, text);
    };
    tick();
    const id = window.setInterval(tick, 16);
    frame.addEventListener("load", tick);
    return () => {
      window.clearInterval(id);
      frame.removeEventListener("load", tick);
    };
  }, [frameSrc, frameEpoch]);

  // Boot: ?maplink= skips throwaway generation; the fetch hook above returns the campaign file.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !frameSrc || !map.data) return;
    let cancelled = false;
    setStatus("loading");
    waitForServices(frame)
      .then(async (w) => {
        if (cancelled) return;
        const savedText = pendingMapTextRef.current;
        if (savedText) {
          installMapLinkFetch(w, savedText);
          setStatusText("Loading saved map…");
          loadedAssetRef.current = map.data!.map_asset;
          window.setTimeout(() => {
            if (!cancelled && !isReady(w)) void loadMapData(w, savedText);
          }, 2500);
        }
        await waitForMap(frame);
        if (cancelled) return;
        dismissUpdateDialog(w);
        installExternalLinkHook(w, (url) => {
          void platform.openExternal(url).catch((error) => toast.error(errorMessage(error)));
        });
        setWin(w);
        setFeatures(listFeatures(w));
        setStatus("ready");
        setStatusText("");
        const seed = w.options?.map?.seed ?? w.seed ?? null;
        const size = w.options?.map?.graph;
        const patch: Partial<WorldMap> = {};
        if (seed && seed !== map.data!.seed && !map.data!.map_asset) patch.seed = seed;
        if (w.VERSION && w.VERSION !== map.data!.fmg_version) patch.fmg_version = w.VERSION;
        if (size && (size.width !== map.data!.width || size.height !== map.data!.height)) {
          patch.width = size.width;
          patch.height = size.height;
        }
        if (!map.data!.map_asset) {
          setStatusText("Caching world for next time…");
          const text = asMapFileText(await exportMapData(w));
          if (cancelled) return;
          if (looksLikeMapFile(text)) {
            const asset = await platform.writeTextAsset("maps", "map", text);
            rememberMapText(asset.rel_path, text);
            if (campaignId) await repos.assets.register({ campaign_id: campaignId, rel_path: asset.rel_path, kind: "map", file_name: asset.file_name, size: asset.size }).catch(() => undefined);
            patch.map_asset = asset.rel_path;
            patch.map_created = Date.now();
            loadedAssetRef.current = asset.rel_path;
            setDirty(false);
          }
        }
        if (Object.keys(patch).length) await repos.worldMaps.update(mapId, patch).then(invalidateMap);
        if (!cancelled) setStatusText("");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setStatusText(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSrc, frameEpoch]);

  useEffect(() => {
    if (!active || !win) return;
    win.dispatchEvent(new Event("resize"));
  }, [active, win]);

  // Track regenerations inside the generator.
  useEffect(() => {
    if (!win) return;
    const onGenerated = () => {
      setFeatures(listFeatures(win));
      setDirty(true);
    };
    win.addEventListener("map:generated", onGenerated);
    return () => win.removeEventListener("map:generated", onGenerated);
  }, [win]);

  // Overlay of linked features + annotations.
  useEffect(() => {
    if (!win || status !== "ready") return;
    const points = [
      ...(links.data ?? []).filter((l) => l.x !== null && l.y !== null).map((l) => {
        const name = places.data?.find((e) => e.id === l.entity_id)?.name;
        return { id: l.id, x: l.x!, y: l.y!, label: name ? `${name} · ${l.feature_name ?? l.feature_type}` : (l.feature_name ?? ""), color: LINK_COLOR };
      }),
      ...(annotations.data ?? []).filter((a) => !a.hidden).map((a) => ({ id: a.id, x: a.x, y: a.y, label: a.title, color: a.color ?? ANNOTATION_COLORS[a.kind] })),
      ...(picked ? [{ id: "picked", x: picked.x, y: picked.y, label: picked.name, color: "#ff7a2f" }] : []),
    ];

    /** After rendering the standard overlay, add clickable hit circles on location markers
     *  so the DM can click a location to see its visit history (Req 21.3). */
    const addLocationClickTargets = () => {
      if (!journeyOverlayActive) return;
      const doc = win.document;
      const g = doc.getElementById("dm-workbench-overlay") as SVGGElement | null;
      if (!g) return;
      const ns = "http://www.w3.org/2000/svg";
      for (const link of (links.data ?? [])) {
        if (link.x == null || link.y == null) continue;
        const hit = doc.createElementNS(ns, "circle");
        hit.setAttribute("cx", String(link.x));
        hit.setAttribute("cy", String(link.y));
        hit.setAttribute("r", "8");
        hit.setAttribute("fill", "transparent");
        hit.setAttribute("pointer-events", "all");
        hit.setAttribute("cursor", "pointer");
        hit.setAttribute("data-loc-target", link.entity_id);
        const entityId = link.entity_id;
        const entityName = places.data?.find((e) => e.id === entityId)?.name ?? link.feature_name ?? "Location";
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelectedLocationId((prev) => (prev === entityId ? null : entityId));
          setSelectedLocationName(entityName);
          setSelectedSegmentId(null);
        });
        g.appendChild(hit);
      }
    };

    renderOverlay(win, points, activeLinkId);
    addLocationClickTargets();
    const id = setInterval(() => { renderOverlay(win, points, activeLinkId); addLocationClickTargets(); }, 4000); // survives generator redraws
    return () => clearInterval(id);
  }, [win, status, links.data, annotations.data, activeLinkId, picked, places.data, journeyOverlayActive]);

  // ── Journey route overlay rendering (Req 9.1, 9.6, 9.10) ──
  const routeResultRef = useRef<{ unmappedSegments: EnrichedSegment[]; partialSegments: EnrichedSegment[] }>({ unmappedSegments: [], partialSegments: [] });
  const selectedSegment = useMemo(
    () => (journeySegments.data ?? []).find((s) => s.id === selectedSegmentId) ?? null,
    [journeySegments.data, selectedSegmentId],
  );

  const handlePlaybackVisibleChange = useCallback((visible: EnrichedSegment[], _current: EnrichedSegment | null) => {
    setPlaybackVisibleSegs(visible);
  }, []);

  const characterNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of characters.data ?? []) {
      map[c.id] = c.name;
    }
    return map;
  }, [characters.data]);

  // When playback is active, render only the visible subset; otherwise all segments
  const effectiveSegments = useMemo(() => {
    if (!journeyOverlayActive || !journeySegments.data) return [];
    if (playbackActive) return playbackVisibleSegs;
    return journeySegments.data;
  }, [journeyOverlayActive, journeySegments.data, playbackActive, playbackVisibleSegs]);

  useEffect(() => {
    if (!win || status !== "ready") return;
    const doc = win.document;
    const overlay = doc.getElementById("dm-workbench-overlay") as SVGGElement | null;
    if (!overlay) return;

    // Clear routes when overlay is inactive or no data
    if (!journeyOverlayActive || effectiveSegments.length === 0) {
      clearRouteOverlay(overlay);
      routeResultRef.current = { unmappedSegments: [], partialSegments: [] };
      return;
    }

    const onSegmentClick = (segmentId: string) => {
      setSelectedSegmentId((prev) => (prev === segmentId ? null : segmentId));
      setSelectedLocationId(null);
    };

    const result = renderRouteOverlay(overlay, effectiveSegments, onSegmentClick);
    routeResultRef.current = result;

    // Periodic re-render to survive generator redraws (same pattern as existing overlay)
    const intervalId = setInterval(() => {
      const g = doc.getElementById("dm-workbench-overlay") as SVGGElement | null;
      if (g) {
        renderRouteOverlay(g, effectiveSegments, onSegmentClick);
      }
    }, 4000);

    return () => {
      clearInterval(intervalId);
      // Clean up route elements if overlay gets deactivated
      const g = doc.getElementById("dm-workbench-overlay") as SVGGElement | null;
      if (g) clearRouteOverlay(g);
    };
  }, [win, status, journeyOverlayActive, effectiveSegments]);

  // /atlas/:mapId?entity=ID zooms to a linked feature. ?link=ID starts pick mode for that location.
  useEffect(() => {
    if (!active || status !== "ready" || !win) return;
    const entityId = params.get("entity");
    const linkId = params.get("link");
    if (linkId) {
      setPickMode("link");
      setTab("links");
      return;
    }
    if (!entityId || !links.data) return;
    const link = links.data.find((l) => l.entity_id === entityId);
    if (link && link.x !== null && link.y !== null) {
      zoomTo(win, link.x, link.y, zoomScaleFor(link.feature_type));
      setActiveLinkId(link.id);
    } else toast.info("That record is not placed on this map yet. Press Link feature and click a town.");
    params.delete("entity");
    setParams(params, { replace: true });
  }, [active, params, setParams, status, win, links.data]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickMode) {
        setPickMode(null);
        setPicked(null);
      } else {
        setActiveLinkId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, pickMode]);

  useEffect(() => {
    if (!activeLinkId) return;
    const id = window.setTimeout(() => setActiveLinkId(null), 4000);
    return () => window.clearTimeout(id);
  }, [activeLinkId]);

  const saveMap = useAction(
    async () => {
      if (!win) throw new Error("Map not ready");
      const text = asMapFileText(await exportMapData(win));
      const asset = await platform.writeTextAsset("maps", "map", text, map.data?.map_asset ?? null);
      rememberMapText(asset.rel_path, text);
      loadedAssetRef.current = asset.rel_path;
      await repos.worldMaps.update(mapId, { map_asset: asset.rel_path, seed: win.options?.map?.seed ?? map.data?.seed ?? null, fmg_version: win.VERSION ?? null, map_created: Date.now() });
      if (campaignId) await repos.assets.register({ campaign_id: campaignId, rel_path: asset.rel_path, kind: "map", file_name: asset.file_name, size: asset.size }).catch(() => undefined);
      setDirty(false);
      return asset;
    },
    { success: "Map saved to campaign", invalidate: [["maps"]] },
  );
  const exportFile = useAction(async () => {
    if (!win) throw new Error("Map not ready");
    const dest = await platform.pickSavePath({ title: "Export .map", defaultPath: `${map.data?.name ?? "map"}.map`, filters: MAP_FILTER });
    if (!dest) return null;
    await platform.writeTextFile(dest, await exportMapData(win));
    return dest;
  }, { success: (dest) => (dest ? `Exported to ${dest}` : null), invalidate: [] });
  const loadFile = useAction(async () => {
    if (!win) throw new Error("Map not ready");
    const src = await platform.pickFile({ title: "Load .map into this atlas", filters: MAP_FILTER });
    if (!src) return false;
    await loadMapData(win, await platform.readTextFile(src));
    setTimeout(() => setFeatures(listFeatures(win)), 2000);
    setDirty(true);
    return true;
  }, { success: (ok) => (ok ? "Map loaded — remember to save it to the campaign" : null), invalidate: [] });
  const rename = useAction((patch: Partial<WorldMap>) => repos.worldMaps.update(mapId, patch), { invalidate: [["maps"]] });
  const removeMap = useAction(
    async () => {
      if (map.data?.map_asset) await platform.deleteAsset(map.data.map_asset).catch(() => undefined);
      await repos.worldMaps.delete(mapId);
    },
    { success: "Map deleted", invalidate: [["maps"]], onSuccess: () => { if (map.data?.map_asset) forgetMapText(map.data.map_asset); onDeleted(); navigate("/atlas"); } },
  );
  const addLink = useAction(
    (input: { feature: FmgFeature; entityId: string }) =>
      repos.worldMaps.linkFeature({ map_id: mapId, feature_type: input.feature.type, feature_id: input.feature.id, feature_name: input.feature.name, x: input.feature.x, y: input.feature.y, entity_id: input.entityId }),
    {
      success: (link) => `Linked to ${link.feature_name ?? "feature"}`, invalidate: [qk.worldMap(mapId), ["entities"], ["maps"]], onSuccess: (link) => {
        setPicked(null);
        setPickMode(null);
        setTab("links");
        setActiveLinkId(link.id);
        if (link.x !== null && link.y !== null && win) zoomTo(win, link.x, link.y, zoomScaleFor(link.feature_type));
        if (params.get("link")) {
          params.delete("link");
          setParams(params, { replace: true });
        }
      }
    },
  );
  const removeLink = useAction((id: string) => repos.worldMaps.unlinkFeature(id), { invalidate: [qk.worldMap(mapId)] });
  const saveAnnotation = useAction(
    (a: MapAnnotation) => (a.id ? repos.worldMaps.updateAnnotation(a.id, a) : repos.worldMaps.addAnnotation({ ...a, map_id: mapId })),
    { success: "Annotation saved", invalidate: [qk.worldMap(mapId)], onSuccess: () => { setEditingAnnotation(null); setPicked(null); setPickMode(null); } },
  );
  const removeAnnotation = useAction((id: string) => repos.worldMaps.deleteAnnotation(id), { invalidate: [qk.worldMap(mapId)] });

  const clearSelection = useCallback(() => setActiveLinkId(null), []);

  const focus = useCallback((x: number | null, y: number | null, id: string | null, z = 8, label?: string) => {
    if (id && id === activeLinkId) {
      setActiveLinkId(null);
      return;
    }
    if (!win || x === null || y === null) return;
    zoomTo(win, x, y, z);
    setActiveLinkId(id);
    if (label) toast.message(label);
  }, [win, activeLinkId]);

  const applyPick = useCallback((pt: { x: number; y: number }) => {
    const mode = pickModeRef.current;
    if (!win || !mode) return;
    const feature = mode === "link" ? featureAt(win, pt.x, pt.y) ?? { type: "point" as const, id: 0, name: "Point on map", x: pt.x, y: pt.y } : { type: "point" as const, id: 0, name: "Annotation", x: pt.x, y: pt.y };
    setTab(mode === "link" ? "links" : "annotations");
    setPicked(feature);
    zoomTo(win, feature.x, feature.y, zoomScaleFor(feature.type), 700);
    toast.success(mode === "link" ? `Selected ${feature.type}: ${feature.name}` : "Annotation placed — fill it in on the right");
  }, [win]);

  // Pick inside the iframe so clientX/Y match Azgaar's getScreenCTM (host overlay coords miss).
  useEffect(() => {
    if (!win || !pickMode || status !== "ready") return;
    const mapEl = win.document.getElementById("map");
    const viewbox = win.document.getElementById("viewbox") as SVGGElement | null;
    if (!mapEl) return;
    viewbox?.style.setProperty("cursor", "crosshair");
    const onDown = (e: Event) => {
      const ev = e as MouseEvent;
      pickDownRef.current = { x: ev.clientX, y: ev.clientY };
    };
    const onClick = (e: Event) => {
      const ev = e as MouseEvent;
      const start = pickDownRef.current;
      pickDownRef.current = null;
      if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      const pt = iframeClientToMap(win, ev.clientX, ev.clientY);
      if (!pt) {
        toast.error("Could not read that map position. Try again after the generator finishes zooming.");
        return;
      }
      applyPick(pt);
    };
    mapEl.addEventListener("mousedown", onDown, true);
    mapEl.addEventListener("click", onClick, true);
    return () => {
      viewbox?.style.removeProperty("cursor");
      mapEl.removeEventListener("mousedown", onDown, true);
      mapEl.removeEventListener("click", onClick, true);
    };
  }, [win, pickMode, status, applyPick]);

  const entityById = useMemo(() => new Map((places.data ?? []).map((e) => [e.id, e])), [places.data]);
  const activeLink = (links.data ?? []).find((l) => l.id === activeLinkId) ?? null;

  if (!map.data) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-panel px-3 py-1.5">
          <Input value={map.data.name} onChange={(e) => qc.setQueryData(qk.worldMap(mapId), { ...map.data!, name: e.target.value })} onBlur={(e) => rename.mutate({ name: e.target.value })} className="h-7 w-56 text-sm font-semibold" />
          {map.data.seed && <Badge className="whitespace-nowrap">seed {map.data.seed}</Badge>}
          {map.data.map_asset ? <Badge tone="moss" className="whitespace-nowrap">saved{dirty ? " · unsaved changes" : ""}</Badge> : <Badge tone="gold" className="whitespace-nowrap">not saved</Badge>}
          <div className="flex-1" />
          <Tooltip content="Toggle journey route overlay on the map">
            <Button size="sm" variant={journeyOverlayActive ? "primary" : "outline"} onClick={() => { setJourneyOverlayActive((v) => !v); if (journeyOverlayActive) { setSelectedSegmentId(null); setSelectedLocationId(null); setRouteFilters({}); usePlaybackStore.getState().deactivate(); } }} disabled={status !== "ready"}>
              <Route size={13} /> Journey routes
            </Button>
          </Tooltip>
          <Tooltip content="Pick a feature on the map and link it to a location record">
            <Button size="sm" variant={pickMode === "link" ? "primary" : "outline"} onClick={() => { setPickMode(pickMode === "link" ? null : "link"); setPicked(null); }} disabled={status !== "ready"}>
              <Link2 size={13} /> Link feature
            </Button>
          </Tooltip>
          <Tooltip content="Click on the map to place a DM annotation">
            <Button size="sm" variant={pickMode === "annotation" ? "primary" : "outline"} onClick={() => { setPickMode(pickMode === "annotation" ? null : "annotation"); setPicked(null); }} disabled={status !== "ready"}>
              <Crosshair size={13} /> Annotate
            </Button>
          </Tooltip>
          <Tooltip content="Load a .map file from disk into the generator"><Button size="sm" variant="outline" onClick={() => loadFile.mutate()} disabled={status !== "ready"}><FolderOpen size={13} /> Load</Button></Tooltip>
          <Tooltip content="Export the current map as a .map file"><Button size="sm" variant="outline" onClick={() => exportFile.mutate()} disabled={status !== "ready"}><Download size={13} /> Export</Button></Tooltip>
          <Tooltip content="Writes the generator's current .map file into this campaign. Feature links are stored separately and do not need this button."><Button size="sm" variant="primary" onClick={() => saveMap.mutate()} disabled={status !== "ready" || saveMap.isPending}><Save size={13} /> Save to campaign</Button></Tooltip>
        </div>
        <div className="relative min-h-0 flex-1 bg-black">
          {frameSrc && <iframe key={frameEpoch} ref={frameRef} src={frameSrc} title="Fantasy Map Generator" className="h-full w-full border-0" />}
          {status !== "ready" && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
              <div className={cn("flex items-center gap-2 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg", status === "error" && "border-blood text-blood")}>
                {status === "loading" && <Spinner />} {statusText}
              </div>
            </div>
          )}
          {activeLink && !pickMode && (
            <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-3">
              <div className="flex max-w-lg items-start gap-3 rounded-md border-2 border-gold bg-bg-elevated/95 px-4 py-2 shadow-lg">
                <div className="min-w-0 text-left">
                  <div className="text-[11px] uppercase tracking-wide text-gold">Selected on map</div>
                  <div className="font-display text-lg text-ink">{entityById.get(activeLink.entity_id)?.name ?? "Unknown location"}</div>
                  <div className="text-xs text-ink-muted">{activeLink.feature_type} · {activeLink.feature_name}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">Esc, ✕, or click the same link again to deselect</div>
                </div>
                <button type="button" className="shrink-0 text-ink-muted hover:text-ink" title="Deselect (Esc)" onClick={clearSelection}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          {pickMode && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3">
              <div className="rounded-md border border-ember bg-bg-elevated/95 px-3 py-1.5 text-xs">{pickMode === "link" ? "Click a town, state, province or marker. The form opens on the right. Esc to cancel." : "Click anywhere on the map to place an annotation. Esc to cancel."}</div>
            </div>
          )}
          {/* ── Journey overlay: filter toolbar + legend (Req 9.1, 9.5, 11.1) ── */}
          {journeyOverlayActive && status === "ready" && (
            <>
              <div className="absolute inset-x-0 top-0 z-10 px-3 pt-2">
                <JourneyFilterToolbar
                  filters={routeFilters}
                  onFiltersChange={setRouteFilters}
                  characters={(characters.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
                  parties={(parties.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
                  sessions={(sessions.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
                  noResults={!!(journeySegments.data && journeySegments.data.length === 0)}
                />
              </div>
              <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-2 max-w-80">
                <JourneyPlayback
                  filteredSegments={journeySegments.data ?? []}
                  onVisibleChange={handlePlaybackVisibleChange}
                />
                <RouteLegend
                  segments={journeySegments.data ?? []}
                  unmappedCount={routeResultRef.current.unmappedSegments.length}
                />
              </div>
              <RouteComparison
                segments={journeySegments.data ?? []}
                selectedCharacterIds={routeFilters.characterIds ?? []}
                characterNames={characterNames}
                className="absolute right-3 bottom-3 z-10"
              />
            </>
          )}
        </div>
        {/* ── Segment detail / location visit history panel (Req 10.1, 21.3) ── */}
        {journeyOverlayActive && (selectedSegment || selectedLocationId) && (
          <SegmentDetailPanel
            segment={selectedSegment}
            locationId={selectedLocationId}
            locationName={selectedLocationName}
            onClose={() => { setSelectedSegmentId(null); setSelectedLocationId(null); }}
          />
        )}
      </div>
      <aside className="flex shrink-0 flex-col border-l border-border bg-bg-panel" style={{ width: panelWidth }}>
        <div className="flex border-b border-border text-xs">
          {(["links", "annotations", "features", "map"] as const).map((t) => (
            <button key={t} className={cn("flex-1 px-2 py-2 capitalize", tab === t ? "border-b-2 border-ember text-ink" : "text-ink-muted hover:text-ink")} onClick={() => setTab(t)}>
              {t === "links" ? `Links (${links.data?.length ?? 0})` : t === "annotations" ? `Notes (${annotations.data?.length ?? 0})` : t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {picked && pickMode === "link" && <LinkForm feature={picked} places={places.data ?? []} presetId={params.get("link")} onCancel={() => setPicked(null)} onSubmit={(entityId) => addLink.mutate({ feature: picked, entityId })} pending={addLink.isPending} />}
          {picked && pickMode === "annotation" && !editingAnnotation && (
            <AnnotationForm
              initial={{ id: "", map_id: mapId, x: picked.x, y: picked.y, kind: "poi", title: "", body_md: "", entity_id: null, color: null, hidden: false, created_at: "", updated_at: "" }}
              onCancel={() => setPicked(null)}
              onSubmit={(a) => saveAnnotation.mutate(a)}
              pending={saveAnnotation.isPending}
            />
          )}
          {editingAnnotation && <AnnotationForm initial={editingAnnotation} onCancel={() => setEditingAnnotation(null)} onSubmit={(a) => saveAnnotation.mutate(a)} pending={saveAnnotation.isPending} />}
          {tab === "links" && !picked && !editingAnnotation && (
            <LinksList links={links.data ?? []} entityById={entityById} activeId={activeLinkId} onFocus={(l) => focus(l.x, l.y, l.id, zoomScaleFor(l.feature_type), entityById.get(l.entity_id)?.name ?? l.feature_name ?? "Location")} onOpen={(e) => navigate(routeForEntity(e))} onRemove={(id) => removeLink.mutate(id)} onClear={clearSelection} />
          )}
          {tab === "annotations" && !picked && !editingAnnotation && (
            <AnnotationsList annotations={annotations.data ?? []} activeId={activeLinkId} onFocus={(a) => focus(a.x, a.y, a.id, 8)} onEdit={setEditingAnnotation} onToggleHidden={(a) => saveAnnotation.mutate({ ...a, hidden: !a.hidden })} onRemove={(id) => removeAnnotation.mutate(id)} />
          )}
          {tab === "features" && !picked && <FeaturesList features={features} links={links.data ?? []} onFocus={(f) => focus(f.x, f.y, null, zoomScaleFor(f.type))} onLink={(f) => { setPickMode("link"); setPicked(f); setTab("links"); }} />}
          {tab === "map" && !picked && (
            <div className="grid gap-3 text-sm">
              <Field label="World record">
                <EntityPicker kinds={["world"]} value={map.data.world_id} onChange={(id) => rename.mutate({ world_id: id })} allowNone placeholder="No world record" />
              </Field>
              <Field label="Notes">
                <Textarea rows={6} defaultValue={map.data.notes} onBlur={(e) => rename.mutate({ notes: e.target.value })} />
              </Field>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
                <dt>Generator</dt><dd>{map.data.fmg_version ?? "—"}</dd>
                <dt>Size</dt><dd>{map.data.width && map.data.height ? `${map.data.width} × ${map.data.height}` : "—"}</dd>
                <dt>Saved</dt><dd>{map.data.map_created ? new Date(map.data.map_created).toLocaleString() : "never"}</dd>
                <dt>Asset</dt><dd className="truncate">{map.data.map_asset ?? "—"}</dd>
              </dl>
              <p className="text-[11px] text-ink-faint">
                The atlas keeps this generator live when you switch tabs, so it will not regenerate. The first time a world is ready it is cached as a <code>.map</code> file; later visits load that file directly instead of generating a throwaway map first. <b>Save to campaign</b> writes any edits you made inside the generator. Feature links and annotations live in the database and are saved as soon as you create them.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { loadedAssetRef.current = null; pendingMapTextRef.current = null; setWin(null); setStatus("loading"); setStatusText("Reloading…"); setFrameSrc(null); setFrameEpoch((n) => n + 1); }}>
                  <RefreshCw size={13} /> Reload generator
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(true)}><Trash2 size={13} /> Delete map</Button>
              </div>
            </div>
          )}
        </div>
      </aside>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete this world map?" body="Feature links and annotations on this map are removed. Location records are kept." confirmLabel="Delete" danger onConfirm={() => removeMap.mutate()} />
    </div>
  );
}

function LinkForm({ feature, places, presetId, onCancel, onSubmit, pending }: { feature: FmgFeature; places: Entity[]; presetId?: string | null; onCancel: () => void; onSubmit: (entityId: string) => void; pending: boolean }) {
  const [entityId, setEntityId] = useState<string | null>(presetId ?? null);
  const [createNew, setCreateNew] = useState(false);
  const repos = useRepos();
  const campaignId = useCampaignId();
  const defaultKind: EntityKind = feature.type === "burg" ? "settlement" : feature.type === "state" ? "kingdom" : feature.type === "province" ? "region" : "location";
  const createAndLink = useAction(
    async () => {
      const e = await repos.entities.create({ campaign_id: campaignId!, kind: defaultKind, name: feature.name, summary: feature.detail ?? "" });
      return e.id;
    },
    { success: "Record created", onSuccess: (id) => onSubmit(id) },
  );
  const suggestion = places.find((p) => p.name.toLowerCase() === feature.name.toLowerCase());
  useEffect(() => {
    if (presetId) setEntityId(presetId);
    else if (suggestion) setEntityId(suggestion.id);
  }, [presetId, suggestion]);
  return (
    <div className="panel mb-3 grid gap-2">
      <div className="panel-title">Link feature</div>
      <div className="text-sm">
        <Badge>{feature.type}</Badge> <span className="font-medium">{feature.name}</span>
        {feature.detail && <span className="ml-1 text-xs text-ink-faint">{feature.detail}</span>}
      </div>
      {!createNew ? (
        <>
          <Field label="Location record" hint={suggestion ? "Matched an existing record by name." : undefined}>
            <EntityPicker kinds={[...GEOGRAPHIC_KINDS]} value={entityId} onChange={(id) => setEntityId(id)} placeholder="Choose a location…" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!entityId || pending} onClick={() => entityId && onSubmit(entityId)}>Link</Button>
            <Button size="sm" variant="outline" onClick={() => setCreateNew(true)}>Create new {defaultKind}</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={createAndLink.isPending} onClick={() => createAndLink.mutate()}>Create “{feature.name}” and link</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreateNew(false)}>Back</Button>
        </div>
      )}
    </div>
  );
}

function LinksList({ links, entityById, activeId, onFocus, onOpen, onRemove, onClear }: { links: MapFeatureLink[]; entityById: Map<string, Entity>; activeId: string | null; onFocus: (l: MapFeatureLink) => void; onOpen: (e: Entity) => void; onRemove: (id: string) => void; onClear: () => void }) {
  if (!links.length) return <EmptyState title="No linked features" body="Use “Link feature”, then click a town or state on the map to connect it to a location record." />;
  return (
    <div className="grid gap-2">
      {activeId && (
        <div className="flex items-center justify-between text-[11px] text-ink-faint">
          <span>Click the selected row again to deselect</span>
          <Button size="sm" variant="ghost" onClick={onClear}>Deselect</Button>
        </div>
      )}
      <ul className="grid gap-1">
        {links.map((l) => {
          const entity = entityById.get(l.entity_id);
          return (
            <li key={l.id} className={cn("row-hover flex items-center gap-2 rounded border px-2 py-1.5", activeId === l.id ? "border-gold bg-gold/10 ring-1 ring-gold" : "border-transparent")}>
              <button className="min-w-0 flex-1 text-left" onClick={() => onFocus(l)}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{entity?.name ?? <span className="text-ink-faint">(missing record)</span>}</span>
                  {activeId === l.id && <Badge tone="gold">selected</Badge>}
                </div>
                <div className="truncate text-[11px] text-ink-faint">{l.feature_type} · {l.feature_name}</div>
              </button>
              {entity && (
                <Tooltip content="Open location record">
                  <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(entity); }}>
                    <ExternalLink size={13} />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content="Unlink"><Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); onRemove(l.id); }}><Link2Off size={13} /></Button></Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AnnotationsList({ annotations, activeId, onFocus, onEdit, onToggleHidden, onRemove }: { annotations: MapAnnotation[]; activeId: string | null; onFocus: (a: MapAnnotation) => void; onEdit: (a: MapAnnotation) => void; onToggleHidden: (a: MapAnnotation) => void; onRemove: (id: string) => void }) {
  if (!annotations.length) return <EmptyState title="No annotations" body="Use “Annotate”, then click on the map to leave a DM note, secret, quest hook or danger marker." />;
  return (
    <ul className="grid gap-2">
      {annotations.map((a) => (
        <li key={a.id} className={cn("rounded border border-border p-2", activeId === a.id && "border-ember")}>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: a.color ?? ANNOTATION_COLORS[a.kind] }} />
            <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => onFocus(a)}>{a.title || "(untitled)"}</button>
            <Badge>{a.kind}</Badge>
            <Tooltip content={a.hidden ? "Hidden on overlay" : "Shown on overlay"}><Button size="icon" variant="ghost" onClick={() => onToggleHidden(a)}>{a.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</Button></Tooltip>
            <Button size="icon" variant="ghost" onClick={() => onEdit(a)}><Pencil size={13} /></Button>
            <Button size="icon" variant="ghost" onClick={() => onRemove(a.id)}><Trash2 size={13} /></Button>
          </div>
          {a.body_md && <MarkdownView source={a.body_md} className="mt-1 text-xs" />}
        </li>
      ))}
    </ul>
  );
}

function AnnotationForm({ initial, onCancel, onSubmit, pending }: { initial: MapAnnotation; onCancel: () => void; onSubmit: (a: MapAnnotation) => void; pending: boolean }) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="panel mb-3 grid gap-2">
      <div className="panel-title">{initial.id ? "Edit annotation" : "New annotation"}</div>
      <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Kind">
          <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MapAnnotation["kind"] })}>
            {Object.keys(ANNOTATION_COLORS).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="Colour"><Input type="color" value={draft.color ?? ANNOTATION_COLORS[draft.kind]} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></Field>
      </div>
      <Field label="Linked record (optional)"><EntityPicker kinds={[]} value={draft.entity_id} onChange={(id) => setDraft({ ...draft, entity_id: id })} allowNone placeholder="Any record" /></Field>
      <Field label="Body (Markdown, DM only)"><Textarea rows={4} value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} /></Field>
      <Checkbox label="Hidden on overlay" checked={draft.hidden} onChange={(v) => setDraft({ ...draft, hidden: v })} />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => onSubmit(draft)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function FeaturesList({ features, links, onFocus, onLink }: { features: FmgFeature[]; links: MapFeatureLink[]; onFocus: (f: FmgFeature) => void; onLink: (f: FmgFeature) => void }) {
  const [term, setTerm] = useState("");
  const [type, setType] = useState<"all" | FmgFeature["type"]>("all");
  const linked = useMemo(() => new Set(links.map((l) => `${l.feature_type}:${l.feature_id}`)), [links]);
  const list = features.filter((f) => (type === "all" || f.type === type) && (!term || f.name.toLowerCase().includes(term.toLowerCase()))).slice(0, 300);
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-2 text-ink-faint" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search features…" className="pl-7" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-28">
          <option value="all">All</option>
          {["burg", "state", "province", "marker", "river", "culture", "religion"].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>
      {!features.length && <p className="text-xs text-ink-faint">Features appear once the generator has finished.</p>}
      <ul className="grid gap-0.5">
        {list.map((f) => (
          <li key={`${f.type}:${f.id}`} className="row-hover flex items-center gap-2 rounded px-2 py-1">
            <button className="min-w-0 flex-1 text-left" onClick={() => onFocus(f)}>
              <span className="text-sm">{f.name}</span>
              <span className="ml-2 text-[11px] text-ink-faint">{f.type}{f.detail ? ` · ${f.detail}` : ""}</span>
            </button>
            {linked.has(`${f.type}:${f.id}`) ? <Badge tone="moss">linked</Badge> : <Button size="icon" variant="ghost" onClick={() => onLink(f)}><Link2 size={13} /></Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}