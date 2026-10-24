/** In-memory .map text so a remount does not re-read disk while the session is alive. */
const mapTextByAsset = new Map<string, string>();

export function rememberMapText(assetPath: string, text: string): void {
  mapTextByAsset.set(assetPath, text);
}

export function recalledMapText(assetPath: string): string | undefined {
  return mapTextByAsset.get(assetPath);
}

export function forgetMapText(assetPath: string): void {
  mapTextByAsset.delete(assetPath);
}

/** Same-origin dummy URL. Azgaar only uses it to skip random generation; we serve/upload the file ourselves. */
export function mapLinkFor(mapId: string): string {
  return `${window.location.origin}/__atlas-map/${mapId}.map`;
}

export function fmgSrc(opts: { seed?: string | null; mapId?: string; saved?: boolean }): string {
  const q = new URLSearchParams();
  if (opts.saved && opts.mapId) q.set("maplink", mapLinkFor(opts.mapId));
  else if (opts.seed) q.set("seed", opts.seed);
  return `/fmg/index.html${q.size ? `?${q}` : ""}`;
}
