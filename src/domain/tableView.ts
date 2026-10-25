/**
 * What the players may see on the table display: the DM's floor minus everything secret. Rooms are
 * revealed once explored; party tokens also light a small circle so corridors are visible as they walk.
 */
import type { FloorData } from "@/persistence/repositories/dungeons";

export interface TableViewSettings {
  floor_id: string | null;
  /** Hide unexplored areas. Off shows the whole (non-secret) map. */
  fog: boolean;
  /** Radius in cells revealed around each PC token (when fog is on). */
  light_radius: number;
}

export const DEFAULT_TABLE_VIEW: TableViewSettings = { floor_id: null, fog: true, light_radius: 2 };
export const TABLE_VIEW_SETTING = "table_view";

export interface PlayerView {
  data: FloorData;
  reveal: { rects: { x: number; y: number; w: number; h: number }[]; circles: { cx: number; cy: number; r: number }[] } | null;
}

export function playerView(data: FloorData, settings: Pick<TableViewSettings, "fog" | "light_radius">): PlayerView {
  const explored = new Set(data.rooms.filter((r) => r.state.explored).map((r) => r.id));
  const roomVisible = (roomId: string | null) => !settings.fog || (roomId !== null && explored.has(roomId));
  const filtered: FloorData = {
    floor: data.floor,
    // rooms keep their shape but players never see DM text; names stay (they are on the map key)
    rooms: data.rooms.map((r) => ({ ...r, entity: { ...r.entity, dm_notes_md: "", secret_md: "", body_md: "", read_aloud_md: "" } })),
    doors: data.doors.filter((d) => !(d.hidden && !d.discovered) && !(d.kind === "secret" && !d.discovered)),
    objects: data.objects.filter((o) => !(o.hidden && !o.discovered)),
    tokens: data.tokens
      .filter((t) => !t.hidden)
      // only the party's own HP is shown on the table
      .map((t) => (t.kind === "pc" ? t : { ...t, hp: t.hp === 0 ? 0 : null, max_hp: null })),
    markers: data.markers.filter((m) => !m.dm_only && m.enabled && roomVisible(m.room_id)),
  };
  if (!settings.fog) return { data: filtered, reveal: null };
  return {
    data: filtered,
    reveal: {
      rects: data.rooms.filter((r) => explored.has(r.id)).map((r) => ({ x: r.x - 0.1, y: r.y - 0.1, w: r.w + 0.2, h: r.h + 0.2 })),
      circles: filtered.tokens.filter((t) => t.kind === "pc").map((t) => ({ cx: t.x + t.size / 2, cy: t.y + t.size / 2, r: Math.max(0, settings.light_radius) + t.size / 2 })),
    },
  };
}
