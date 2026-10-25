import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { useRepos } from "@/app/appContext";
import { platform } from "@/app/platform";
import { DEFAULT_TABLE_VIEW, playerView, TABLE_VIEW_SETTING, type TableViewSettings } from "@/domain/tableView";
import { DoorGlyph, GridLines, MarkerGlyph, ObjectGlyph, TokenGlyph } from "@/features/dungeons/MapCanvas";

const POLL_MS = 1500;

/**
 * The second-screen table display. It follows the floor the DM sends to the table, refreshes on a short
 * poll, and never shows hidden objects, undiscovered doors, DM-only markers or enemy HP.
 */
export function TableView() {
  const repos = useRepos();
  const settings = useQuery({
    queryKey: ["tableView", "settings"],
    queryFn: () => repos.settings.get<TableViewSettings>(TABLE_VIEW_SETTING, DEFAULT_TABLE_VIEW),
    refetchInterval: POLL_MS,
  });
  const view = { ...DEFAULT_TABLE_VIEW, ...(settings.data ?? {}) };
  const floor = useQuery({
    queryKey: ["tableView", "floor", view.floor_id],
    queryFn: () => repos.dungeons.loadFloor(view.floor_id!),
    enabled: !!view.floor_id,
    refetchInterval: POLL_MS,
  });
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [hint, setHint] = useState(true);
  const maskId = useId().replace(/:/g, "");
  const rel = floor.data?.floor.background_asset ?? null;

  useEffect(() => {
    if (!rel) return setBgUrl(null);
    let cancelled = false;
    void platform.assetUrl(rel).then((u) => !cancelled && setBgUrl(u)).catch(() => !cancelled && setBgUrl(null));
    return () => {
      cancelled = true;
    };
  }, [rel]);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const pv = useMemo(() => (floor.data ? playerView(floor.data, view) : null), [floor.data, view.fog, view.light_radius]);

  if (!view.floor_id) return <Blank text="Waiting for the DM to send a map to the table…" />;
  if (!pv) return <Blank text="Loading map…" />;
  const { data, reveal } = pv;
  const W = data.floor.width;
  const H = data.floor.height;

  return (
    <div className="relative h-full w-full bg-black" onDoubleClick={() => void platform.toggleFullscreen()}>
      <svg className="h-full w-full" viewBox={`-0.5 -0.5 ${W + 1} ${H + 1}`} preserveAspectRatio="xMidYMid meet">
        {reveal && (
          <defs>
            <mask id={maskId}>
              <rect x={-1} y={-1} width={W + 2} height={H + 2} fill="black" />
              {reveal.rects.map((r, i) => (
                <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="white" />
              ))}
              {reveal.circles.map((c, i) => (
                <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} fill="white" />
              ))}
            </mask>
          </defs>
        )}
        <g mask={reveal ? `url(#${maskId})` : undefined}>
          <rect x={0} y={0} width={W} height={H} fill="#1a1612" />
          {bgUrl && <image href={bgUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
          {data.rooms.map((room) => (
            <g key={room.id}>
              <rect x={room.x} y={room.y} width={room.w} height={room.h} fill={room.color ?? "#5a4a3a"} opacity={bgUrl ? 0.25 : 0.75} stroke="#8a7a66" strokeWidth={0.04} />
              <text x={room.x + 0.15} y={room.y + 0.45} fontSize={0.38} fill="#f3e9d7" fontFamily="serif">
                {room.number ? `${room.number}. ` : ""}
                {room.entity.name}
              </text>
            </g>
          ))}
          {data.floor.terrain.map((t, i) => (
            <rect key={i} x={t.x} y={t.y} width={1} height={1} fill={t.type === "water" ? "#2b5c7a" : t.type === "difficult" ? "#5c4a2b" : "#444"} opacity={0.5} />
          ))}
          <GridLines w={W} h={H} />
          {data.floor.walls.map((w) => (
            <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#d8ccb8" strokeWidth={0.12} strokeLinecap="round" />
          ))}
          {data.doors.map((d) => (
            <DoorGlyph key={d.id} door={d} selected={false} />
          ))}
          {data.objects.map((o) => (
            <ObjectGlyph key={o.id} object={o} selected={false} showLabel={false} />
          ))}
          {data.markers.map((m) => (
            <MarkerGlyph key={m.id} marker={m} selected={false} showLabel={false} />
          ))}
          {data.tokens.map((t) => (
            <TokenGlyph key={t.id} token={t} selected={false} showLabel />
          ))}
        </g>
      </svg>
      {hint && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-[12px] text-ink-muted">
          {data.floor.name} · double-click for full screen
        </div>
      )}
    </div>
  );
}

function Blank({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center bg-black font-display text-xl text-ink-faint">{text}</div>;
}
