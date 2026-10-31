import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, DoorOpen, ExternalLink, Eye, EyeOff, Hand, ImagePlus, RotateCcw, Swords, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { platform, IMAGE_FILTER, type NotesTarget } from "@/app/platform";
import { useEntities, useEntity } from "@/app/queries";
import { emitNotesSaved } from "@/app/windowEvents";
import { EntityPicker } from "@/components/EntityPicker";
import { InventoryPanel, useInventory } from "@/components/InventoryPanel";
import { MarkdownEditor, MarkdownView } from "@/components/Markdown";
import { Badge, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { availableInteractions, defaultInteractionsFor } from "@/domain/interactions";
import type { Door, InteractionDefinition, MapMarker, MapObject, Room, Token } from "@/domain/types";
import { tokenOwner } from "@/domain/workflows/interactionWorkflow";
import { ROOM_LOOT_REF } from "@/domain/workflows/lootMarker";
import { cn, errorMessage } from "@/lib/utils";
import { CombatantSheet } from "@/features/encounters/CombatantSheet";
import { selectedOfType, useEditor } from "./editorStore";
import type { DungeonPlay } from "./useDungeonPlay";

const OBJECT_KINDS: MapObject["kind"][] = ["container", "furniture", "trap", "hazard", "mechanism", "statue", "bookshelf", "document", "altar", "decoration", "secret_passage"];
const DOOR_KINDS: Door["kind"][] = ["door", "secret", "portcullis", "window", "passage", "stairs_up", "stairs_down"];
const DOOR_STATES: Door["state"][] = ["open", "closed", "locked", "barred", "broken"];
const MARKER_KINDS: MapMarker["kind"][] = ["event", "encounter", "trap", "treasure", "clue", "npc", "secret", "note"];
const TRIGGERS: MapMarker["trigger"][] = ["manual", "enter_room", "enter_area", "open_door", "interact_object", "discover_secret", "step_trap", "defeat_creature"];
const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "exhaustion"];

export function Inspector({ play, onStartEncounter, onOpenRoomRecord }: { play: DungeonPlay; onStartEncounter: (encounterId: string, roomId: string | null) => void; onOpenRoomRecord: (roomId: string) => void }) {
  const data = useEditor((s) => s.data);
  const selection = useEditor((s) => s.selection);
  const mode = useEditor((s) => s.mode);
  if (!data) return null;
  const rooms = selectedOfType(selection, "room", data.rooms);
  const doors = selectedOfType(selection, "door", data.doors);
  const objects = selectedOfType(selection, "object", data.objects);
  const tokens = selectedOfType(selection, "token", data.tokens);
  const markers = selectedOfType(selection, "marker", data.markers);
  const walls = selection.filter((s) => s.type === "wall");
  const total = rooms.length + doors.length + objects.length + tokens.length + markers.length + walls.length;

  if (total === 0) return <FloorInspector />;
  if (total > 1)
    return (
      <div className="space-y-2 p-3 text-[12.5px]">
        <div className="font-display text-[15px] text-ember-soft">{total} elements selected</div>
        <ul className="text-ink-muted">
          {rooms.length > 0 && <li>{rooms.length} room(s)</li>}
          {doors.length > 0 && <li>{doors.length} door(s)</li>}
          {objects.length > 0 && <li>{objects.length} object(s)</li>}
          {tokens.length > 0 && <li>{tokens.length} token(s)</li>}
          {markers.length > 0 && <li>{markers.length} marker(s)</li>}
          {walls.length > 0 && <li>{walls.length} wall(s)</li>}
        </ul>
        {mode === "edit" && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => void useEditor.getState().duplicateSelection()}>
              Duplicate
            </Button>
            <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
              <Trash2 size={12} /> Delete
            </Button>
          </div>
        )}
        <p className="text-ink-faint">Drag to move all; arrow keys nudge; Delete removes.</p>
      </div>
    );
  if (rooms[0]) return <RoomInspector room={rooms[0]} play={play} onStartEncounter={onStartEncounter} onOpenRecord={onOpenRoomRecord} />;
  if (doors[0]) return <DoorInspector door={doors[0]} play={play} />;
  if (objects[0]) return <ObjectInspector object={objects[0]} play={play} />;
  if (tokens[0]) return <TokenInspector token={tokens[0]} play={play} />;
  if (markers[0]) return <MarkerInspector marker={markers[0]} onStartEncounter={onStartEncounter} />;
  if (walls[0]) {
    const wall = data.floor.walls.find((w) => w.id === walls[0]!.id);
    return (
      <div className="space-y-2 p-3 text-[12.5px]">
        <div className="font-display text-[15px] text-ember-soft">Wall segment</div>
        {wall && (
          <div className="font-mono text-ink-muted">
            ({wall.x1}, {wall.y1}) → ({wall.x2}, {wall.y2})
          </div>
        )}
        <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
          <Trash2 size={12} /> Delete wall
        </Button>
      </div>
    );
  }
  return null;
}

function Section({ title, children, className, action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cn("border-b border-border p-3", className)}>
      {action ? (
        <div className="label flex items-center gap-2">
          {title}
          {action}
        </div>
      ) : (
        <div className="label">{title}</div>
      )}
      {children}
    </div>
  );
}

function Header({ title, badge, actions }: { title: React.ReactNode; badge?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div className="min-w-0 flex-1 truncate font-display text-[15px] text-ember-soft">{title}</div>
      {badge && <Badge>{badge}</Badge>}
      {actions}
    </div>
  );
}

// ---- floor ----

/**
 * A notes block in the side panel: Markdown with `[[Name]]` links, edited in Edit mode and shown read-only
 * in Play mode, with a "Pop out" button that opens the same notes in their own resizable window.
 * `target` identifies the notes; a new target replaces the draft, while a new saved version (pop-out save,
 * undo/redo) replaces it only when there is no unsaved text here, so typing is never thrown away.
 */
function NotesSection({
  title,
  target,
  windowTitle,
  saved,
  onSave,
  placeholder,
}: {
  title: string;
  target: NotesTarget;
  windowTitle: string;
  saved: string;
  onSave: (notes: string) => Promise<unknown>;
  placeholder: string;
}) {
  const mode = useEditor((s) => s.mode);
  const [draft, setDraft] = useState(saved);
  const [open, setOpen] = useState(true);
  const last = useRef({ key: `${target.scope}:${target.id}`, notes: saved });
  useEffect(() => {
    const key = `${target.scope}:${target.id}`;
    const prev = last.current;
    if (prev.key !== key) setDraft(saved);
    else if (prev.notes !== saved) {
      setDraft((d) => (d === prev.notes ? saved : d));
      // keep an open pop-out in step with inline saves and undo/redo
      emitNotesSaved({ ...target, notes_md: saved });
    }
    last.current = { key, notes: saved };
  }, [target.scope, target.id, saved]);
  const dirty = draft !== saved;
  const popOut = () => void platform.openNotesWindow(target, windowTitle).catch((e) => toast.error(errorMessage(e)));
  const header = (
    <span className="ml-auto flex items-center gap-2 normal-case">
      <button className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink" onClick={popOut} title="Open these notes in their own window">
        <ExternalLink size={11} /> Pop out
      </button>
      <button className="text-[11px] text-ink-faint hover:text-ink" onClick={() => setOpen((o) => !o)} title={open ? "Collapse" : "Expand"}>
        {open ? "▾" : "▸"}
      </button>
    </span>
  );

  if (mode !== "edit") {
    if (!saved.trim()) return null;
    return (
      <Section title={title} action={header} className={cn(open && "max-h-72 overflow-y-auto")}>
        {open && <MarkdownView source={saved} className="text-[12.5px]" />}
      </Section>
    );
  }
  return (
    <Section title={title} action={header}>
      {open && (
        <>
          <MarkdownEditor value={draft} onChange={setDraft} rows={5} placeholder={placeholder} />
          <div className="mt-1 flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void onSave(draft).catch((e) => toast.error(errorMessage(e)))}>
              Save notes
            </Button>
            {dirty && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                  Discard
                </Button>
                <span className="text-[11px] text-gold">Unsaved changes</span>
              </>
            )}
          </div>
        </>
      )}
      {!open && dirty && <span className="text-[11px] text-gold">Unsaved changes (expand to save)</span>}
    </Section>
  );
}

/** Notes for the whole dungeon: the dungeon record's DM notes, so they match its record page. */
function DungeonNotes() {
  const repos = useRepos();
  const qc = useQueryClient();
  const dungeonId = useEditor((s) => s.dungeonId);
  const dungeon = useEntity(dungeonId);
  if (!dungeon.data) return null;
  const d = dungeon.data;
  return (
    <NotesSection
      title="Dungeon notes"
      target={{ scope: "dungeon", id: d.id }}
      windowTitle={`Dungeon notes — ${d.name}`}
      saved={d.dm_notes_md}
      placeholder="The big picture: who built this place, what the villain wants, how the floors connect, the clock…"
      onSave={async (notes) => {
        await repos.entities.update(d.id, { dm_notes_md: notes });
        await qc.invalidateQueries({ queryKey: ["entities"] });
      }}
    />
  );
}

/** Notes for the current floor. Saving goes through the editor store, so it is undoable. */
function FloorNotes() {
  const floor = useEditor((s) => s.data)!.floor;
  const updateFloor = useEditor((s) => s.updateFloor);
  return (
    <NotesSection
      title="Floor notes"
      target={{ scope: "floor", id: floor.id }}
      windowTitle={`Floor notes — ${floor.name}`}
      saved={floor.notes_md}
      placeholder="What this level is for, who lives here, how it connects to [[Other Places]]…"
      onSave={(notes) => updateFloor({ notes_md: notes })}
    />
  );
}

function FloorInspector() {
  const data = useEditor((s) => s.data)!;
  const mode = useEditor((s) => s.mode);
  const log = useEditor((s) => s.log);
  const updateFloor = useEditor((s) => s.updateFloor);
  const [name, setName] = useState(data.floor.name);
  const [size, setSize] = useState({ w: data.floor.width, h: data.floor.height, feet: data.floor.cell_feet });
  // Follow the selected floor: switching floors (or undo) must not leave the previous floor's values
  // in these boxes, or blurring the name field would rename the new floor.
  useEffect(() => {
    setName(data.floor.name);
    setSize({ w: data.floor.width, h: data.floor.height, feet: data.floor.cell_feet });
  }, [data.floor.id, data.floor.name, data.floor.width, data.floor.height, data.floor.cell_feet]);
  const explored = data.rooms.filter((r) => r.state.explored).length;
  return (
    <div className="flex h-full flex-col">
      <Header title={data.floor.name} badge={`level ${data.floor.level}`} />
      {mode === "edit" ? (
        <Section title="Floor">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Name" className="col-span-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== data.floor.name && void updateFloor({ name: name.trim() })} />
            </Field>
            <Field label="Width">
              <Input type="number" min={5} max={200} value={size.w} onChange={(e) => setSize({ ...size, w: Number(e.target.value) })} />
            </Field>
            <Field label="Height">
              <Input type="number" min={5} max={200} value={size.h} onChange={(e) => setSize({ ...size, h: Number(e.target.value) })} />
            </Field>
            <Field label="Feet / cell">
              <Input type="number" min={1} value={size.feet} onChange={(e) => setSize({ ...size, feet: Number(e.target.value) })} />
            </Field>
          </div>
          <Button size="sm" variant="outline" className="mt-2" disabled={size.w === data.floor.width && size.h === data.floor.height && size.feet === data.floor.cell_feet} onClick={() => void updateFloor({ width: Math.max(5, size.w), height: Math.max(5, size.h), cell_feet: Math.max(1, size.feet) })}>
            Apply size
          </Button>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const src = await platform.pickFile({ title: "Battle map image under the grid", filters: IMAGE_FILTER });
                  if (!src) return;
                  const asset = await platform.importFileAsset(src, "battlemaps");
                  await updateFloor({ background_asset: asset.rel_path });
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              <ImagePlus size={12} /> {data.floor.background_asset ? "Replace battle map image" : "Add battle map image"}
            </Button>
            {data.floor.background_asset && (
              <Button size="sm" variant="ghost" onClick={() => void updateFloor({ background_asset: null })}>
                Clear image
              </Button>
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            Tools: V select · H pan · R room · W wall · D door · O object · T token · M marker · E erase. Shift-click adds to the selection, drag on empty space for a marquee, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+D duplicates.
          </p>
        </Section>
      ) : (
        <Section title="Exploration">
          <div className="text-[12.5px] text-ink-muted">
            {explored} / {data.rooms.length} rooms explored · {data.tokens.length} tokens · {data.markers.filter((m) => m.activated).length} / {data.markers.length} markers triggered
          </div>
          <p className="mt-2 text-[11.5px] text-ink-faint">Select a token, then click a highlighted cell (or drag the token) to move it. Select doors and objects to see available actions.</p>
        </Section>
      )}
      <DungeonNotes />
      <FloorNotes />
      <Section title="Rooms" className="min-h-0 flex-1 overflow-y-auto">
        <ul className="space-y-0.5">
          {data.rooms.map((r) => (
            <li key={r.id}>
              <button className="row-hover flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12.5px]" onClick={() => useEditor.getState().select([{ type: "room", id: r.id }])}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color ?? "#5a4a3a" }} />
                <span className="truncate">
                  {r.number ? `${r.number}. ` : ""}
                  {r.entity.name}
                </span>
                {r.state.explored && <Badge tone="moss">explored</Badge>}
                {r.state.cleared && <Badge>cleared</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {mode === "play" && (
        <Section title="Action log" className="max-h-64 overflow-y-auto">
          <ul className="space-y-0.5 text-[12px]">
            {log.map((l, i) => (
              <li key={i} className={cn(l.tone === "warn" && "text-gold", l.tone === "success" && "text-ink", !l.tone && "text-ink-muted")}>
                {l.text}
              </li>
            ))}
            {log.length === 0 && <li className="text-ink-faint">No actions yet.</li>}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ---- room ----

function RoomInspector({ room, play, onStartEncounter, onOpenRecord }: { room: Room; play: DungeonPlay; onStartEncounter: (id: string, roomId: string) => void; onOpenRecord: (id: string) => void }) {
  const mode = useEditor((s) => s.mode);
  const updateRoom = useEditor((s) => s.updateRoom);
  const data = useEditor((s) => s.data)!;
  const [name, setName] = useState(room.entity.name);
  const [number, setNumber] = useState(room.number ?? "");
  // Follow the selected room (and undo/redo), so blurring a field never writes another room's values.
  useEffect(() => {
    setName(room.entity.name);
    setNumber(room.number ?? "");
  }, [room.id, room.entity.name, room.number]);
  const floorItems = useInventory({ owner_type: "room", owner_id: room.id });
  const encounters = useEntities({ kinds: ["encounter"], parent_id: room.id });
  const markers = data.markers.filter((m) => m.room_id === room.id);
  const selectedToken = selectedOfType(useEditor.getState().selection, "token", data.tokens)[0];
  const tokensHere = data.tokens.filter((t) => t.x >= room.x && t.x < room.x + room.w && t.y >= room.y && t.y < room.y + room.h);
  const key = room.id;
  return (
    <div key={key} className="flex h-full flex-col overflow-y-auto">
      <Header
        title={room.entity.name}
        badge="room"
        actions={
          <Button size="sm" variant="outline" onClick={() => onOpenRecord(room.id)}>
            <BookOpen size={12} /> Record
          </Button>
        }
      />
      {mode === "edit" ? (
        <Section title="Geometry & identity">
          <div className="grid grid-cols-4 gap-2">
            <Field label="Number">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} onBlur={() => number !== (room.number ?? "") && void updateRoom(room.id, { number: number || null })} />
            </Field>
            <Field label="Name" className="col-span-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== room.entity.name && void updateRoom(room.id, {}, { name: name.trim() })} />
            </Field>
            <Field label="X">
              <Input type="number" value={room.x} onChange={(e) => void updateRoom(room.id, { x: Number(e.target.value) })} />
            </Field>
            <Field label="Y">
              <Input type="number" value={room.y} onChange={(e) => void updateRoom(room.id, { y: Number(e.target.value) })} />
            </Field>
            <Field label="W">
              <Input type="number" min={1} value={room.w} onChange={(e) => void updateRoom(room.id, { w: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field label="H">
              <Input type="number" min={1} value={room.h} onChange={(e) => void updateRoom(room.id, { h: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field label="Lighting" className="col-span-2">
              <Select value={room.lighting} onChange={(e) => void updateRoom(room.id, { lighting: e.target.value })}>
                {["bright", "dim", "dark", "magical darkness"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Terrain" className="col-span-2">
              <Input value={room.terrain} onChange={(e) => void updateRoom(room.id, { terrain: e.target.value })} />
            </Field>
            <Field label="Color" className="col-span-2">
              <input type="color" value={room.color ?? "#5a4a3a"} onChange={(e) => void updateRoom(room.id, { color: e.target.value })} className="h-8 w-full rounded border border-border bg-bg" />
            </Field>
          </div>
        </Section>
      ) : (
        <>
          <Section title="Read aloud">
            <MarkdownView source={room.entity.read_aloud_md} variant="read-aloud" />
          </Section>
          <Section title="DM notes">
            <MarkdownView source={room.entity.body_md} />
            {room.entity.dm_notes_md && <MarkdownView source={room.entity.dm_notes_md} className="mt-2" />}
            {room.entity.secret_md && <MarkdownView source={room.entity.secret_md} variant="secret" className="mt-2" />}
          </Section>
        </>
      )}
      <Section title="State">
        <div className="flex flex-wrap gap-3">
          {(["discovered", "explored", "cleared", "locked", "trapped"] as const).map((k) => (
            <Checkbox key={k} label={k} checked={Boolean(room.state[k])} onChange={(v) => void updateRoom(room.id, { state: { ...room.state, [k]: v, modified: true } })} />
          ))}
        </div>
        <div className="mt-1 text-[11px] text-ink-faint">
          {room.lighting} · {room.terrain} · {room.w * data.floor.cell_feet}×{room.h * data.floor.cell_feet} ft
        </div>
      </Section>
      {(encounters.data ?? []).length > 0 && (
        <Section title="Encounters in this room">
          <ul className="space-y-1">
            {encounters.data!.map((enc) => (
              <RoomEncounterRow key={enc.id} encounter={enc} roomId={room.id} onStartEncounter={onStartEncounter} />
            ))}
          </ul>
        </Section>
      )}
      {markers.length > 0 && (
        <Section title="Markers">
          <ul className="space-y-0.5 text-[12.5px]">
            {markers.map((m) => (
              <li key={m.id}>
                <button className="row-hover w-full rounded px-1 text-left" onClick={() => useEditor.getState().select([{ type: "marker", id: m.id }])}>
                  {m.title} <span className="text-ink-faint">· {m.trigger.replace("_", " ")}{m.activated ? " · triggered" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Items on the floor">
        {markers.some((m) => m.kind === "treasure" && m.trigger_ref === ROOM_LOOT_REF && m.enabled) && (
          <p className="mb-1 text-[11.5px] text-gold">Loot marker on the map ($)</p>
        )}
        {(floorItems.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">Nothing lying here.</div>}
        <ul className="space-y-0.5 text-[12.5px]">
          {(floorItems.data ?? []).map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span className="font-mono">×{i.quantity}</span>
              <span className="truncate">{i.definition.name}</span>
              {mode === "play" && selectedToken && tokensHere.some((t) => t.id === selectedToken.id) && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => void play.pickUp(selectedToken.id, i.id)}>
                  <Hand size={11} /> Pick up
                </Button>
              )}
            </li>
          ))}
        </ul>
        {mode === "edit" && <InventoryPanel owner={{ owner_type: "room", owner_id: room.id }} title="Manage" compact />}
      </Section>
      {mode === "edit" && (
        <Section title="Danger zone">
          <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
            <Trash2 size={12} /> Delete room
          </Button>
        </Section>
      )}
    </div>
  );
}

// ---- door ----

function DoorInspector({ door, play }: { door: Door; play: DungeonPlay }) {
  const mode = useEditor((s) => s.mode);
  const data = useEditor((s) => s.data)!;
  const updateDoor = useEditor((s) => s.updateDoor);
  const selectedToken = selectedOfType(useEditor.getState().selection, "token", data.tokens)[0] ?? null;
  const actorId = selectedToken?.id ?? null;
  const roomName = (id: string | null) => data.rooms.find((r) => r.id === id)?.entity.name ?? "—";
  const floors = useQuery({ queryKey: ["dungeon", "floors", data.floor.dungeon_id], queryFn: () => useEditor.getState().repos!.dungeons.floors(data.floor.dungeon_id) });
  return (
    <div key={door.id} className="flex h-full flex-col overflow-y-auto">
      <Header title={`${door.kind.replace("_", " ")} (${door.orientation === "h" ? "horizontal" : "vertical"})`} badge={door.state} />
      <Section title={mode === "play" ? "Actions" : "Quick state"}>
        <div className="mb-2 text-[12px] text-ink-muted">
          Between {roomName(door.room_a)} and {roomName(door.room_b)} · at ({door.x}, {door.y}){door.lock_dc ? ` · lock DC ${door.lock_dc}` : ""}
        </div>
        {mode === "play" ? (
          <div className="flex flex-wrap gap-1">
            {door.hidden && !door.discovered && (
              <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "discover", actorId)}>
                <Eye size={12} /> Discover
              </Button>
            )}
            {door.state !== "open" && door.state !== "broken" && (
              <Button size="sm" variant="primary" onClick={() => void play.door(door.id, "open", actorId)}>
                <DoorOpen size={12} /> Open
              </Button>
            )}
            {door.state === "open" && (
              <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "close", actorId)}>
                Close
              </Button>
            )}
            {door.state === "closed" && (
              <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "lock", actorId)}>
                Lock
              </Button>
            )}
            {door.state === "locked" && (
              <>
                <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "unlock", actorId)}>
                  Unlock (key)
                </Button>
                <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "pick_lock", actorId)}>
                  Pick lock
                </Button>
              </>
            )}
            {door.state !== "open" && door.state !== "broken" && (
              <Button size="sm" variant="outline" onClick={() => void play.door(door.id, "force", actorId)}>
                Force
              </Button>
            )}
            {door.state !== "broken" && (
              <Button size="sm" variant="ghost" onClick={() => void play.door(door.id, "break", actorId)}>
                DM: break
              </Button>
            )}
            <div className="w-full text-[11px] text-ink-faint">{selectedToken ? `Acting: ${selectedToken.name}` : "No token selected — actions are not checked for adjacency or keys."}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <Select value={door.kind} onChange={(e) => void updateDoor(door.id, { kind: e.target.value as Door["kind"] })}>
                {DOOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="State">
              <Select value={door.state} onChange={(e) => void updateDoor(door.id, { state: e.target.value as Door["state"] })}>
                {DOOR_STATES.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </Field>
            <Field label="Lock DC">
              <Input type="number" value={door.lock_dc ?? ""} onChange={(e) => void updateDoor(door.id, { lock_dc: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Orientation">
              <Select value={door.orientation} onChange={(e) => void updateDoor(door.id, { orientation: e.target.value as "h" | "v" })}>
                <option value="h">horizontal (top edge)</option>
                <option value="v">vertical (left edge)</option>
              </Select>
            </Field>
            <Field label="Key item" className="col-span-2">
              <EntityPicker kinds={["item"]} value={door.key_item_id} onChange={(id) => void updateDoor(door.id, { key_item_id: id })} allowNone />
            </Field>
            {(door.kind === "stairs_up" || door.kind === "stairs_down") && (
              <Field label="Leads to floor" className="col-span-2">
                <Select value={door.target_floor_id ?? ""} onChange={(e) => void updateDoor(door.id, { target_floor_id: e.target.value || null })}>
                  <option value="">—</option>
                  {(floors.data ?? []).filter((f) => f.id !== door.floor_id).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Checkbox label="Hidden (secret)" checked={door.hidden} onChange={(v) => void updateDoor(door.id, { hidden: v, discovered: !v })} />
            <Checkbox label="Discovered" checked={door.discovered} onChange={(v) => void updateDoor(door.id, { discovered: v })} />
            <Field label="Notes" className="col-span-2">
              <Textarea rows={2} defaultValue={door.notes} onBlur={(e) => e.target.value !== door.notes && void updateDoor(door.id, { notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Section>
      {mode === "edit" && (
        <Section title="Danger zone">
          <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
            <Trash2 size={12} /> Delete door
          </Button>
        </Section>
      )}
    </div>
  );
}

// ---- object ----

function ObjectInspector({ object, play }: { object: MapObject; play: DungeonPlay }) {
  const mode = useEditor((s) => s.mode);
  const data = useEditor((s) => s.data)!;
  const updateObject = useEditor((s) => s.updateObject);
  const selectedToken = selectedOfType(useEditor.getState().selection, "token", data.tokens)[0] ?? null;
  const room = data.rooms.find((r) => r.id === object.room_id) ?? null;
  const actorInventory = useInventory(selectedToken ? tokenOwner(selectedToken) : null);
  const linked = useEntity(object.entity_id);
  const [json, setJson] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const interactions = availableInteractions({ object, room, actorInventory: actorInventory.data ?? [] });
  const isContainer = object.kind === "container" || object.kind === "bookshelf" || object.kind === "altar" || object.kind === "furniture";

  return (
    <div key={object.id} className="flex h-full flex-col overflow-y-auto">
      <Header
        title={object.name}
        badge={object.kind.replace("_", " ")}
        actions={
          <button className="text-ink-faint hover:text-ink" title={object.hidden ? "Hidden from players" : "Visible"} onClick={() => void updateObject(object.id, { hidden: !object.hidden, discovered: object.hidden })}>
            {object.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        }
      />
      <Section title={mode === "play" ? "Interactions" : "Interactions (preview)"}>
        <div className="mb-1 text-[11px] text-ink-faint">{selectedToken ? `Acting: ${selectedToken.name}` : "Select a token to act with its inventory and position."}</div>
        <div className="flex flex-wrap gap-1">
          {interactions.map(({ def, enabled, reasons }) => (
            <Button key={def.id} size="sm" variant={enabled ? "primary" : "outline"} disabled={mode !== "play" || !enabled} title={reasons.join("; ") || def.description || ""} onClick={() => void play.interact(object.id, def.id, selectedToken?.id ?? null)}>
              {def.label}
              {def.check && <span className="ml-1 text-[10px] opacity-70">DC {def.check.dc}</span>}
            </Button>
          ))}
          {interactions.length === 0 && <span className="text-[12px] text-ink-faint">No interactions defined.</span>}
        </div>
        {mode === "play" && selectedToken && (
          <div className="mt-2 flex flex-wrap gap-1">
            {object.hidden && !object.discovered && (
              <Button size="sm" variant="ghost" onClick={() => void updateObject(object.id, { hidden: false, discovered: true })}>
                DM: reveal
              </Button>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
          {Object.entries(object.state)
            .filter(([, v]) => v !== false && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
            .map(([k, v]) => (
              <Badge key={k} tone={v === true ? "moss" : "default"}>
                {k}
                {v === true ? "" : `: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`}
              </Badge>
            ))}
        </div>
      </Section>
      {isContainer && (
        <Section title="Contents">
          <InventoryPanel owner={{ owner_type: "object", owner_id: object.id }} title="Inside" compact={mode === "play"} sessionId={play.sessionId} />
        </Section>
      )}
      {linked.data && (
        <Section title="Linked record">
          <Link to={`/lore/${linked.data.id}`} className="text-[12.5px] text-ember-soft hover:underline">
            {linked.data.name}
          </Link>
          {linked.data.read_aloud_md && <MarkdownView source={linked.data.read_aloud_md} variant="read-aloud" className="mt-2" />}
        </Section>
      )}
      {mode === "edit" && (
        <>
          <Section title="Properties">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" className="col-span-2">
                <Input defaultValue={object.name} onBlur={(e) => e.target.value.trim() && e.target.value !== object.name && void updateObject(object.id, { name: e.target.value.trim() })} />
              </Field>
              <Field label="Kind">
                <Select value={object.kind} onChange={(e) => void updateObject(object.id, { kind: e.target.value as MapObject["kind"] })}>
                  {OBJECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Room">
                <Select value={object.room_id ?? ""} onChange={(e) => void updateObject(object.id, { room_id: e.target.value || null })}>
                  <option value="">—</option>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.entity.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="W">
                <Input type="number" min={1} value={object.w} onChange={(e) => void updateObject(object.id, { w: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="H">
                <Input type="number" min={1} value={object.h} onChange={(e) => void updateObject(object.id, { h: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="Rotation">
                <Input type="number" step={15} value={object.rotation} onChange={(e) => void updateObject(object.id, { rotation: Number(e.target.value) })} />
              </Field>
              <Field label="Linked entity" className="col-span-2">
                <EntityPicker kinds={["trap", "item", "article", "document", "secret", "npc"]} value={object.entity_id} onChange={(id) => void updateObject(object.id, { entity_id: id })} allowNone />
              </Field>
              <Checkbox label="Hidden" checked={object.hidden} onChange={(v) => void updateObject(object.id, { hidden: v })} />
              <Checkbox label="Discovered" checked={object.discovered} onChange={(v) => void updateObject(object.id, { discovered: v })} />
            </div>
          </Section>
          <Section title="Lock & trap">
            <div className="grid grid-cols-2 gap-2">
              <Checkbox label="Locked" checked={Boolean(object.state.locked)} onChange={(v) => void updateObject(object.id, { state: { ...object.state, locked: v } })} />
              <Checkbox label="Open" checked={Boolean(object.state.open)} onChange={(v) => void updateObject(object.id, { state: { ...object.state, open: v } })} />
              <Field label="Lock DC">
                <Input type="number" value={object.state.lock_dc ?? ""} onChange={(e) => void updateObject(object.id, { state: { ...object.state, lock_dc: e.target.value === "" ? undefined : Number(e.target.value) } })} />
              </Field>
              <Field label="Trap DC">
                <Input type="number" value={object.state.trap_dc ?? ""} onChange={(e) => void updateObject(object.id, { state: { ...object.state, trap_dc: e.target.value === "" ? undefined : Number(e.target.value) } })} />
              </Field>
              <Field label="Key item" className="col-span-2">
                <EntityPicker kinds={["item"]} value={(object.state.key_item_id as string | null) ?? null} onChange={(id) => void updateObject(object.id, { state: { ...object.state, key_item_id: id } })} allowNone />
              </Field>
              <Checkbox label="Disarmed" checked={Boolean(object.state.disarmed)} onChange={(v) => void updateObject(object.id, { state: { ...object.state, disarmed: v } })} />
              <Checkbox label="Triggered" checked={Boolean(object.state.triggered)} onChange={(v) => void updateObject(object.id, { state: { ...object.state, triggered: v } })} />
            </div>
            <div className="mt-2 flex gap-1">
              <Button size="sm" variant="outline" onClick={() => void updateObject(object.id, { interactions: defaultInteractionsFor(object.kind, object.state) })}>
                <RotateCcw size={12} /> Regenerate interactions
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void updateObject(object.id, { state: { ...object.state, searched: false, interactions_used: [], triggered: false, open: false } })}>
                Reset usage
              </Button>
            </div>
          </Section>
          <Section title="Interaction definitions (JSON)">
            <p className="mb-1 text-[11px] text-ink-faint">Each interaction has preconditions, an optional skill check and success/failure effects. Edit and blur to save.</p>
            <Textarea
              rows={10}
              className={cn("font-mono text-[11px]", jsonError && "border-blood")}
              value={json ?? JSON.stringify(object.interactions, null, 2)}
              onChange={(e) => setJson(e.target.value)}
              onBlur={() => {
                if (json === null) return;
                try {
                  const parsed = JSON.parse(json) as InteractionDefinition[];
                  if (!Array.isArray(parsed)) throw new Error("Expected an array");
                  for (const d of parsed) if (!d.id || !d.label || !Array.isArray(d.success)) throw new Error("Each interaction needs id, label and success[]");
                  setJsonError(null);
                  setJson(null);
                  void updateObject(object.id, { interactions: parsed });
                } catch (e) {
                  setJsonError((e as Error).message);
                }
              }}
            />
            {jsonError && <div className="text-[11px] text-blood">{jsonError}</div>}
          </Section>
          <Section title="Danger zone">
            <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
              <Trash2 size={12} /> Delete object
            </Button>
          </Section>
        </>
      )}
    </div>
  );
}

// ---- token ----

function RoomEncounterRow({ encounter, roomId, onStartEncounter }: { encounter: { id: string; name: string }; roomId: string; onStartEncounter: (id: string, roomId: string) => void }) {
  const hoard = useInventory({ owner_type: "hoard", owner_id: encounter.id });
  return (
    <li className="rounded border border-border px-2 py-1.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <Link to={`/encounters/${encounter.id}`} className="truncate text-ember-soft hover:underline">
          {encounter.name}
        </Link>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => onStartEncounter(encounter.id, roomId)}>
          <Swords size={12} /> Run
        </Button>
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">
        {(hoard.data ?? []).length === 0 ? "No hoard yet" : `Hoard: ${(hoard.data ?? []).map((i) => `${i.quantity}× ${i.definition.name}`).join(", ")}`}
      </div>
    </li>
  );
}

function TokenInspector({ token, play }: { token: Token; play: DungeonPlay }) {
  const mode = useEditor((s) => s.mode);
  const data = useEditor((s) => s.data)!;
  const updateToken = useEditor((s) => s.updateToken);
  const repos = useRepos();
  const qc = useQueryClient();
  const live = useQuery({ queryKey: ["encounters", "byToken", token.id], queryFn: () => repos.encounters.findCombatantByToken(token.id) });
  const liveEntity = useEntity(live.data?.entity_id ?? null);
  const inventory = useInventory(tokenOwner(token));
  const entity = useEntity(token.entity_id);
  const others = data.tokens.filter((t) => t.id !== token.id);
  const [giveTo, setGiveTo] = useState<string>("");
  const room = data.rooms.find((r) => token.x >= r.x && token.x < r.x + r.w && token.y >= r.y && token.y < r.y + r.h);
  const [cond, setCond] = useState("");
  return (
    <div key={token.id} className="flex h-full flex-col overflow-y-auto">
      <Header title={token.name} badge={token.kind} />
      {live.data && (
        <Section title="Encounter instance">
          <CombatantSheet
            combatant={live.data}
            catalogName={liveEntity.data?.name}
            catalogKind={liveEntity.data?.kind}
            editable={true}
            onChanged={(c) => {
              void qc.invalidateQueries({ queryKey: ["encounters"] });
              if (c?.token_id) void updateToken(c.token_id, { hp: c.hp, max_hp: c.max_hp, conditions: c.conditions.map((x) => x.name) });
            }}
          />
        </Section>
      )}
      <Section title="Status">
        <div className="grid grid-cols-4 gap-2">
          <Field label="HP">
            <Input type="number" value={token.hp ?? ""} onChange={(e) => void updateToken(token.id, { hp: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Max">
            <Input type="number" value={token.max_hp ?? ""} onChange={(e) => void updateToken(token.id, { max_hp: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Speed">
            <Input type="number" value={token.speed} onChange={(e) => void updateToken(token.id, { speed: Number(e.target.value) })} />
          </Field>
          <Field label="Moved">
            <Input type="number" value={token.movement_used} onChange={(e) => void updateToken(token.id, { movement_used: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {token.conditions.map((c) => (
            <button key={c} className="chip hover:border-blood hover:text-blood" onClick={() => void updateToken(token.id, { conditions: token.conditions.filter((x) => x !== c) })} title="Remove">
              {c} ×
            </button>
          ))}
          <Select value={cond} onChange={(e) => { if (e.target.value) { void updateToken(token.id, { conditions: [...new Set([...token.conditions, e.target.value])] }); setCond(""); } }} className="h-6 w-32 text-[11px]">
            <option value="">+ condition</option>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => void updateToken(token.id, { movement_used: 0 })}>
            Reset movement
          </Button>
          <Button size="sm" variant="outline" onClick={() => void repos.dungeons.resetMovement(token.floor_id).then(() => useEditor.getState().refresh())}>
            New round (all)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void updateToken(token.id, { hidden: !token.hidden })}>
            {token.hidden ? "Unhide" : "Hide"}
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-ink-faint">
          At ({token.x}, {token.y}){room ? ` in ${room.entity.name}` : ""} · {token.movement_used}/{token.speed} ft used
        </div>
      </Section>
      {entity.data && (
        <Section title="Record">
          <Link to={`/${entity.data.kind === "creature" ? "creatures" : "characters"}/${entity.data.id}`} className="text-[12.5px] text-ember-soft hover:underline">
            {entity.data.name}
          </Link>
          <div className="text-[11.5px] text-ink-muted">
            AC {String(entity.data.fields.ac ?? "?")} · {String(entity.data.fields.race ?? entity.data.fields.type ?? "")} {String(entity.data.fields.class ?? "")}
          </div>
        </Section>
      )}
      <Section title="Inventory">
        {(inventory.data ?? []).length === 0 && <div className="text-[12px] text-ink-faint">Carrying nothing.</div>}
        <ul className="space-y-1 text-[12.5px]">
          {(inventory.data ?? []).map((i) => (
            <li key={i.id} className="rounded border border-border p-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono">×{i.quantity}</span>
                <Link to={`/items/${i.definition.id}`} className="truncate text-ember-soft hover:underline">
                  {i.definition.name}
                </Link>
                {i.state.equipped === true && <Badge tone="moss">equipped</Badge>}
                {typeof i.state.charges === "number" && <Badge tone="gold">{i.state.charges} ch.</Badge>}
              </div>
              {mode === "play" && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => void play.itemAction(token.id, i.id, i.state.equipped ? "unequip" : "equip")}>
                    {i.state.equipped ? "Unequip" : "Equip"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void play.itemAction(token.id, i.id, "use")}>
                    Use
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void play.itemAction(token.id, i.id, "drop")}>
                    Drop
                  </Button>
                  {others.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Select value={giveTo} onChange={(e) => setGiveTo(e.target.value)} className="h-6 w-28 text-[11px]">
                        <option value="">Give to…</option>
                        {others.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="outline" disabled={!giveTo} onClick={() => void play.itemAction(token.id, i.id, "give", giveTo)}>
                        Give
                      </Button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {mode === "edit" && <InventoryPanel owner={tokenOwner(token)} title="Manage" compact />}
      </Section>
      {mode === "edit" && (
        <Section title="Token">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" className="col-span-2">
              <Input defaultValue={token.name} onBlur={(e) => e.target.value.trim() && e.target.value !== token.name && void updateToken(token.id, { name: e.target.value.trim() })} />
            </Field>
            <Field label="Size">
              <Input type="number" min={1} max={4} value={token.size} onChange={(e) => void updateToken(token.id, { size: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field label="Color">
              <input type="color" value={token.color ?? "#888888"} onChange={(e) => void updateToken(token.id, { color: e.target.value })} className="h-8 w-full rounded border border-border bg-bg" />
            </Field>
            <Field label="Represents" className="col-span-2">
              <EntityPicker kinds={["pc", "npc", "creature"]} value={token.entity_id} onChange={(id) => void updateToken(token.id, { entity_id: id })} allowNone />
            </Field>
          </div>
          <Button size="sm" variant="danger" className="mt-2" onClick={() => void useEditor.getState().deleteSelection()}>
            <Trash2 size={12} /> Remove token
          </Button>
        </Section>
      )}
    </div>
  );
}

// ---- marker ----

function MarkerInspector({ marker, onStartEncounter }: { marker: MapMarker; onStartEncounter: (id: string, roomId: string | null) => void }) {
  const mode = useEditor((s) => s.mode);
  const data = useEditor((s) => s.data)!;
  const updateMarker = useEditor((s) => s.updateMarker);
  const repos = useRepos();
  const encounter = useEntity(marker.encounter_id);
  const linked = useEntity(marker.entity_id);
  const refOptions =
    marker.trigger === "enter_room"
      ? data.rooms.map((r) => ({ id: r.id, label: r.entity.name }))
      : marker.trigger === "open_door"
        ? data.doors.map((d) => ({ id: d.id, label: `${d.kind} at (${d.x}, ${d.y})` }))
        : marker.trigger === "interact_object" || marker.trigger === "step_trap"
          ? data.objects.map((o) => ({ id: o.id, label: o.name }))
          : [];
  return (
    <div key={marker.id} className="flex h-full flex-col overflow-y-auto">
      <Header title={marker.title} badge={marker.kind} actions={marker.activated ? <Badge tone="ember">triggered ×{marker.activation_count}</Badge> : undefined} />
      <Section title="Content">
        <MarkdownView source={marker.body_md} />
        {linked.data && (
          <div className="mt-2 text-[12.5px]">
            Linked: <Link to={`/lore/${linked.data.id}`} className="text-ember-soft hover:underline">{linked.data.name}</Link>
          </div>
        )}
        {encounter.data && (
          <div className="mt-2 flex items-center gap-2 text-[12.5px]">
            <Link to={`/encounters/${encounter.data.id}`} className="text-ember-soft hover:underline">
              {encounter.data.name}
            </Link>
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => onStartEncounter(encounter.data!.id, marker.room_id)}>
              <Swords size={12} /> Run encounter
            </Button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {!marker.activated ? (
            <Button size="sm" variant="outline" onClick={() => void repos.dungeons.activateMarker(marker.id).then(() => useEditor.getState().refresh())}>
              Trigger manually
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void repos.dungeons.resetMarker(marker.id).then(() => useEditor.getState().refresh())}>
              <RotateCcw size={12} /> Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void updateMarker(marker.id, { enabled: !marker.enabled })}>
            {marker.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </Section>
      {mode === "edit" && (
        <>
          <Section title="Marker">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Title" className="col-span-2">
                <Input defaultValue={marker.title} onBlur={(e) => e.target.value.trim() && e.target.value !== marker.title && void updateMarker(marker.id, { title: e.target.value.trim() })} />
              </Field>
              <Field label="Kind">
                <Select value={marker.kind} onChange={(e) => void updateMarker(marker.id, { kind: e.target.value as MapMarker["kind"] })}>
                  {MARKER_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Trigger">
                <Select value={marker.trigger} onChange={(e) => void updateMarker(marker.id, { trigger: e.target.value as MapMarker["trigger"], trigger_ref: null })}>
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              {refOptions.length > 0 && (
                <Field label="Trigger target" className="col-span-2">
                  <Select value={marker.trigger_ref ?? ""} onChange={(e) => void updateMarker(marker.id, { trigger_ref: e.target.value || null })}>
                    <option value="">—</option>
                    {refOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {marker.trigger === "enter_area" && (
                <>
                  <Field label="Area W">
                    <Input type="number" min={1} value={marker.w} onChange={(e) => void updateMarker(marker.id, { w: Math.max(1, Number(e.target.value)) })} />
                  </Field>
                  <Field label="Area H">
                    <Input type="number" min={1} value={marker.h} onChange={(e) => void updateMarker(marker.id, { h: Math.max(1, Number(e.target.value)) })} />
                  </Field>
                </>
              )}
              <Field label="Encounter" className="col-span-2">
                <EntityPicker kinds={["encounter"]} value={marker.encounter_id} onChange={(id) => void updateMarker(marker.id, { encounter_id: id })} allowNone />
              </Field>
              <Field label="Linked entity" className="col-span-2">
                <EntityPicker kinds={["npc", "secret", "article", "document", "trap", "item", "quest", "event"]} value={marker.entity_id} onChange={(id) => void updateMarker(marker.id, { entity_id: id })} allowNone />
              </Field>
              <Field label="Room">
                <Select value={marker.room_id ?? ""} onChange={(e) => void updateMarker(marker.id, { room_id: e.target.value || null })}>
                  <option value="">—</option>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.entity.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox label="DM only" checked={marker.dm_only} onChange={(v) => void updateMarker(marker.id, { dm_only: v })} className="mt-5" />
              <Field label="Text (Markdown)" className="col-span-2">
                <Textarea rows={5} defaultValue={marker.body_md} onBlur={(e) => e.target.value !== marker.body_md && void updateMarker(marker.id, { body_md: e.target.value })} />
              </Field>
            </div>
          </Section>
          <Section title="Danger zone">
            <Button size="sm" variant="danger" onClick={() => void useEditor.getState().deleteSelection()}>
              <Trash2 size={12} /> Delete marker
            </Button>
          </Section>
        </>
      )}
    </div>
  );
}
