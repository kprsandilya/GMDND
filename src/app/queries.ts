import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Entity, EntityKind } from "@/domain/types";
import { errorMessage } from "@/lib/utils";
import type { EntityQuery } from "@/persistence/repositories/entities";
import { useRepos } from "./appContext";
import { useAppStore } from "./appStore";

export const qk = {
  campaigns: ["entities", "campaigns"] as const,
  campaign: (id: string | null) => ["entities", "campaign", id] as const,
  entity: (id: string | null | undefined) => ["entities", "one", id] as const,
  entities: (campaignId: string | null, query: EntityQuery) => ["entities", "list", campaignId, query] as const,
  links: (id: string) => ["entities", "links", id] as const,
  search: (campaignId: string | null, term: string) => ["entities", "search", campaignId, term] as const,
  worldMaps: (campaignId: string | null) => ["maps", campaignId] as const,
  worldMap: (id: string | null) => ["maps", "one", id] as const,
  floors: (dungeonId: string | null) => ["dungeon", "floors", dungeonId] as const,
  floor: (floorId: string | null) => ["dungeon", "floor", floorId] as const,
  inventory: (ownerType: string, ownerId: string | null) => ["inventory", ownerType, ownerId] as const,
  runs: (campaignId: string | null) => ["encounters", "runs", campaignId] as const,
  run: (id: string | null) => ["encounters", "run", id] as const,
  participants: (encounterId: string) => ["encounters", "participants", encounterId] as const,
  objectives: (questId: string) => ["quests", questId] as const,
  timeline: (campaignId: string | null) => ["timeline", campaignId] as const,
  sessionNotes: (sessionId: string | null) => ["sessionNotes", sessionId] as const,
  campaignLog: (campaignId: string | null) => ["campaignLog", campaignId] as const,
  campaignState: (campaignId: string | null) => ["campaignState", campaignId] as const,
};

export function useCampaignId(): string | null {
  return useAppStore((s) => s.campaignId);
}

export function useRequiredCampaignId(): string {
  const id = useAppStore((s) => s.campaignId);
  if (!id) throw new Error("No active campaign");
  return id;
}

export function useCampaigns() {
  const repos = useRepos();
  return useQuery({ queryKey: qk.campaigns, queryFn: () => repos.entities.list({ kinds: ["campaign"], orderBy: "updated_at" }) });
}

export function useCampaign() {
  const repos = useRepos();
  const id = useCampaignId();
  return useQuery({ queryKey: qk.campaign(id), queryFn: () => repos.entities.get(id!), enabled: !!id });
}

export function useEntity(id: string | null | undefined, options?: Partial<UseQueryOptions<Entity | null>>) {
  const repos = useRepos();
  return useQuery({ queryKey: qk.entity(id), queryFn: () => repos.entities.find(id), enabled: !!id, ...options });
}

export function useEntities(query: EntityQuery, options?: { enabled?: boolean }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  // Default to the active campaign. A caller may override the scope by passing a concrete
  // `campaign_id` (e.g. null for shared-only), but an *undefined* value must NOT wipe the default —
  // otherwise the query would silently return records from every campaign.
  const merged: EntityQuery = { ...query, campaign_id: "campaign_id" in query && query.campaign_id !== undefined ? query.campaign_id : campaignId };
  return useQuery({ queryKey: qk.entities(campaignId, merged), queryFn: () => repos.entities.list(merged), enabled: (options?.enabled ?? true) && !!campaignId });
}

export function useEntitiesOfKinds(kinds: EntityKind[], extra: Omit<EntityQuery, "kinds"> = {}) {
  return useEntities({ kinds, ...extra });
}

export function useLinks(id: string | null | undefined) {
  const repos = useRepos();
  return useQuery({ queryKey: qk.links(id ?? ""), queryFn: () => repos.entities.linksFor(id!), enabled: !!id });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: readonly (readonly unknown[])[]) => {
    for (const prefix of prefixes.length ? prefixes : [["entities"]]) void qc.invalidateQueries({ queryKey: prefix as unknown[] });
  };
}

/** Mutation helper with toast feedback and coarse cache invalidation. */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: { success?: string | ((result: TResult) => string | null); invalidate?: readonly (readonly unknown[])[]; onSuccess?: (result: TResult, args: TArgs) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => {
      for (const key of options.invalidate ?? [["entities"]]) void qc.invalidateQueries({ queryKey: key as unknown[] });
      const message = typeof options.success === "function" ? options.success(result) : options.success;
      if (message) toast.success(message);
      options.onSuccess?.(result, args);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export const ALL_KEYS: readonly (readonly unknown[])[] = [["entities"], ["maps"], ["dungeon"], ["inventory"], ["encounters"], ["quests"], ["timeline"], ["sessionNotes"], ["campaignLog"], ["campaignState"]];
