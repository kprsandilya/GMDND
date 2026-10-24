import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  MapPin,
  Plus,
  Route,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepos } from "@/app/appContext";
import { qk, useAction, useEntities } from "@/app/queries";
import { EntityPicker } from "@/components/EntityPicker";
import {
  Button,
  Dialog,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import {
  JOURNEY_CATEGORIES,
  JOURNEY_CATEGORY_LABELS,
  ROUTE_CERTAINTIES,
  ROUTE_CERTAINTY_LABELS,
  SEGMENT_CERTAINTIES,
  SEGMENT_CERTAINTY_LABELS,
} from "@/domain/journeyTypes";
import type {
  Journey,
  JourneyCategory,
  JourneyInput,
  RouteCertainty,
  SegmentCertainty,
  SegmentParticipant,
  TravelSegment,
  Waypoint,
} from "@/domain/journeyTypes";
import { GEOGRAPHIC_KINDS, KIND_LABELS, type EntityKind } from "@/domain/types";

// ── Query key helpers ──

const journeyKeys = {
  all: ["journeys"] as const,
  segments: (journeyId: string) => ["journeys", "segments", journeyId] as const,
  participants: (segmentId: string) => ["journeys", "participants", segmentId] as const,
};

// ── Invalidation keys for anything journey-related ──

const JOURNEY_INVALIDATION: readonly (readonly unknown[])[] = [
  journeyKeys.all,
  ["entities"],
];

// ── Props ──

export interface JourneyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For editing an existing journey. */
  journeyId?: string;
  /** Pre-fill session_id when creating from a session page. */
  defaultSessionId?: string;
  /** Pre-fill party_id when creating from a party page. */
  defaultPartyId?: string;
  /** Campaign scope (required). */
  campaignId: string;
}

// ── Form state ──

interface JourneyFormState {
  name: string;
  category: JourneyCategory;
  route_certainty: RouteCertainty;
  description: string;
  dm_notes: string;
  session_id: string | null;
  party_id: string | null;
  start_year: string;
  start_month: string;
  start_day: string;
  end_year: string;
  end_month: string;
  end_day: string;
}

const emptyForm = (defaults?: {
  sessionId?: string;
  partyId?: string;
}): JourneyFormState => ({
  name: "",
  category: "campaign",
  route_certainty: "known",
  description: "",
  dm_notes: "",
  session_id: defaults?.sessionId ?? null,
  party_id: defaults?.partyId ?? null,
  start_year: "",
  start_month: "",
  start_day: "",
  end_year: "",
  end_month: "",
  end_day: "",
});

function journeyToForm(j: Journey): JourneyFormState {
  return {
    name: j.name,
    category: j.category,
    route_certainty: j.route_certainty,
    description: j.description,
    dm_notes: j.dm_notes,
    session_id: j.session_id,
    party_id: j.party_id,
    start_year: j.start_year != null ? String(j.start_year) : "",
    start_month: j.start_month != null ? String(j.start_month) : "",
    start_day: j.start_day != null ? String(j.start_day) : "",
    end_year: j.end_year != null ? String(j.end_year) : "",
    end_month: j.end_month != null ? String(j.end_month) : "",
    end_day: j.end_day != null ? String(j.end_day) : "",
  };
}

function formToInput(form: JourneyFormState, campaignId: string): JourneyInput {
  const intOrNull = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };
  return {
    campaign_id: campaignId,
    name: form.name.trim(),
    category: form.category,
    route_certainty: form.route_certainty,
    description: form.description,
    dm_notes: form.dm_notes,
    session_id: form.session_id,
    party_id: form.party_id,
    start_year: intOrNull(form.start_year),
    start_month: intOrNull(form.start_month),
    start_day: intOrNull(form.start_day),
    end_year: intOrNull(form.end_year),
    end_month: intOrNull(form.end_month),
    end_day: intOrNull(form.end_day),
    sort_order: 0,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Journey Editor Dialog ──
// ══════════════════════════════════════════════════════════════════════════════

export function JourneyEditor({
  open,
  onOpenChange,
  journeyId,
  defaultSessionId,
  defaultPartyId,
  campaignId,
}: JourneyEditorProps) {
  const repos = useRepos();
  const isEdit = !!journeyId;

  // ── Fetch existing journey when editing ──
  const existing = useQuery({
    queryKey: ["journeys", "one", journeyId],
    queryFn: () => repos.journeys.getJourney(journeyId!),
    enabled: isEdit && open,
  });

  // ── Form state ──
  const [form, setForm] = useState<JourneyFormState>(() =>
    emptyForm({ sessionId: defaultSessionId, partyId: defaultPartyId }),
  );
  const patch = useCallback(
    (delta: Partial<JourneyFormState>) => setForm((prev) => ({ ...prev, ...delta })),
    [],
  );

  // Reset form when dialog opens or journey data loads
  useEffect(() => {
    if (!open) return;
    if (isEdit && existing.data) {
      setForm(journeyToForm(existing.data));
    } else if (!isEdit) {
      setForm(emptyForm({ sessionId: defaultSessionId, partyId: defaultPartyId }));
    }
  }, [open, isEdit, existing.data, defaultSessionId, defaultPartyId]);

  // ── The saved journey id (for segment management after creation) ──
  const [savedJourneyId, setSavedJourneyId] = useState<string | null>(journeyId ?? null);
  useEffect(() => {
    if (open) setSavedJourneyId(journeyId ?? null);
  }, [open, journeyId]);

  // ── Save journey ──
  const saveJourney = useAction(
    async () => {
      const input = formToInput(form, campaignId);
      if (isEdit && journeyId) {
        const { campaign_id: _cid, ...rest } = input;
        return repos.journeys.updateJourney(journeyId, rest);
      }
      return repos.journeys.createJourney(input);
    },
    {
      success: isEdit ? "Journey updated" : "Journey created",
      invalidate: JOURNEY_INVALIDATION,
      onSuccess: (j) => {
        setSavedJourneyId(j.id);
      },
    },
  );

  const isValid = form.name.trim().length > 0;

  // Once a journey is saved, show the segment editor
  const activeJourneyId = savedJourneyId ?? journeyId ?? null;

  if (isEdit && existing.isLoading && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="Edit Journey" width="max-w-2xl">
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit Journey" : "New Journey"}
      description="Define the journey details, then add travel segments and participants."
      width="max-w-2xl"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!isValid || saveJourney.isPending}
            onClick={() => saveJourney.mutate(undefined as never)}
          >
            {saveJourney.isPending ? <Spinner /> : null}
            {isEdit ? "Update Journey" : "Create Journey"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ── Journey Fields ── */}
        <JourneyFormFields form={form} patch={patch} campaignId={campaignId} />

        {/* ── Segments ── */}
        {activeJourneyId && (
          <div className="border-t border-border pt-4">
            <SegmentManager journeyId={activeJourneyId} campaignId={campaignId} isBackstory={form.category === "backstory"} />
          </div>
        )}

        {!activeJourneyId && (
          <p className="text-[12px] text-ink-faint">
            Save the journey first to add travel segments.
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Journey Form Fields ──
// ══════════════════════════════════════════════════════════════════════════════

function JourneyFormFields({
  form,
  patch,
  campaignId,
}: {
  form: JourneyFormState;
  patch: (delta: Partial<JourneyFormState>) => void;
  campaignId: string;
}) {
  return (
    <div className="space-y-3">
      {/* Name */}
      <Field label="Name" hint="1–200 characters">
        <Input
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Journey name"
          maxLength={200}
          required
        />
      </Field>

      {/* Category + Route Certainty */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select
            value={form.category}
            onChange={(e) => patch({ category: e.target.value as JourneyCategory })}
          >
            {JOURNEY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {JOURNEY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Route Certainty">
          <Select
            value={form.route_certainty}
            onChange={(e) => patch({ route_certainty: e.target.value as RouteCertainty })}
          >
            {ROUTE_CERTAINTIES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_CERTAINTY_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Session + Party pickers */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Session (optional)">
          <EntityPicker
            kinds={["session"]}
            value={form.session_id}
            onChange={(id) => patch({ session_id: id })}
            allowNone
            placeholder="No session"
          />
        </Field>
        <Field label="Party (optional)">
          <EntityPicker
            kinds={["party"]}
            value={form.party_id}
            onChange={(id) => patch({ party_id: id })}
            allowNone
            placeholder="No party"
          />
        </Field>
      </div>

      {/* Date Range */}
      <div className="space-y-1">
        <span className="label">Date Range (optional)</span>
        <div className="grid grid-cols-6 gap-2">
          <Field label="Start Year">
            <Input
              type="number"
              value={form.start_year}
              onChange={(e) => patch({ start_year: e.target.value })}
              placeholder="Year"
            />
          </Field>
          <Field label="Month">
            <Input
              type="number"
              value={form.start_month}
              onChange={(e) => patch({ start_month: e.target.value })}
              placeholder="Mo"
              min={1}
              max={12}
            />
          </Field>
          <Field label="Day">
            <Input
              type="number"
              value={form.start_day}
              onChange={(e) => patch({ start_day: e.target.value })}
              placeholder="Day"
              min={1}
              max={31}
            />
          </Field>
          <Field label="End Year">
            <Input
              type="number"
              value={form.end_year}
              onChange={(e) => patch({ end_year: e.target.value })}
              placeholder="Year"
            />
          </Field>
          <Field label="Month">
            <Input
              type="number"
              value={form.end_month}
              onChange={(e) => patch({ end_month: e.target.value })}
              placeholder="Mo"
              min={1}
              max={12}
            />
          </Field>
          <Field label="Day">
            <Input
              type="number"
              value={form.end_day}
              onChange={(e) => patch({ end_day: e.target.value })}
              placeholder="Day"
              min={1}
              max={31}
            />
          </Field>
        </div>
      </div>

      {/* Description */}
      <Field label="Description" hint="Optional, max 5000 characters">
        <Textarea
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="A brief description of the journey…"
          maxLength={5000}
          rows={2}
        />
      </Field>

      {/* DM Notes */}
      <Field label="DM Notes" hint="Optional, max 5000 characters">
        <Textarea
          value={form.dm_notes}
          onChange={(e) => patch({ dm_notes: e.target.value })}
          placeholder="Private DM notes…"
          maxLength={5000}
          rows={2}
        />
      </Field>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Segment Manager ──
// ══════════════════════════════════════════════════════════════════════════════

function SegmentManager({
  journeyId,
  campaignId,
  isBackstory,
}: {
  journeyId: string;
  campaignId: string;
  isBackstory: boolean;
}) {
  const repos = useRepos();

  // Fetch segments for this journey
  const segmentsQuery = useQuery({
    queryKey: journeyKeys.segments(journeyId),
    queryFn: () => repos.journeys.listSegments(journeyId),
  });
  const segments = segmentsQuery.data ?? [];

  // ── Add segment ──
  const addSegment = useAction(
    async () => {
      return repos.journeys.createSegment({
        journey_id: journeyId,
        origin_entity_id: null,
        destination_entity_id: null,
        waypoints: [],
        start_year: null,
        start_month: null,
        start_day: null,
        end_year: null,
        end_month: null,
        end_day: null,
        route_certainty: "confirmed",
        notes: "",
      });
    },
    {
      success: "Segment added",
      invalidate: [journeyKeys.segments(journeyId), ...JOURNEY_INVALIDATION],
    },
  );

  // ── Delete segment ──
  const deleteSegment = useAction(
    (id: string) => repos.journeys.deleteSegment(id),
    {
      success: "Segment removed",
      invalidate: [journeyKeys.segments(journeyId), ...JOURNEY_INVALIDATION],
    },
  );

  // ── Reorder segments ──
  const reorder = useAction(
    (orderedIds: string[]) => repos.journeys.reorderSegments(journeyId, orderedIds),
    {
      invalidate: [journeyKeys.segments(journeyId), ...JOURNEY_INVALIDATION],
    },
  );

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const ids = segments.map((s) => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorder.mutate(ids);
  };

  const moveDown = (index: number) => {
    if (index >= segments.length - 1) return;
    const ids = segments.map((s) => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorder.mutate(ids);
  };

  // ── Expanded segment editing ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Travel Segments
        </h4>
        <Button
          size="sm"
          variant="outline"
          onClick={() => addSegment.mutate(undefined as never)}
          disabled={addSegment.isPending}
        >
          <Plus size={12} /> Add Segment
        </Button>
      </div>

      {segments.length === 0 && (
        <p className="text-[12px] text-ink-faint">
          No travel segments yet. Add one to start building the route.
        </p>
      )}

      <ul className="space-y-2">
        {segments.map((seg, idx) => (
          <li key={seg.id} className="rounded border border-border bg-bg p-2">
            {/* Segment header */}
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] font-semibold text-ink-faint">
                #{idx + 1}
              </span>
              <button
                type="button"
                className="flex-1 truncate text-left text-[12.5px] text-ink hover:text-ember-soft"
                onClick={() =>
                  setExpandedId(expandedId === seg.id ? null : seg.id)
                }
              >
                <SegmentSummary segment={seg} />
              </button>
              <Button
                size="icon"
                variant="ghost"
                disabled={idx === 0}
                onClick={() => moveUp(idx)}
                aria-label="Move up"
              >
                <ArrowUp size={12} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={idx === segments.length - 1}
                onClick={() => moveDown(idx)}
                aria-label="Move down"
              >
                <ArrowDown size={12} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => deleteSegment.mutate(seg.id)}
                aria-label="Delete segment"
              >
                <Trash2 size={12} />
              </Button>
            </div>

            {/* Expanded segment editor */}
            {expandedId === seg.id && (
              <div className="mt-2 border-t border-border pt-2">
                <SegmentEditor
                  segment={seg}
                  journeyId={journeyId}
                  campaignId={campaignId}
                  isBackstory={isBackstory}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Short summary line for a collapsed segment. */
function SegmentSummary({ segment }: { segment: TravelSegment }) {
  const repos = useRepos();
  const origin = useQuery({
    queryKey: qk.entity(segment.origin_entity_id),
    queryFn: () => repos.entities.find(segment.origin_entity_id),
    enabled: !!segment.origin_entity_id,
  });
  const dest = useQuery({
    queryKey: qk.entity(segment.destination_entity_id),
    queryFn: () => repos.entities.find(segment.destination_entity_id),
    enabled: !!segment.destination_entity_id,
  });
  const originName = origin.data?.name ?? (segment.origin_entity_id ? "…" : "?");
  const destName = dest.data?.name ?? (segment.destination_entity_id ? "…" : "?");
  return (
    <span>
      <Route size={11} className="mr-1 inline text-ink-faint" />
      {originName} → {destName}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Segment Editor ──
// ══════════════════════════════════════════════════════════════════════════════

function SegmentEditor({
  segment,
  journeyId,
  campaignId,
  isBackstory,
}: {
  segment: TravelSegment;
  journeyId: string;
  campaignId: string;
  isBackstory: boolean;
}) {
  const repos = useRepos();

  // ── Update segment ──
  const updateSegment = useAction(
    (patch: Partial<TravelSegment>) => repos.journeys.updateSegment(segment.id, patch),
    {
      invalidate: [journeyKeys.segments(journeyId), ...JOURNEY_INVALIDATION],
    },
  );

  // Local state for notes (debounced save on blur)
  const [notes, setNotes] = useState(segment.notes);
  useEffect(() => {
    setNotes(segment.notes);
  }, [segment.notes]);

  // Local state for date fields
  const [dates, setDates] = useState({
    start_year: segment.start_year != null ? String(segment.start_year) : "",
    start_month: segment.start_month != null ? String(segment.start_month) : "",
    start_day: segment.start_day != null ? String(segment.start_day) : "",
    end_year: segment.end_year != null ? String(segment.end_year) : "",
    end_month: segment.end_month != null ? String(segment.end_month) : "",
    end_day: segment.end_day != null ? String(segment.end_day) : "",
  });
  useEffect(() => {
    setDates({
      start_year: segment.start_year != null ? String(segment.start_year) : "",
      start_month: segment.start_month != null ? String(segment.start_month) : "",
      start_day: segment.start_day != null ? String(segment.start_day) : "",
      end_year: segment.end_year != null ? String(segment.end_year) : "",
      end_month: segment.end_month != null ? String(segment.end_month) : "",
      end_day: segment.end_day != null ? String(segment.end_day) : "",
    });
  }, [segment]);

  const intOrNull = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };

  const saveDates = () => {
    updateSegment.mutate({
      start_year: intOrNull(dates.start_year),
      start_month: intOrNull(dates.start_month),
      start_day: intOrNull(dates.start_day),
      end_year: intOrNull(dates.end_year),
      end_month: intOrNull(dates.end_month),
      end_day: intOrNull(dates.end_day),
    });
  };

  return (
    <div className="space-y-3">
      {/* Origin / Destination */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Origin">
          <LocationPickerWithCreate
            value={segment.origin_entity_id}
            onChange={(id) => updateSegment.mutate({ origin_entity_id: id })}
            campaignId={campaignId}
            isBackstory={isBackstory}
          />
        </Field>
        <Field label="Destination">
          <LocationPickerWithCreate
            value={segment.destination_entity_id}
            onChange={(id) => updateSegment.mutate({ destination_entity_id: id })}
            campaignId={campaignId}
            isBackstory={isBackstory}
          />
        </Field>
      </div>

      {/* Waypoints */}
      <WaypointEditor
        waypoints={segment.waypoints}
        onUpdate={(wp) => updateSegment.mutate({ waypoints: wp })}
        campaignId={campaignId}
        isBackstory={isBackstory}
      />

      {/* Route Certainty */}
      <Field label="Segment Certainty">
        <Select
          value={segment.route_certainty}
          onChange={(e) =>
            updateSegment.mutate({ route_certainty: e.target.value as SegmentCertainty })
          }
        >
          {SEGMENT_CERTAINTIES.map((c) => (
            <option key={c} value={c}>
              {SEGMENT_CERTAINTY_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>

      {/* Segment Dates */}
      <div className="space-y-1">
        <span className="label">Segment Dates (optional)</span>
        <div className="grid grid-cols-6 gap-2">
          <Field label="Start Y">
            <Input
              type="number"
              value={dates.start_year}
              onChange={(e) => setDates((d) => ({ ...d, start_year: e.target.value }))}
              onBlur={saveDates}
              placeholder="Year"
            />
          </Field>
          <Field label="M">
            <Input
              type="number"
              value={dates.start_month}
              onChange={(e) => setDates((d) => ({ ...d, start_month: e.target.value }))}
              onBlur={saveDates}
              placeholder="Mo"
              min={1}
              max={12}
            />
          </Field>
          <Field label="D">
            <Input
              type="number"
              value={dates.start_day}
              onChange={(e) => setDates((d) => ({ ...d, start_day: e.target.value }))}
              onBlur={saveDates}
              placeholder="Day"
              min={1}
              max={31}
            />
          </Field>
          <Field label="End Y">
            <Input
              type="number"
              value={dates.end_year}
              onChange={(e) => setDates((d) => ({ ...d, end_year: e.target.value }))}
              onBlur={saveDates}
              placeholder="Year"
            />
          </Field>
          <Field label="M">
            <Input
              type="number"
              value={dates.end_month}
              onChange={(e) => setDates((d) => ({ ...d, end_month: e.target.value }))}
              onBlur={saveDates}
              placeholder="Mo"
              min={1}
              max={12}
            />
          </Field>
          <Field label="D">
            <Input
              type="number"
              value={dates.end_day}
              onChange={(e) => setDates((d) => ({ ...d, end_day: e.target.value }))}
              onBlur={saveDates}
              placeholder="Day"
              min={1}
              max={31}
            />
          </Field>
        </div>
      </div>

      {/* Notes */}
      <Field label="Notes" hint="Max 5000 characters">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== segment.notes) updateSegment.mutate({ notes });
          }}
          placeholder="Segment notes…"
          maxLength={5000}
          rows={2}
        />
      </Field>

      {/* Participants */}
      <ParticipantManager segmentId={segment.id} journeyId={journeyId} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Waypoint Editor ──
// ══════════════════════════════════════════════════════════════════════════════

function WaypointEditor({
  waypoints,
  onUpdate,
  campaignId,
  isBackstory,
}: {
  waypoints: Waypoint[];
  onUpdate: (waypoints: Waypoint[]) => void;
  campaignId: string;
  isBackstory: boolean;
}) {
  const addWaypoint = () => {
    if (waypoints.length >= 50) return;
    onUpdate([...waypoints, { entity_id: null }]);
  };

  const removeWaypoint = (index: number) => {
    onUpdate(waypoints.filter((_, i) => i !== index));
  };

  const updateWaypoint = (index: number, entityId: string | null) => {
    const updated = [...waypoints];
    updated[index] = { ...updated[index], entity_id: entityId };
    onUpdate(updated);
  };

  const moveWaypointUp = (index: number) => {
    if (index <= 0) return;
    const updated = [...waypoints];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onUpdate(updated);
  };

  const moveWaypointDown = (index: number) => {
    if (index >= waypoints.length - 1) return;
    const updated = [...waypoints];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onUpdate(updated);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="label">Waypoints ({waypoints.length}/50)</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={addWaypoint}
          disabled={waypoints.length >= 50}
        >
          <Plus size={11} /> Add
        </Button>
      </div>
      {waypoints.length > 0 && (
        <ul className="space-y-1">
          {waypoints.map((wp, i) => (
            <li key={i} className="flex items-center gap-1">
              <span className="shrink-0 text-[10px] text-ink-faint">#{i + 1}</span>
              <div className="flex-1">
                <LocationPickerWithCreate
                  value={wp.entity_id}
                  onChange={(id) => updateWaypoint(i, id)}
                  campaignId={campaignId}
                  isBackstory={isBackstory}
                />
              </div>
              <Button size="icon" variant="ghost" onClick={() => moveWaypointUp(i)} disabled={i === 0} aria-label="Move waypoint up">
                <ArrowUp size={10} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => moveWaypointDown(i)} disabled={i === waypoints.length - 1} aria-label="Move waypoint down">
                <ArrowDown size={10} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => removeWaypoint(i)} aria-label="Remove waypoint">
                <X size={10} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Location Picker with Inline Create ──
// ══════════════════════════════════════════════════════════════════════════════

function LocationPickerWithCreate({
  value,
  onChange,
  campaignId,
  isBackstory,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  campaignId: string;
  isBackstory: boolean;
}) {
  const repos = useRepos();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<EntityKind>("location");

  // Check for duplicate names (Req 13.6)
  const existingLocations = useEntities({ kinds: GEOGRAPHIC_KINDS });
  const duplicates = useMemo(() => {
    if (!newName.trim()) return [];
    const lc = newName.trim().toLowerCase();
    return (existingLocations.data ?? []).filter(
      (e) => e.name.toLowerCase() === lc,
    );
  }, [existingLocations.data, newName]);

  const createLocation = useAction(
    async () => {
      const entity = await repos.entities.create({
        campaign_id: campaignId,
        kind: newKind,
        name: newName.trim(),
        summary: "",
        body_md: "",
        read_aloud_md: "",
        dm_notes_md: "",
        secret_md: "",
        tags: [],
        fields: {},
        status: null,
        sort_order: 0,
      });
      return entity;
    },
    {
      success: "Location created",
      invalidate: [["entities"]],
      onSuccess: (entity) => {
        onChange(entity.id);
        setShowCreate(false);
        setNewName("");
      },
    },
  );

  return (
    <div className="space-y-1">
      <EntityPicker
        kinds={GEOGRAPHIC_KINDS}
        value={value}
        onChange={(id) => onChange(id)}
        allowNone
        placeholder="Select location…"
      />
      {isBackstory && (
        <>
          {!showCreate && (
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
              <MapPin size={11} /> Create new location
            </Button>
          )}
          {showCreate && (
            <div className="rounded border border-border bg-bg-elevated p-2 space-y-2">
              <Field label="Location Name">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New location name"
                  autoFocus
                />
              </Field>

              {/* Duplicate detection */}
              {duplicates.length > 0 && (
                <div className="rounded border border-ember/30 bg-ember/5 p-2 text-[11px]">
                  <p className="mb-1 font-semibold text-ember-soft">
                    Similar locations already exist:
                  </p>
                  <ul className="space-y-0.5">
                    {duplicates.map((dup) => (
                      <li key={dup.id} className="flex items-center justify-between">
                        <span>
                          {dup.name}{" "}
                          <span className="text-ink-faint">
                            ({KIND_LABELS[dup.kind]})
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onChange(dup.id);
                            setShowCreate(false);
                            setNewName("");
                          }}
                        >
                          Link existing
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Field label="Kind">
                <Select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as EntityKind)}
                >
                  {GEOGRAPHIC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!newName.trim() || createLocation.isPending}
                  onClick={() => createLocation.mutate(undefined as never)}
                >
                  {createLocation.isPending ? <Spinner /> : <Plus size={11} />}
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Participant Manager ──
// ══════════════════════════════════════════════════════════════════════════════

function ParticipantManager({
  segmentId,
  journeyId,
}: {
  segmentId: string;
  journeyId: string;
}) {
  const repos = useRepos();
  const [addingEntity, setAddingEntity] = useState<string | null>(null);
  const [addingRole, setAddingRole] = useState("traveler");

  // Fetch participants for this segment
  const participantsQuery = useQuery({
    queryKey: journeyKeys.participants(segmentId),
    queryFn: () => repos.journeys.participantsForSegment(segmentId),
  });
  const participants = participantsQuery.data ?? [];

  // Fetch entity names for display
  const entityIds = participants.map((p) => p.entity_id);
  const entities = useQuery({
    queryKey: ["entities", "many", ...entityIds],
    queryFn: () => repos.entities.getMany(entityIds),
    enabled: entityIds.length > 0,
  });
  const entityMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities.data ?? []) m.set(e.id, e.name);
    return m;
  }, [entities.data]);

  // Already-added entity IDs to exclude from picker
  const excludeIds = useMemo(() => participants.map((p) => p.entity_id), [participants]);

  // ── Add participant ──
  const addParticipant = useAction(
    async () => {
      if (!addingEntity) throw new Error("Select a character first");
      return repos.journeys.addParticipant({
        segment_id: segmentId,
        entity_id: addingEntity,
        role: addingRole.trim() || "traveler",
        notes: "",
      });
    },
    {
      success: "Participant added",
      invalidate: [
        journeyKeys.participants(segmentId),
        journeyKeys.segments(journeyId),
        ...JOURNEY_INVALIDATION,
      ],
      onSuccess: () => {
        setAddingEntity(null);
        setAddingRole("traveler");
      },
    },
  );

  // ── Remove participant ──
  const removeParticipant = useAction(
    (id: string) => repos.journeys.removeParticipant(id),
    {
      success: "Participant removed",
      invalidate: [
        journeyKeys.participants(segmentId),
        journeyKeys.segments(journeyId),
        ...JOURNEY_INVALIDATION,
      ],
    },
  );

  return (
    <div className="space-y-2">
      <h5 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Users size={11} className="mr-1 inline" />
        Participants
      </h5>

      {/* Existing participants */}
      {participants.length > 0 && (
        <ul className="space-y-1">
          {participants.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border border-border px-2 py-1 text-[12px]"
            >
              <span>
                <span className="font-medium">
                  {entityMap.get(p.entity_id) ?? "…"}
                </span>
                {p.role && p.role !== "traveler" && (
                  <span className="ml-1.5 text-ink-faint">({p.role})</span>
                )}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeParticipant.mutate(p.id)}
                aria-label="Remove participant"
              >
                <X size={11} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {participants.length === 0 && (
        <p className="text-[11px] text-ink-faint">No participants on this segment.</p>
      )}

      {/* Add participant controls */}
      <div className="flex items-end gap-2">
        <Field label="Character" className="flex-1">
          <EntityPicker
            kinds={["pc", "npc"]}
            value={addingEntity}
            onChange={(id) => setAddingEntity(id)}
            placeholder="Select character…"
            exclude={excludeIds}
          />
        </Field>
        <Field label="Role" className="w-28">
          <Input
            value={addingRole}
            onChange={(e) => setAddingRole(e.target.value)}
            placeholder="traveler"
            maxLength={64}
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={!addingEntity || addParticipant.isPending}
          onClick={() => addParticipant.mutate(undefined as never)}
          className="mb-0.5"
        >
          <Plus size={11} /> Add
        </Button>
      </div>
    </div>
  );
}
