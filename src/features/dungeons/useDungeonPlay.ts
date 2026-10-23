import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRepos } from "@/app/appContext";
import { useAppStore } from "@/app/appStore";
import type { MapMarker } from "@/domain/types";
import type { ActionReport } from "@/domain/workflows/interactionWorkflow";
import { moveToken, performDoorAction, performInteraction, pickUpFromRoom, tokenItemAction, type DoorActionKind } from "@/domain/workflows/interactionWorkflow";
import { errorMessage } from "@/lib/utils";
import { useEditor } from "./editorStore";
import type { RollRequest } from "./dialogs";

/** Wires the play-mode workflows to the editor store, the roll dialog and the triggered-marker queue. */
export function useDungeonPlay(campaignId: string) {
  const repos = useRepos();
  const qc = useQueryClient();
  const sessionId = useAppStore((s) => s.activeSessionId);
  const settings = useAppStore((s) => s.settings);
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const [triggered, setTriggered] = useState<MapMarker[]>([]);

  const askRoll = useCallback(
    (title: string, ability: string, dc: number) =>
      new Promise<{ roll: number; modifier: number } | null>((resolve) => {
        setRollRequest({ title, ability, dc, resolve: (r) => { setRollRequest(null); resolve(r); } });
      }),
    [],
  );

  const report = useCallback(
    async (r: ActionReport) => {
      const ed = useEditor.getState();
      for (const m of r.messages) ed.pushLog(m, r.ok ? (r.outcome === "failure" ? "warn" : "success") : "warn");
      if (!r.ok && r.outcome === "blocked") toast.warning(r.messages[0] ?? "Blocked");
      if (r.triggeredMarkers.length) setTriggered((t) => [...r.triggeredMarkers, ...t]);
      await ed.refresh();
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["campaignLog"] });
      void qc.invalidateQueries({ queryKey: ["entities"] });
    },
    [qc],
  );

  const guard = useCallback(
    async (fn: () => Promise<ActionReport>) => {
      try {
        const r = await fn();
        await report(r);
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [report],
  );

  const move = useCallback(
    (tokenId: string, to: { x: number; y: number }, force = false) =>
      guard(() => moveToken(repos, { campaign_id: campaignId, session_id: sessionId, token_id: tokenId, to, force, rules: { diagonal: settings.diagonalRule, enforceBudget: settings.enforceMovementBudget } })).then(() => undefined),
    [guard, repos, campaignId, sessionId, settings.diagonalRule, settings.enforceMovementBudget],
  );

  const interact = useCallback(
    async (objectId: string, interactionId: string, actorTokenId: string | null) => {
      const first = await guard(() => performInteraction(repos, { campaign_id: campaignId, session_id: sessionId, object_id: objectId, interaction_id: interactionId, actor_token_id: actorTokenId }));
      if (first && !first.ok && first.outcome === "needs_roll" && first.needsRoll) {
        const rolled = await askRoll(first.messages[0] ?? "Check", first.needsRoll.ability, first.needsRoll.dc);
        if (!rolled) return;
        await guard(() => performInteraction(repos, { campaign_id: campaignId, session_id: sessionId, object_id: objectId, interaction_id: interactionId, actor_token_id: actorTokenId, roll: rolled.roll, modifier: rolled.modifier }));
      }
    },
    [guard, repos, campaignId, sessionId, askRoll],
  );

  const door = useCallback(
    async (doorId: string, action: DoorActionKind, actorTokenId: string | null) => {
      const first = await guard(() => performDoorAction(repos, { campaign_id: campaignId, session_id: sessionId, door_id: doorId, action, actor_token_id: actorTokenId }));
      if (first && !first.ok && first.outcome === "needs_roll" && first.needsRoll) {
        const rolled = await askRoll(first.messages[0] ?? "Check", first.needsRoll.ability, first.needsRoll.dc);
        if (!rolled) return;
        await guard(() => performDoorAction(repos, { campaign_id: campaignId, session_id: sessionId, door_id: doorId, action, actor_token_id: actorTokenId, roll: rolled.roll, modifier: rolled.modifier }));
      }
    },
    [guard, repos, campaignId, sessionId, askRoll],
  );

  const itemAction = useCallback(
    (tokenId: string, instanceId: string, action: "drop" | "equip" | "unequip" | "use" | "give", targetTokenId?: string) =>
      guard(() => tokenItemAction(repos, { campaign_id: campaignId, session_id: sessionId, token_id: tokenId, instance_id: instanceId, action, target_token_id: targetTokenId })),
    [guard, repos, campaignId, sessionId],
  );

  const pickUp = useCallback((tokenId: string, instanceId: string) => guard(() => pickUpFromRoom(repos, { campaign_id: campaignId, session_id: sessionId, token_id: tokenId, instance_id: instanceId })), [guard, repos, campaignId, sessionId]);

  return { rollRequest, triggered, dismissTriggered: (id: string) => setTriggered((t) => t.filter((m) => m.id !== id)), move, interact, door, itemAction, pickUp, askRoll, sessionId };
}

export type DungeonPlay = ReturnType<typeof useDungeonPlay>;
