import { EntityWorkspace } from "@/components/EntityWorkspace";
import { KIND_LABELS, type EntityKind } from "@/domain/types";

const LORE_KINDS: EntityKind[] = ["article", "document", "faction", "religion", "deity", "event", "secret", "trap"];

export function LorePage() {
  return (
    <EntityWorkspace
      title="Lore & Documents"
      kinds={LORE_KINDS}
      basePath="/lore"
      description="Wiki-style articles, in-world documents, factions, religions, deities, historical events, secrets and trap designs. Use [[Name]] to cross-link anything."
      rowMeta={(e) => e.summary || KIND_LABELS[e.kind]}
    />
  );
}
