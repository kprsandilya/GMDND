/**
 * Route overlay for the world atlas: renders journey travel segments as SVG polylines
 * inside the Azgaar iframe's `dm-workbench-overlay` group, plus a React legend panel.
 *
 * Requirements: 9.1–9.11, 17.1–17.5
 */
import { MapPin } from "lucide-react";
import { useMemo } from "react";
import type { EnrichedSegment, JourneyCategory } from "@/domain/journeyTypes";
import { JOURNEY_CATEGORY_LABELS } from "@/domain/journeyTypes";
import { cn } from "@/lib/utils";

// ── Category → visual style mapping (design doc) ──

export const ROUTE_STYLES: Record<JourneyCategory, { color: string; dashArray: string }> = {
  campaign:   { color: "#22c55e", dashArray: "" },            // solid green
  party:      { color: "#3b82f6", dashArray: "" },            // solid blue
  backstory:  { color: "#a78bfa", dashArray: "12,6" },        // dashed purple
  individual: { color: "#f59e0b", dashArray: "" },            // solid amber
  npc:        { color: "#ec4899", dashArray: "" },             // solid pink
  flashback:  { color: "#8b5cf6", dashArray: "8,4,2,4" },     // dash-dot violet
  uncertain:  { color: "#6b7280", dashArray: "3,3" },          // dotted gray
};

// ── SVG namespace constant ──

const SVG_NS = "http://www.w3.org/2000/svg";

// ── Helpers ──

/** Attribute name used to tag our route elements so they can be cleared without touching other overlay content. */
const ROUTE_ATTR = "data-route";

/** Attribute storing the segment id on each hit-area polyline for click handling. */
const ROUTE_ID_ATTR = "data-route-id";

interface PolyPoint {
  x: number;
  y: number;
}

/**
 * Build the ordered points array for a segment: origin → waypoints → destination.
 * Skips null coords (unmapped points). Returns an object with the resolved points,
 * plus flags for whether origin/destination were missing.
 */
function resolveSegmentPoints(segment: EnrichedSegment): {
  points: PolyPoint[];
  originMissing: boolean;
  destinationMissing: boolean;
} {
  const points: PolyPoint[] = [];
  let originMissing = false;
  let destinationMissing = false;

  // Origin
  if (segment.origin_coords) {
    points.push(segment.origin_coords);
  } else if (segment.origin_entity_id) {
    originMissing = true;
  }

  // Waypoints — use waypoint coords; skip nulls (Req 17.2, 17.3, 17.4)
  for (const wp of segment.waypoint_coords) {
    if (wp) points.push(wp);
  }

  // Destination
  if (segment.destination_coords) {
    points.push(segment.destination_coords);
  } else if (segment.destination_entity_id) {
    destinationMissing = true;
  }

  return { points, originMissing, destinationMissing };
}

/** Convert a points array to the SVG `points` attribute string. */
function pointsAttr(pts: PolyPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

// ── Core rendering function ──

export interface RouteOverlayResult {
  /** Segments that had no mapped coordinates at all (both endpoints + all waypoints unmapped). */
  unmappedSegments: EnrichedSegment[];
  /** Segments that were partially unmapped (one endpoint missing). */
  partialSegments: EnrichedSegment[];
}

/**
 * Renders journey route polylines into the `dm-workbench-overlay` SVG group.
 * Creates two `<polyline>` elements per renderable segment:
 *  1. A transparent hit-area polyline (stroke-width 8, pointer-events stroke) for clicks.
 *  2. A visible styled polyline (stroke-width 2.5, pointer-events none) for display.
 *
 * All coordinates are in Azgaar map-space (from map_feature_links), so they remain
 * aligned during zoom/pan — the viewbox transform handles everything. (Req 9.6, 17.5)
 *
 * Returns lists of fully and partially unmapped segments for the legend panel.
 */
export function renderRouteOverlay(
  svgGroup: SVGGElement,
  segments: EnrichedSegment[],
  onSegmentClick: (segmentId: string) => void,
): RouteOverlayResult {
  const doc = svgGroup.ownerDocument;

  // Clear previous route elements (leave other overlay content like feature highlights intact)
  const existing = svgGroup.querySelectorAll(`[${ROUTE_ATTR}]`);
  for (const el of existing) el.remove();

  const unmappedSegments: EnrichedSegment[] = [];
  const partialSegments: EnrichedSegment[] = [];

  for (const seg of segments) {
    const { points, originMissing, destinationMissing } = resolveSegmentPoints(seg);
    const category = seg.journey.category;
    const style = ROUTE_STYLES[category] ?? ROUTE_STYLES.uncertain;

    // Req 9.9: both origin and destination unmapped with no usable waypoints → skip
    if (points.length < 1) {
      unmappedSegments.push(seg);
      continue;
    }

    // Track partially unmapped segments (Req 9.7, 9.8)
    if (originMissing || destinationMissing) {
      partialSegments.push(seg);
    }

    // Need at least 2 points to draw a line; with exactly 1 we place a marker
    if (points.length === 1) {
      // Single mapped point — draw a circle marker with an "unmapped" label (Req 9.7)
      const marker = doc.createElementNS(SVG_NS, "circle");
      marker.setAttribute("cx", String(points[0]!.x));
      marker.setAttribute("cy", String(points[0]!.y));
      marker.setAttribute("r", "4");
      marker.setAttribute("fill", style.color);
      marker.setAttribute("stroke", "#111");
      marker.setAttribute("stroke-width", "0.6");
      marker.setAttribute("pointer-events", "none");
      marker.setAttribute(ROUTE_ATTR, "");
      svgGroup.appendChild(marker);

      // "unmapped" label
      const label = doc.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(points[0]!.x + 8));
      label.setAttribute("y", String(points[0]!.y - 6));
      label.setAttribute("font-size", "6");
      label.setAttribute("fill", style.color);
      label.setAttribute("stroke", "#000");
      label.setAttribute("stroke-width", "0.2");
      label.setAttribute("paint-order", "stroke");
      label.setAttribute("pointer-events", "none");
      label.setAttribute(ROUTE_ATTR, "");
      label.textContent = "(unmapped)";
      svgGroup.appendChild(label);
      continue;
    }

    const ptsStr = pointsAttr(points);

    // 1. Transparent hit-area polyline (Req 10.2: at least 8px hit area)
    const hit = doc.createElementNS(SVG_NS, "polyline");
    hit.setAttribute("points", ptsStr);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "8");
    hit.setAttribute("stroke-linecap", "round");
    hit.setAttribute("stroke-linejoin", "round");
    hit.setAttribute("pointer-events", "stroke");
    hit.setAttribute("cursor", "pointer");
    hit.setAttribute(ROUTE_ATTR, "");
    hit.setAttribute(ROUTE_ID_ATTR, seg.id);
    hit.addEventListener("click", (e) => {
      e.stopPropagation();
      onSegmentClick(seg.id);
    });
    svgGroup.appendChild(hit);

    // 2. Visible styled polyline
    const line = doc.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", ptsStr);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", style.color);
    line.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("pointer-events", "none");
    line.setAttribute(ROUTE_ATTR, "");
    if (style.dashArray) {
      line.setAttribute("stroke-dasharray", style.dashArray);
    }
    svgGroup.appendChild(line);

    // Endpoint dots for origin and destination
    for (const pt of [points[0]!, points[points.length - 1]!]) {
      const dot = doc.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(pt.x));
      dot.setAttribute("cy", String(pt.y));
      dot.setAttribute("r", "2.5");
      dot.setAttribute("fill", style.color);
      dot.setAttribute("stroke", "#111");
      dot.setAttribute("stroke-width", "0.4");
      dot.setAttribute("pointer-events", "none");
      dot.setAttribute(ROUTE_ATTR, "");
      svgGroup.appendChild(dot);
    }

    // If one endpoint is unmapped, label the mapped endpoint (Req 9.7)
    if (originMissing) {
      const first = points[0]!;
      const lbl = doc.createElementNS(SVG_NS, "text");
      lbl.setAttribute("x", String(first.x + 8));
      lbl.setAttribute("y", String(first.y - 6));
      lbl.setAttribute("font-size", "5");
      lbl.setAttribute("fill", style.color);
      lbl.setAttribute("stroke", "#000");
      lbl.setAttribute("stroke-width", "0.15");
      lbl.setAttribute("paint-order", "stroke");
      lbl.setAttribute("pointer-events", "none");
      lbl.setAttribute(ROUTE_ATTR, "");
      lbl.textContent = "← unmapped origin";
      svgGroup.appendChild(lbl);
    }
    if (destinationMissing) {
      const last = points[points.length - 1]!;
      const lbl = doc.createElementNS(SVG_NS, "text");
      lbl.setAttribute("x", String(last.x + 8));
      lbl.setAttribute("y", String(last.y - 6));
      lbl.setAttribute("font-size", "5");
      lbl.setAttribute("fill", style.color);
      lbl.setAttribute("stroke", "#000");
      lbl.setAttribute("stroke-width", "0.15");
      lbl.setAttribute("paint-order", "stroke");
      lbl.setAttribute("pointer-events", "none");
      lbl.setAttribute(ROUTE_ATTR, "");
      lbl.textContent = "unmapped destination →";
      svgGroup.appendChild(lbl);
    }
  }

  return { unmappedSegments, partialSegments };
}

/**
 * Removes all route overlay elements from the SVG group.
 * Called when the journey overlay is deactivated (Req 9.10).
 */
export function clearRouteOverlay(svgGroup: SVGGElement): void {
  const existing = svgGroup.querySelectorAll(`[${ROUTE_ATTR}]`);
  for (const el of existing) el.remove();
}

// ── React Legend Component ──

/** Props for the RouteLegend panel. */
export interface RouteLegendProps {
  segments: EnrichedSegment[];
  unmappedCount?: number;
  className?: string;
}

/**
 * Legend panel showing visible journey categories with color/dash samples.
 * Rendered as a React component overlaid on the atlas page (outside the iframe).
 *
 * Requirements: 9.5, 9.8, 9.9, 9.11
 */
export function RouteLegend({ segments, unmappedCount = 0, className }: RouteLegendProps) {
  // Collect categories that have at least one visible segment
  const visibleCategories = useMemo(() => {
    const cats = new Set<JourneyCategory>();
    for (const seg of segments) {
      cats.add(seg.journey.category);
    }
    // Maintain a stable order matching JOURNEY_CATEGORIES
    const ordered: JourneyCategory[] = [];
    for (const cat of Object.keys(ROUTE_STYLES) as JourneyCategory[]) {
      if (cats.has(cat)) ordered.push(cat);
    }
    return ordered;
  }, [segments]);

  // Req 9.11: no routes available at all
  if (segments.length === 0 && unmappedCount === 0) {
    return (
      <div className={cn("rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs text-ink-muted shadow-lg", className)}>
        <div className="flex items-center gap-1.5">
          <MapPin size={12} className="text-ink-faint" />
          No routes available to display
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border border-border bg-bg-elevated/95 px-3 py-2 shadow-lg", className)}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Journey Routes</div>
      <div className="space-y-1">
        {visibleCategories.map((cat) => {
          const style = ROUTE_STYLES[cat];
          return (
            <div key={cat} className="flex items-center gap-2 text-xs text-ink">
              <svg width="28" height="10" className="shrink-0" aria-hidden>
                <line
                  x1="2"
                  y1="5"
                  x2="26"
                  y2="5"
                  stroke={style.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={style.dashArray || undefined}
                />
              </svg>
              <span>{JOURNEY_CATEGORY_LABELS[cat]}</span>
            </div>
          );
        })}
      </div>
      {unmappedCount > 0 && (
        <div className="mt-1.5 border-t border-border pt-1.5 text-[11px] text-ink-faint">
          ({unmappedCount} unmapped segment{unmappedCount !== 1 ? "s" : ""})
        </div>
      )}
      {/* Req 9.8: missing location note when segments had features that disappeared */}
      {segments.length > 0 && unmappedCount > 0 && (
        <div className="mt-0.5 text-[10px] text-ink-faint italic">
          Some segments reference locations without map coordinates
        </div>
      )}
    </div>
  );
}
