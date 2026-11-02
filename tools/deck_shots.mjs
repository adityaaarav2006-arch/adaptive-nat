// deck_shots.mjs - screenshots of two demo frames for the review deck (deck/assets/shot_*.png).
// Needs Node 22+ and a local Chrome or Edge.   node tools/deck_shots.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "deck", "assets");
mkdirSync(OUT, { recursive: true });
const exe = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((b) => existsSync(b));
const port = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "deck-"))}`,
  "--no-first-run", "--hide-scrollbars", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch { /* starting */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result?.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: pathToFileURL(path.join(ROOT, "demo", "index.html")).href });
for (let i = 0; i < 100 && !(await evaluate(`typeof Demo === "object" && document.querySelectorAll(".tile").length > 0`)); i++) await sleep(100);
await evaluate(`document.getElementById("btn-present").click()`);
await sleep(400);

async function shot(name, selector, pad = 8) {
  const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height}; })()`);
  const res = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x - pad, y: r.y - pad, width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1 } });
  writeFileSync(path.join(OUT, name), Buffer.from(res.result.data, "base64"));
  console.log("wrote", name);
}
const idx = (id) => `[...document.querySelectorAll(".slide")].indexOf(document.getElementById("${id}"))`;

// problem: the symmetric-NAT step, with its packets dropped
await evaluate(`Demo.go(${idx("problem")}, true)`);
await sleep(500);
for (let k = 0; k < 3; k++) { await evaluate(`document.getElementById("problem-next").click()`); await sleep(400); }
await sleep(2600);
await shot("shot_problem.png", "#problem-svg");

// strategy: port-restricted vs symmetric random
await evaluate(`Demo.go(${idx("strategy")}, true)`);
await evaluate(`(() => { const s = document.querySelectorAll("#peers select"); s[0].value = "pr"; s[0].dispatchEvent(new Event("change")); s[4].value = "srand"; s[4].dispatchEvent(new Event("change")); })()`);
await sleep(600);
await shot("shot_strategy.png", "#strategy .slide-body");

ws.close();
proc.kill();
