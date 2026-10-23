/** `[[Entity Name]]` and `[[Entity Name|label]]` wiki links inside Markdown. */

export interface WikiLink {
  target: string;
  label: string;
  raw: string;
}

const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of markdown.matchAll(WIKI_RE)) {
    links.push({ target: match[1]!.trim(), label: (match[2] ?? match[1]!).trim(), raw: match[0] });
  }
  return links;
}

/** Rewrites wiki links to standard Markdown links using a resolver (name -> route or null). */
export function rewriteWikiLinks(markdown: string, resolve: (name: string) => string | null): string {
  return markdown.replace(WIKI_RE, (_raw, target: string, label?: string) => {
    const href = resolve(target.trim());
    const text = (label ?? target).trim();
    return href ? `[${text}](${href})` : `[${text}](#missing:${encodeURIComponent(target.trim())})`;
  });
}

export function stripMarkdown(markdown: string, max = 160): string {
  const plain = markdown
    .replace(WIKI_RE, (_, t: string, l?: string) => (l ?? t).trim())
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
