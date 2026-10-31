import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, DoorClosed, Eraser, Flag, Grid3x3, Hand, Layers, Mountain, MousePointer2, Pencil, Play, Plus, Redo2, Square, Swords, Trash2, Undo2, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import { qk, useAction, useEntities, useEntity, useRequiredCampaignId } from "@/app/queries";
import { EntityDetail } from "@/components/EntityDetail";
import { CreateEntityDialog } from "@/components/EntityForm";
import { MarkdownView } from "@/components/Markdown";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, Input, Kbd, Select, Tooltip } from "@/components/ui";
import type { Door, MapMarker, ObjectKind } from "@/domain/types";
import { activateEncounter } from "@/domain/workflows/encounterWorkflow";
import { cn, errorMessage } from "@/lib/utils";
import { PlaceTokenDialog, RollDialog } from "./dialogs";
import { CELL, useEditor, type Layers as LayerFlags, type TerrainBrush, type Tool } from "./editorStore";
import { Inspector } from "./Inspector";
import { MapCanvas } from "./MapCanvas";
import { useDungeonPlay } from "./useDungeonPlay";
import { TableControl } from "@/features/table/TableControl";
import { FLOOR_NOTES_SAVED, onAppEvent, type FloorNotesSaved } from "@/app/windowEvents";

export function DungeonsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dungeons = useEntities({ kinds: ["dungeon"], orderBy: "name" });
  const [creating, setCreating] = useState(false);
  if (!id) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 items-center justify-between border-b border-border bg-bg-elevated px-4">
          <h1 className="font-display text-[15px] text-ember-soft">Dungeons & Maps</h1>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={12} /> New dungeon
          </Button>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 lg:grid-cols-3">
          {(dungeons.data ?? []).map((d) => (
            <button key={d.id} onClick={() => navigate(`/dungeons/${d.id}`)} className="panel flex flex-col p-3 text-left hover:border-ember/50">
              <div className="flex items-center gap-2">
                <Grid3x3 size={14} className="text-ember" />
                <span className="font-display text-[15px]">{d.name}</span>
                {d.subtype && <Badge>{d.subtype}</Badge>}
              </div>
              <div className="mt-1 line-clamp-3 text-[12px] text-ink-muted">{d.summary}</div>
              <div className="mt-2 text-[11px] text-ink-faint">{String(d.fields.threat_level ?? "")}</div>
            </button>
          ))}
          {(dungeons.data ?? []).length === 0 && <EmptyState title="No dungeons yet" body="Create a dungeon, then draw its floors, rooms, doors, objects and tokens." />}
        </div>
        <CreateEntityDialog open={creating} onOpenChange={setCreating} kinds={["dungeon"]} onCreated={(e) => navigate(`/dungeons/${e.id}`)} />
      </div>
    );
  }
  return <DungeonView dungeonId={id} />;
}

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode; editOnly?: boolean }[] = [
  { tool: "select", label: "Select / move", key: "V", icon: <MousePointer2 size={14} /> },
  { tool: "pan", label: "Pan", key: "H", icon: <Hand size={14} /> },
  { tool: "room", label: "Draw room", key: "R", icon: <Square size={14} />, editOnly: true },
  { tool: "wall", label: "Draw wall", key: "W", icon: <Pencil size={14} />, editOnly: true },
  { tool: "door", label: "Place door", key: "D", icon: <DoorClosed size={14} />, editOnly: true },
  { tool: "object", label: "Place object", key: "O", icon: <Box size={14} />, editOnly: true },
  { tool: "token", label: "Place token", key: "T", icon: <UserRound size={14} /> },
  { tool: "marker", label: "Place marker", key: "M", icon: <Flag size={14} />, editOnly: true },
  { tool: "terrain", label: "Paint terrain (difficult / water / clear) — drag a rectangle", key: "G", icon: <Mountain size={14} />, editOnly: true },
  { tool: "erase", label: "Erase", key: "E", icon: <Eraser size={14} />, editOnly: true },
];

function DungeonView({ dungeonId }: { dungeonId: string }) {
  const repos = useRepos();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const campaignId = useRequiredCampaignId();
  const [params, setParams] = useSearchParams();
  const dungeon = useEntity(dungeonId);
  const settings = useAppStore((s) => s.settings);
  const floors = useQuery({ queryKey: qk.floors(dungeonId), queryFn: () => repos.dungeons.floors(dungeonId) });
  const ed = useEditor();
  const play = useDungeonPlay(campaignId);
  const [placing, setPlacing] = useState<{ x: number; y: number } | null>(null);
  const [roomRecord, setRoomRecord] = useState<string | null>(null);
  const [newFloor, setNewFloor] = useState(false);
  const [deleteFloor, setDeleteFloor] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    ed.init(repos, campaignId, dungeonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, campaignId, dungeonId]);

  const floorParam = params.get("floor");
  const activeFloorId = useMemo(() => {
    const list = floors.data ?? [];
    if (floorParam && list.some((f) => f.id === floorParam)) return floorParam;
    return list[0]?.id ?? null;
  }, [floors.data, floorParam]);

  useEffect(() => {
    if (activeFloorId) void ed.load(activeFloorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloorId]);

  // deep links: ?room=, ?token=
  useEffect(() => {
    if (!ed.data) return;
    const room = params.get("room");
    const token = params.get("token");
    if (room && ed.data.rooms.some((r) => r.id === room)) ed.select([{ type: "room", id: room }]);
    if (token && ed.data.tokens.some((t) => t.id === token)) ed.select([{ type: "token", id: token }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.data?.floor.id]);

  useEffect(() => {
    const handler = (e: Event) => setPlacing((e as CustomEvent<{ x: number; y: number }>).detail);
    window.addEventListener("dm:place-token", handler);
    return () => window.removeEventListener("dm:place-token", handler);
  }, []);

  // Notes saved in a pop-out window: reload this floor so the inspector shows them.
  useEffect(
    () =>
      onAppEvent<FloorNotesSaved>(FLOOR_NOTES_SAVED, (p) => {
        const s = useEditor.getState();
        if (s.floorId === p.floorId && s.data?.floor.notes_md !== p.notes_md) void s.refresh();
      }),
    [],
  );

  const createFloor = useAction(
    (input: { name: string; width: number; height: number; level: number }) => repos.dungeons.createFloor({ dungeon_id: dungeonId, name: input.name, width: input.width, height: input.height, level: input.level, cell_feet: settings.defaultCellFeet, sort_order: (floors.data?.length ?? 0) }),
    { success: "Floor created", invalidate: [qk.floors(dungeonId)], onSuccess: (f) => { setNewFloor(false); setParams({ floor: f.id }); } },
  );
  const removeFloor = useAction((id: string) => repos.dungeons.deleteFloor(id), { success: "Floor deleted", invalidate: [qk.floors(dungeonId), ["entities"]], onSuccess: () => setParams({}) });

  const startEncounter = async (encounterId: string, roomId: string | null) => {
    try {
      const { run } = await activateEncounter(repos, { campaign_id: campaignId, encounter_id: encounterId, room_id: roomId, floor_id: activeFloorId, session_id: play.sessionId, placeTokens: true });
      await ed.refresh();
      void qc.invalidateQueries({ queryKey: ["encounters"] });
      toast.success(`Encounter prepared: ${run.name}`);
      navigate(`/encounters/${encounterId}?run=${run.id}&floor=${activeFloorId ?? ""}&dungeon=${dungeonId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const zoomBy = (f: number) => ed.setView(Math.min(4, Math.max(0.2, ed.zoom * f)), ed.pan);
  const fit = () => {
    if (!ed.data) return;
    const el = document.getElementById("map-area");
    if (!el) return;
    const z = Math.min((el.clientWidth - 40) / (ed.data.floor.width * CELL), (el.clientHeight - 40) / (ed.data.floor.height * CELL));
    ed.setView(Math.max(0.2, Math.min(3, z)), { x: 20, y: 20 });
  };

  if (!dungeon.data) return <EmptyState title="Loading dungeon…" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-3">
        <button className="text-ink-faint hover:text-ink" onClick={() => navigate("/dungeons")} title="All dungeons">
          <Grid3x3 size={14} />
        </button>
        <button className="truncate font-display text-[15px] text-ember-soft hover:underline" onClick={() => setShowRecord(true)}>
          {dungeon.data.name}
        </button>
        <div className="mx-2 flex items-center gap-0.5">
          {(floors.data ?? []).map((f) => (
            <button key={f.id} onClick={() => setParams({ floor: f.id })} className={cn("rounded px-2 py-1 text-[12px] text-ink-muted hover:bg-bg-hover", f.id === activeFloorId && "bg-bg-active text-ink")}>
              {f.name}
            </button>
          ))}
          <button className="rounded p-1 text-ink-faint hover:bg-bg-hover hover:text-ink" onClick={() => setNewFloor(true)} title="Add floor">
            <Plus size={13} />
          </button>
          {activeFloorId && (
            <button className="rounded p-1 text-ink-faint hover:bg-bg-hover hover:text-blood" onClick={() => setDeleteFloor(true)} title="Delete floor">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded border border-border">
            <button className={cn("flex items-center gap-1 px-2 py-1 text-[12px]", ed.mode === "edit" ? "bg-bg-active text-ember-soft" : "text-ink-muted")} onClick={() => ed.setMode("edit")}>
              <Pencil size={12} /> Edit
            </button>
            <button className={cn("flex items-center gap-1 px-2 py-1 text-[12px]", ed.mode === "play" ? "bg-bg-active text-ember-soft" : "text-ink-muted")} onClick={() => ed.setMode("play")}>
              <Play size={12} /> Play
            </button>
          </div>
          <Tooltip content={`Undo${ed.undo.undoLabel ? `: ${ed.undo.undoLabel}` : ""}`}>
            <Button size="icon" variant="ghost" disabled={!ed.undo.canUndo} onClick={() => void ed.undoLast()}>
              <Undo2 size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={`Redo${ed.undo.redoLabel ? `: ${ed.undo.redoLabel}` : ""}`}>
            <Button size="icon" variant="ghost" disabled={!ed.undo.canRedo} onClick={() => void ed.redoLast()}>
              <Redo2 size={14} />
            </Button>
          </Tooltip>
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1 / 1.2)}>
            <ZoomOut size={14} />
          </Button>
          <button className="w-10 text-center font-mono text-[11px] text-ink-muted hover:text-ink" onClick={fit} title="Fit to view">
            {Math.round(ed.zoom * 100)}%
          </button>
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1.2)}>
            <ZoomIn size={14} />
          </Button>
          <TableControl floorId={activeFloorId} />
          <div className="relative">
            <Button size="sm" variant={layersOpen ? "secondary" : "ghost"} onClick={() => setLayersOpen((o) => !o)}>
              <Layers size={13} /> Layers
            </Button>
            {layersOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded border border-border-strong bg-bg-elevated p-2 shadow-xl">
                {(Object.keys(ed.layers) as (keyof LayerFlags)[]).map((k) => (
                  <label key={k} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <input type="checkbox" checked={ed.layers[k]} onChange={() => ed.toggleLayer(k)} className="accent-ember" />
                    {k === "hidden" ? "hidden elements (DM)" : k === "reach" ? "movement range" : k}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* tool rail */}
        <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-bg-elevated py-2">
          {TOOLS.filter((t) => !t.editOnly || ed.mode === "edit").map((t) => (
            <Tooltip key={t.tool} side="right" content={<span className="flex items-center gap-2">{t.label} <Kbd>{t.key}</Kbd></span>}>
              <button onClick={() => ed.setTool(t.tool)} className={cn("flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:bg-bg-hover hover:text-ink", ed.tool === t.tool && "bg-bg-active text-ember-soft")}>
                {t.icon}
              </button>
            </Tooltip>
          ))}
          {ed.mode === "edit" && ed.tool === "object" && (
            <Select value={ed.objectKind} onChange={(e) => ed.setObjectKind(e.target.value as ObjectKind)} className="mt-2 h-7 w-10 px-0 text-[10px]" title="Object kind">
              {["container", "furniture", "trap", "hazard", "mechanism", "statue", "bookshelf", "document", "altar", "decoration", "secret_passage"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          )}
          {ed.mode === "edit" && ed.tool === "door" && (
            <Select value={ed.doorKind} onChange={(e) => ed.setDoorKind(e.target.value as Door["kind"])} className="mt-2 h-7 w-10 px-0 text-[10px]" title="Door kind">
              {["door", "secret", "portcullis", "window", "passage", "stairs_up", "stairs_down"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          )}
          {ed.mode === "edit" && ed.tool === "marker" && (
            <Select value={ed.markerKind} onChange={(e) => ed.setMarkerKind(e.target.value as MapMarker["kind"])} className="mt-2 h-7 w-10 px-0 text-[10px]" title="Marker kind">
              {["event", "encounter", "trap", "treasure", "clue", "npc", "secret", "note"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          )}
          {ed.mode === "edit" && ed.tool === "terrain" && (
            <Select value={ed.terrainKind} onChange={(e) => ed.setTerrainKind(e.target.value as TerrainBrush)} className="mt-2 h-7 w-10 px-0 text-[10px]" title="Terrain brush">
              {["difficult", "water", "clear"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          )}
          {ed.mode === "play" && (
            <Tooltip side="right" content="Run an encounter here">
              <button onClick={() => navigate("/encounters")} className="mt-auto flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:bg-bg-hover hover:text-ink">
                <Swords size={14} />
              </button>
            </Tooltip>
          )}
        </div>

        {/* canvas */}
        <div id="map-area" className="relative min-w-0 flex-1 overflow-hidden">
          {ed.loading && !ed.data ? <EmptyState title="Loading floor…" /> : !activeFloorId ? <EmptyState title="No floors" body="Add a floor to start drawing." action={<Button variant="primary" onClick={() => setNewFloor(true)}>Add floor</Button>} /> : <MapCanvas play={ed.mode === "play" ? { moveToken: play.move } : null} />}
          {/* status bar */}
          {ed.data && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center gap-3 bg-bg/80 px-3 py-1 font-mono text-[11px] text-ink-faint">
              <span>
                {ed.data.floor.width}×{ed.data.floor.height} cells · {ed.data.floor.cell_feet} ft
              </span>
              {ed.hover && <span>cell ({ed.hover.x}, {ed.hover.y})</span>}
              <span>{ed.selection.length ? `${ed.selection.length} selected` : ""}</span>
              <span className="ml-auto">{ed.mode === "play" ? "PLAY — token moves are rule-checked and logged" : `EDIT — ${ed.tool}`}</span>
            </div>
          )}
          {/* triggered markers */}
          <div className="absolute right-3 top-3 flex w-80 flex-col gap-2">
            {play.triggered.map((m) => (
              <TriggeredMarkerCard key={m.id} marker={m} onDismiss={() => play.dismissTriggered(m.id)} onRun={(encounterId) => startEncounter(encounterId, m.room_id)} />
            ))}
          </div>
        </div>

        {/* inspector */}
        <div style={{ width: settings.rightPanelWidth }} className="flex shrink-0 flex-col border-l border-border bg-bg-elevated">
          {ed.data && <Inspector play={play} onStartEncounter={startEncounter} onOpenRoomRecord={setRoomRecord} />}
        </div>
      </div>

      <RollDialog request={play.rollRequest} />
      <PlaceTokenDialog
        cell={placing}
        onClose={() => setPlacing(null)}
        onPlace={(input) => {
          void ed.createToken({ ...input, x: placing!.x, y: placing!.y });
          setPlacing(null);
          ed.setTool("select");
        }}
      />
      {roomRecord && (
        <Dialog open onOpenChange={(o) => !o && setRoomRecord(null)} title="Room record" width="max-w-4xl">
          <div className="flex h-[70vh] flex-col">
            <EntityDetail id={roomRecord} kinds={["room"]} afterDelete={() => { setRoomRecord(null); void ed.refresh(); }} />
          </div>
        </Dialog>
      )}
      {showRecord && (
        <Dialog open onOpenChange={(o) => !o && setShowRecord(false)} title="Dungeon record" width="max-w-4xl">
          <div className="flex h-[70vh] flex-col">
            <EntityDetail id={dungeonId} kinds={["dungeon"]} afterDelete={() => navigate("/dungeons")} />
          </div>
        </Dialog>
      )}
      <NewFloorDialog open={newFloor} onOpenChange={setNewFloor} defaults={{ width: settings.defaultGridWidth, height: settings.defaultGridHeight, level: -(floors.data?.length ?? 0) }} onCreate={(input) => createFloor.mutate(input)} />
      <ConfirmDialog open={deleteFloor} onOpenChange={setDeleteFloor} title="Delete this floor?" body="All rooms, doors, objects, tokens and markers on it are removed." onConfirm={() => removeFloor.mutateAsync(activeFloorId!).then(() => undefined)} />
    </div>
  );
}

function NewFloorDialog({ open, onOpenChange, defaults, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; defaults: { width: number; height: number; level: number }; onCreate: (input: { name: string; width: number; height: number; level: number }) => void }) {
  const [form, setForm] = useState({ name: "", ...defaults });
  useEffect(() => {
    if (open) setForm({ name: "", ...defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New floor"
      width="max-w-sm"
      footer={
        <Button variant="primary" disabled={!form.name.trim()} onClick={() => onCreate({ ...form, name: form.name.trim() })}>
          Create
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Field label="Name" className="col-span-3">
          <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ground floor, Level 2, Crypts…" />
        </Field>
        <Field label="Width">
          <Input type="number" min={5} max={200} value={form.width} onChange={(e) => setForm({ ...form, width: Number(e.target.value) })} />
        </Field>
        <Field label="Height">
          <Input type="number" min={5} max={200} value={form.height} onChange={(e) => setForm({ ...form, height: Number(e.target.value) })} />
        </Field>
        <Field label="Level">
          <Input type="number" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} />
        </Field>
      </div>
    </Dialog>
  );
}

function TriggeredMarkerCard({ marker, onDismiss, onRun }: { marker: MapMarker; onDismiss: () => void; onRun: (encounterId: string) => void }) {
  const encounter = useEntity(marker.encounter_id);
  return (
    <div className="panel border-ember/60 p-3 shadow-xl">
      <div className="flex items-center gap-2">
        <Flag size={13} className="text-ember" />
        <span className="font-display text-[14px] text-ember-soft">{marker.title}</span>
        <Badge>{marker.kind}</Badge>
        <button className="ml-auto text-ink-faint hover:text-ink" onClick={onDismiss}>
          <X size={13} />
        </button>
      </div>
      {marker.body_md && <MarkdownView source={marker.body_md} className="mt-2 text-[12.5px]" />}
      {encounter.data && (
        <Button variant="primary" size="sm" className="mt-2" onClick={() => onRun(encounter.data!.id)}>
          <Swords size={12} /> Run {encounter.data.name}
        </Button>
      )}
    </div>
  );
}
