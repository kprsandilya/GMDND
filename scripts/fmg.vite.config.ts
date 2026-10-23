// Wraps the upstream Fantasy Map Generator Vite config so it can be built into this repository's
// public/fmg directory without editing the submodule. We reuse upstream's "electron" mode, which
// already produces a relative-base, analytics-free, PWA-free bundle meant for a desktop shell.
import path from "node:path";
import { fileURLToPath } from "node:url";
import upstream from "../Fantasy-Map-Generator/vite.config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fmgDir = path.join(repoRoot, "Fantasy-Map-Generator");

/**
 * FMG checks `window.electron?.isElectron` to decide it is running inside a desktop shell: it then
 * skips the service worker, the "navigate away" prompt and the download-folder hints. Our Tauri
 * webview is the same situation, so the flag is provided before the app boots.
 */
const desktopHostBridge = {
  name: "dm-workbench-desktop-bridge",
  transformIndexHtml: (html: string) =>
    html.replace(
      "<head>",
      `<head>\n    <script>window.electron = { isElectron: true, platform: "tauri", versions: { electron: "tauri", chrome: "webview", node: "none" } };</script>`
    )
};

export default ({ mode }: { mode: string }) => {
  const base = upstream({ mode: "electron" });
  return {
    ...base,
    mode,
    root: path.join(fmgDir, "src"),
    publicDir: path.join(fmgDir, "public"),
    plugins: [...(base.plugins ?? []), desktopHostBridge],
    build: {
      ...base.build,
      outDir: path.join(repoRoot, "public", "fmg"),
      emptyOutDir: true
    },
    logLevel: "warn" as const
  };
};
