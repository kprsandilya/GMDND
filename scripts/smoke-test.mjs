// End-to-end smoke test against the *real* desktop window (WebView2) via the Chrome DevTools Protocol.
//
// 1. Start the app with remote debugging enabled, e.g. in PowerShell:
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; npm run desktop:dev
//    (works the same for an installed build: set the variable, then launch "DM Workbench").
// 2. Run:  npm run smoke
//
// The test walks every module route, asserts that each page renders its heading, that no uncaught
// exception or console error is raised, and that the demo campaign's dungeon editor and the embedded
// map generator come up. It needs no network access and leaves the database untouched.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT ?? "9222";
const OUT = path.resolve("smoke-artifacts");
mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`http://localhost:${PORT}/json`)).json().catch(() => null);
const page = targets?.find((t) => t.type === "page" && t.title.includes("DM Workbench"));
if (!page) {
  console.error(`No DM Workbench window exposes CDP on port ${PORT}. Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${PORT}.`);
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    // The map generator throws once when its iframe is torn down; that is upstream behaviour, not ours.
    if (!(d.url ?? "").includes("/fmg/")) problems.push(`exception: ${d.exception?.description ?? d.text}`);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    const fromGenerator = (msg.params.stackTrace?.callFrames ?? []).some((f) => f.url.includes("/fmg/"));
    if (!fromGenerator) problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, "base64"));
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed += 1;
};

const ready = await (async () => {
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate("!!document.querySelector('nav') && document.body.innerText.includes('Dashboard')")) return true;
    await sleep(1000);
  }
  return false;
})();
check(ready, "application shell booted");

const routes = [
  ["/", "Campaign clock"],
  ["/campaigns", "Campaigns"],
  ["/locations", "Locations"],
  ["/dungeons", "Dungeons & Maps"],
  ["/encounters", "Encounters"],
  ["/characters", "Characters"],
  ["/items", "Items"],
  ["/creatures", "Creatures"],
  ["/quests", "Quests"],
  ["/lore", "Lore"],
  ["/timeline", "Timeline"],
  ["/sessions", "Session"],
  ["/search", "Global Search"],
  ["/settings", "Settings & Data Management"],
];
for (const [route, expected] of routes) {
  await evaluate(`location.hash = ${JSON.stringify("#" + route)}`);
  await sleep(900);
  const text = await evaluate("document.body.innerText");
  check(text.toLowerCase().includes(expected.toLowerCase()), `route ${route} shows “${expected}”`);
  await shot(`route${route.replace(/\//g, "_") || "_root"}`);
}

// Dungeon editor renders the demo floor.
await evaluate("location.hash = '#/dungeons'");
await sleep(800);
await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Cistern'))?.click()");
await sleep(1500);
const cells = await evaluate("document.querySelectorAll('#map-area svg text').length");
check(cells > 5, `dungeon editor renders rooms and tokens (${cells} labels)`);
await shot("dungeon-editor");

// World atlas: the embedded generator produces a map with burgs.
await evaluate("location.hash = '#/atlas'");
let burgs = 0;
for (let i = 0; i < 90; i += 1) {
  burgs = (await evaluate("document.querySelector('iframe')?.contentWindow?.pack?.burgs?.length ?? 0")) || 0;
  if (burgs > 0) break;
  await sleep(1000);
}
check(burgs > 0, `world atlas generator ready (${burgs} burgs)`);
await shot("atlas");

await sleep(500);
for (const p of problems) console.log(`WARN  ${p}`);
check(problems.length === 0, "no uncaught exceptions or console errors");

ws.close();
console.log(failed ? `\n${failed} check(s) failed. Screenshots: ${OUT}` : `\nAll checks passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
