/**
 * Host-side bridge to the bundled Azgaar Fantasy Map Generator running in a same-origin iframe.
 * Upstream is not modified: we only read its documented globals (`pack`, `zoomTo`, `Services`)
 * and add an SVG overlay group for linked-feature highlights.
 */
import type { FeatureType } from "@/domain/types";

export interface FmgFeature {
  type: FeatureType;
  id: number;
  name: string;
  x: number;
  y: number;
  detail?: string;
}

interface FmgBurg {
  i: number;
  name?: string;
  x: number;
  y: number;
  state?: number;
  population?: number;
  capital?: number;
  removed?: boolean;
  port?: number;
}
interface FmgState {
  i: number;
  name: string;
  fullName?: string;
  center: number;
  pole?: [number, number];
  removed?: boolean;
  burgs?: number;
}
interface FmgProvince {
  i: number;
  name: string;
  fullName?: string;
  center: number;
  pole?: [number, number];
  removed?: boolean;
  state?: number;
}
interface FmgMarker {
  i: number;
  type: string;
  icon: string;
  x: number;
  y: number;
  cell?: number;
}
interface FmgRiver {
  i: number;
  name: string;
  type?: string;
  cells?: number[];
  source?: number;
}
interface FmgCulture {
  i: number;
  name: string;
  center: number;
  removed?: boolean;
}
interface FmgReligion {
  i: number;
  name: string;
  center: number;
  removed?: boolean;
}

interface FmgPack {
  cells: { p: [number, number][]; state: ArrayLike<number>; province: ArrayLike<number>; q?: { find: (x: number, y: number) => [number, number, number] | undefined } };
  burgs: FmgBurg[];
  states: FmgState[];
  provinces: FmgProvince[];
  markers: FmgMarker[];
  rivers: FmgRiver[];
  cultures: FmgCulture[];
  religions: FmgReligion[];
}

export interface FmgWindow extends Window {
  pack?: FmgPack;
  zoomTo?: (x: number, y: number, z?: number, duration?: number) => void;
  Services?: {
    Save: { prepareMapData: (viewOnly?: boolean) => Promise<string> };
    Load: { uploadMap: (file: Blob, callback?: () => void) => Promise<void> };
  };
  VERSION?: string;
  options?: { map?: { seed?: string; graph?: { width: number; height: number } } };
  mapId?: number;
  seed?: string;
}

export function fmgWindow(frame: HTMLIFrameElement | null): FmgWindow | null {
  try {
    return (frame?.contentWindow as FmgWindow | null) ?? null;
  } catch {
    return null;
  }
}

export function isReady(win: FmgWindow | null): boolean {
  return !!win?.pack?.cells?.p?.length && !!win.pack.burgs;
}

/** Waits until the generator has a map in memory. */
export function waitForMap(frame: HTMLIFrameElement, timeoutMs = 120_000): Promise<FmgWindow> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const win = fmgWindow(frame);
      if (isReady(win)) return resolve(win!);
      if (Date.now() - started > timeoutMs) return reject(new Error("The map generator did not finish loading."));
      setTimeout(tick, 400);
    };
    tick();
  });
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

export function listFeatures(win: FmgWindow): FmgFeature[] {
  const pack = win.pack;
  if (!pack) return [];
  const p = pack.cells.p;
  const features: FmgFeature[] = [];
  for (const b of pack.burgs) if (b && b.i && !b.removed) features.push({ type: "burg", id: b.i, name: b.name ?? `Burg ${b.i}`, x: b.x, y: b.y, detail: `${b.capital ? "capital" : b.port ? "port" : "town"}${b.population ? ` · pop. ${Math.round(b.population * 1000).toLocaleString()}` : ""}` });
  for (const s of pack.states) if (s && s.i && !s.removed) features.push({ type: "state", id: s.i, name: s.fullName ?? s.name, x: s.pole?.[0] ?? p[s.center]?.[0] ?? 0, y: s.pole?.[1] ?? p[s.center]?.[1] ?? 0, detail: `${s.burgs ?? 0} burgs` });
  for (const pr of pack.provinces ?? []) if (pr && pr.i && !pr.removed) features.push({ type: "province", id: pr.i, name: pr.fullName ?? pr.name, x: pr.pole?.[0] ?? p[pr.center]?.[0] ?? 0, y: pr.pole?.[1] ?? p[pr.center]?.[1] ?? 0 });
  for (const m of pack.markers ?? []) features.push({ type: "marker", id: m.i, name: `${m.icon} ${m.type}`, x: m.x, y: m.y });
  for (const r of pack.rivers ?? []) if (r && r.i) features.push({ type: "river", id: r.i, name: `${r.name}${r.type ? ` ${r.type}` : ""}`, x: p[r.source ?? r.cells?.[0] ?? 0]?.[0] ?? 0, y: p[r.source ?? r.cells?.[0] ?? 0]?.[1] ?? 0 });
  for (const c of pack.cultures ?? []) if (c && c.i && !c.removed) features.push({ type: "culture", id: c.i, name: c.name, x: p[c.center]?.[0] ?? 0, y: p[c.center]?.[1] ?? 0 });
  for (const r of pack.religions ?? []) if (r && r.i && !r.removed) features.push({ type: "religion", id: r.i, name: r.name, x: p[r.center]?.[0] ?? 0, y: p[r.center]?.[1] ?? 0 });
  return features;
}

function invertCtm(svg: SVGSVGElement, ctm: DOMMatrix, x: number, y: number): { x: number; y: number } | null {
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  try {
    const mapped = pt.matrixTransform(ctm.inverse());
    if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return null;
    return { x: mapped.x, y: mapped.y };
  } catch {
    return null;
  }
}

function nearestLandmarkDist2(win: FmgWindow, x: number, y: number): number {
  const pack = win.pack;
  if (!pack) return Infinity;
  let best = Infinity;
  for (const b of pack.burgs ?? []) {
    if (!b || !b.i || b.removed) continue;
    best = Math.min(best, dist2(b.x, b.y, x, y));
  }
  for (const m of pack.markers ?? []) best = Math.min(best, dist2(m.x, m.y, x, y));
  return best;
}

/**
 * Converts a pointer event that originated inside the generator iframe.
 * Same path Azgaar uses: invert `#viewbox` getScreenCTM against iframe-local client coords.
 */
export function iframeClientToMap(win: FmgWindow, clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = win.document.getElementById("map") as SVGSVGElement | null;
  const viewbox = win.document.getElementById("viewbox") as SVGGElement | null;
  const screen = viewbox?.getScreenCTM();
  if (!svg || !screen) return null;
  return invertCtm(svg, screen, clientX, clientY);
}

/**
 * Converts a click in the host window to generator map coordinates.
 * WebView2 is inconsistent about whether getScreenCTM is iframe-local or parent-space, so we
 * score every plausible mapping and keep the one closest to a real burg or marker.
 */
export function hostClientToMap(win: FmgWindow, hostX: number, hostY: number, iframeRect?: DOMRect | null): { x: number; y: number } | null {
  const doc = win.document;
  const svg = doc.getElementById("map") as SVGSVGElement | null;
  const viewbox = doc.getElementById("viewbox") as SVGGElement | null;
  if (!svg || !viewbox) return null;
  const frame = iframeRect ?? (() => {
    try {
      return (win.frameElement as HTMLElement | null)?.getBoundingClientRect() ?? null;
    } catch {
      return null;
    }
  })();
  const svgBox = svg.getBoundingClientRect();
  const graph = win.options?.map?.graph;
  const inBounds = (p: { x: number; y: number }) =>
    !graph || (p.x >= -80 && p.y >= -80 && p.x <= graph.width + 80 && p.y <= graph.height + 80);
  const screen = viewbox.getScreenCTM();
  const local = viewbox.getCTM();
  const candidates = [
    screen && frame ? invertCtm(svg, screen, hostX - frame.left, hostY - frame.top) : null,
    screen ? invertCtm(svg, screen, hostX, hostY) : null,
    local ? invertCtm(svg, local, hostX - svgBox.left, hostY - svgBox.top) : null,
    local && frame ? invertCtm(svg, local, hostX - frame.left - svgBox.left, hostY - frame.top - svgBox.top) : null,
  ].filter((p): p is { x: number; y: number } => !!p && inBounds(p));
  if (!candidates.length) return null;
  return candidates.reduce((best, p) => (nearestLandmarkDist2(win, p.x, p.y) < nearestLandmarkDist2(win, best.x, best.y) ? p : best));
}

export function zoomScaleFor(type: FmgFeature["type"]): number {
  switch (type) {
    case "burg":
    case "marker":
      return 20;
    case "point":
      return 16;
    case "province":
    case "river":
      return 8;
    case "culture":
    case "religion":
      return 5;
    case "state":
      return 3;
    default:
      return 8;
  }
}

const OPEN_HOOK = "__dmWorkbenchOpenHook";

function hrefOf(url: unknown): string {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.toString();
  return "";
}

function burgPreviewLink(win: FmgWindow): string | null {
  const frame = win.document.querySelector("#burgPreviewObject iframe") as HTMLIFrameElement | null;
  const src = frame?.getAttribute("src") || frame?.src || "";
  if (!src || src === "about:blank") return null;
  try {
    const url = new URL(src);
    url.searchParams.delete("preview");
    return url.toString();
  } catch {
    return /^https?:\/\//i.test(src) ? src : null;
  }
}

/** Route the generator's window.open / openURL / "new tab" control into the host (Tauri blocks popups). */
export function installExternalLinkHook(win: FmgWindow, open: (url: string) => void): void {
  const flagged = win as unknown as Record<string, unknown>;
  if (flagged[OPEN_HOOK]) return;
  flagged[OPEN_HOOK] = true;

  const go = (url: unknown) => {
    const href = hrefOf(url);
    if (href && /^https?:\/\//i.test(href)) open(href);
  };
  const hijackOpen = ((url?: string | URL) => {
    if (url) go(url);
    return null;
  }) as typeof win.open;

  for (const [key, value] of [
    ["open", hijackOpen],
    ["openURL", (url: string) => go(url)],
  ] as const) {
    try {
      Object.defineProperty(win, key, { configurable: true, writable: true, value });
    } catch {
      try {
        (win as unknown as Record<string, unknown>)[key] = value;
      } catch {
        /* WebView2 sometimes freezes window.open */
      }
    }
  }

  win.document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (target.closest("#burgLinkOpen")) {
        const link = burgPreviewLink(win);
        if (link) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          go(link);
        }
        return;
      }
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (anchor && (anchor.target === "_blank" || anchor.rel.includes("noopener")) && /^https?:\/\//i.test(anchor.href)) {
        event.preventDefault();
        event.stopPropagation();
        go(anchor.href);
      }
    },
    true,
  );
}

/** Finds the most specific feature near a map point: marker/burg within radius, else the province/state of the cell. */
export function featureAt(win: FmgWindow, x: number, y: number, radius = 28): FmgFeature | null {
  const pack = win.pack;
  if (!pack) return null;
  const r2 = radius * radius;
  let best: FmgFeature | null = null;
  let bestD = Infinity;
  for (const b of pack.burgs) {
    if (!b || !b.i || b.removed) continue;
    const d = dist2(b.x, b.y, x, y);
    if (d < r2 && d < bestD) {
      bestD = d;
      best = { type: "burg", id: b.i, name: b.name ?? `Burg ${b.i}`, x: b.x, y: b.y };
    }
  }
  for (const m of pack.markers ?? []) {
    const d = dist2(m.x, m.y, x, y);
    if (d < r2 && d < bestD) {
      bestD = d;
      best = { type: "marker", id: m.i, name: `${m.icon} ${m.type}`, x: m.x, y: m.y };
    }
  }
  if (best) return best;
  const found = pack.cells.q?.find(x, y);
  const cell = found ? found[2] : nearestCell(pack, x, y);
  if (cell === undefined) return null;
  const provinceId = pack.cells.province?.[cell] ?? 0;
  if (provinceId) {
    const pr = pack.provinces[provinceId];
    if (pr && !pr.removed) return { type: "province", id: pr.i, name: pr.fullName ?? pr.name, x, y };
  }
  const stateId = pack.cells.state[cell] ?? 0;
  if (stateId) {
    const s = pack.states[stateId];
    if (s && !s.removed) return { type: "state", id: s.i, name: s.fullName ?? s.name, x, y };
  }
  return { type: "point", id: cell, name: `Wilderness (cell ${cell})`, x, y };
}

function nearestCell(pack: FmgPack, x: number, y: number): number | undefined {
  let best: number | undefined;
  let bestD = Infinity;
  const p = pack.cells.p;
  for (let i = 0; i < p.length; i += 1) {
    const d = dist2(p[i]![0], p[i]![1], x, y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Closes the generator's one-time "updated to version X" dialog; it is noise inside the workbench. */
export function dismissUpdateDialog(win: FmgWindow): void {
  try {
    const jq = (win as unknown as { $?: (sel: string) => { dialog?: (cmd: string) => void; length: number } }).$;
    const alert = jq?.("#alert");
    if (alert?.length && alert.dialog) alert.dialog("close");
  } catch {
    /* dialog not open */
  }
}

export function zoomTo(win: FmgWindow, x: number, y: number, z = 8, duration = 1200): void {
  win.zoomTo?.(x, y, z, duration);
}

/** Draws host-owned highlight rings for linked features inside the map's viewbox. */
export function renderOverlay(win: FmgWindow, points: { x: number; y: number; label: string; color: string; id: string }[], activeId: string | null): void {
  const doc = win.document;
  const viewbox = doc.getElementById("viewbox");
  if (!viewbox) return;
  let g = doc.getElementById("dm-workbench-overlay") as SVGGElement | null;
  if (!g) {
    g = doc.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
    g.id = "dm-workbench-overlay";
    g.setAttribute("pointer-events", "none");
    viewbox.appendChild(g);
  }
  g.innerHTML = "";
  for (const pt of points) {
    const active = pt.id === activeId;
    const ns = "http://www.w3.org/2000/svg";
    if (active) {
      const pulse = doc.createElementNS(ns, "circle");
      pulse.setAttribute("cx", String(pt.x));
      pulse.setAttribute("cy", String(pt.y));
      pulse.setAttribute("r", "16");
      pulse.setAttribute("fill", pt.color);
      pulse.setAttribute("opacity", "0.35");
      const animR = doc.createElementNS(ns, "animate");
      animR.setAttribute("attributeName", "r");
      animR.setAttribute("values", "12;28;12");
      animR.setAttribute("dur", "1.4s");
      animR.setAttribute("repeatCount", "indefinite");
      pulse.appendChild(animR);
      const animO = doc.createElementNS(ns, "animate");
      animO.setAttribute("attributeName", "opacity");
      animO.setAttribute("values", "0.45;0.05;0.45");
      animO.setAttribute("dur", "1.4s");
      animO.setAttribute("repeatCount", "indefinite");
      pulse.appendChild(animO);
      g.appendChild(pulse);
    }
    const dot = doc.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(pt.x));
    dot.setAttribute("cy", String(pt.y));
    dot.setAttribute("r", active ? "5" : "3");
    dot.setAttribute("fill", pt.color);
    dot.setAttribute("stroke", "#111");
    dot.setAttribute("stroke-width", "0.6");
    g.appendChild(dot);
    const ring = doc.createElementNS(ns, "circle");
    ring.setAttribute("cx", String(pt.x));
    ring.setAttribute("cy", String(pt.y));
    ring.setAttribute("r", active ? "10" : "5");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", pt.color);
    ring.setAttribute("stroke-width", active ? "2.2" : "1");
    g.appendChild(ring);
    const label = doc.createElementNS(ns, "text");
    label.setAttribute("x", String(pt.x + 12));
    label.setAttribute("y", String(pt.y - 8));
    label.setAttribute("font-size", active ? "11" : "6");
    label.setAttribute("font-weight", active ? "700" : "500");
    label.setAttribute("fill", pt.color);
    label.setAttribute("stroke", "#000");
    label.setAttribute("stroke-width", active ? "0.45" : "0.2");
    label.setAttribute("paint-order", "stroke");
    label.textContent = pt.label;
    if (pt.label) g.appendChild(label);
  }
}

export async function exportMapData(win: FmgWindow): Promise<string> {
  if (!win.Services) throw new Error("Map generator services unavailable");
  return win.Services.Save.prepareMapData(false);
}

export async function loadMapData(win: FmgWindow, text: string): Promise<void> {
  if (!win.Services) throw new Error("Map generator services unavailable");
  await win.Services.Load.uploadMap(new Blob([text], { type: "text/plain" }));
}
