import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { useNavigate } from "react-router";
import { useRepos } from "@/app/appContext";
import { useCampaignId } from "@/app/queries";
import { routeForEntity } from "@/app/routes";
import { extractWikiLinks, rewriteWikiLinks } from "@/domain/markdown";
import { cn } from "@/lib/utils";
import { Textarea } from "./ui";

/** Renders markdown; `[[Name]]` wiki links resolve to entities in the active campaign. */
export function MarkdownView({ source, className, variant, onNavigate }: { source: string; className?: string; variant?: "read-aloud" | "secret"; onNavigate?: (href: string) => void }) {
  const repos = useRepos();
  const campaignId = useCampaignId();
  const routerNavigate = useNavigate();
  const navigate = (href: string) => (onNavigate ? onNavigate(href) : void routerNavigate(href));
  const names = useMemo(() => [...new Set(extractWikiLinks(source).map((l) => l.target))], [source]);
  const resolved = useQuery({
    queryKey: ["wiki", campaignId, names],
    queryFn: async () => {
      const map: Record<string, string> = {};
      for (const name of names) {
        const hit = await repos.entities.findByName(campaignId, name);
        if (hit) map[name] = routeForEntity(hit);
      }
      return map;
    },
    enabled: names.length > 0,
    staleTime: 30_000,
  });
  const text = useMemo(() => rewriteWikiLinks(source, (name) => resolved.data?.[name] ?? null), [source, resolved.data]);
  if (!source.trim()) return <div className={cn("text-[12px] italic text-ink-faint", className)}>Nothing written yet.</div>;
  return (
    <div className={cn("prose-dm", variant === "read-aloud" && "read-aloud", variant === "secret" && "secret-block", className)}>
      <Markdown
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#missing:")) return <span className="text-blood underline decoration-dotted" title="No entity with this name">{children}</span>;
            if (href?.startsWith("/")) {
              return (
                <a
                  href={`#${href}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(href);
                  }}
                >
                  {children}
                </a>
              );
            }
            return <span className="underline decoration-dotted">{children}</span>;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function MarkdownEditor({ value, onChange, placeholder, rows = 8, className, variant }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string; variant?: "read-aloud" | "secret" }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-end gap-2 text-[11px] text-ink-faint">
        <span>Markdown · use [[Name]] to link entities</span>
        <button type="button" className={cn("rounded px-1.5 py-0.5 hover:text-ink", preview && "bg-bg-active text-ink")} onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[80px] rounded border border-border bg-bg p-3">
          <MarkdownView source={value} variant={variant} />
        </div>
      ) : (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
      )}
    </div>
  );
}
