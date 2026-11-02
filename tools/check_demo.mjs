// check_demo.mjs - open demo/index.html in headless Chrome/Edge, screenshot every slide and report
// console errors, missing data ("undefined", "NaN"), content cut off, horizontal scroll and
// overlapping SVG labels. No dependencies: Node 22+ (built-in WebSocket) and a local Chrome or Edge.
//
//   node tools/check_demo.mjs [output-dir] [--quick]
//
// Exits with status 1 if any problem is found.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUICK = process.argv.includes("--quick");   // layouts and audits only, no interactive flows
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) || mkdtempSync(path.join(tmpdir(), "nat-demo-"));
mkdirSync(OUT, { recursive: true });
const PAGE = pathToFileURL(path.join(ROOT, "demo", "index.html")).href;
const BROWSERS = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const exe = BROWSERS.find((b) => existsSync(b));
if (!exe) { console.error("No Chrome/Edge found; set CHROME=/path/to/browser"); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "nat-prof-"))}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch { /* starting */ }
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const problems = [];
const consoleMsgs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") consoleMsgs.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(m.params.type))
    consoleMsgs.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level))
    consoleMsgs.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url || ""}`);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result.result.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
};
const viewport = (width, height, mobile = false) =>
  send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");

// In-page audit of the slide currently on screen (or all slides).
const AUDIT_FN = `((only) => {
  const out = [];
  const txt = document.body.innerText;
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) if (txt.includes(bad)) out.push("page text contains " + bad);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push("horizontal scroll: " + document.documentElement.scrollWidth + " > " + innerWidth);
  const presenter = document.documentElement.classList.contains("presenter");
  const bar = document.getElementById("topbar").offsetHeight;
  document.querySelectorAll(".slide").forEach((s) => {
    if (only && s.id !== only) return;
    const kids = [...s.querySelectorAll("*")].filter((e) => e.offsetParent !== null || e.tagName === "svg" || e instanceof SVGElement);
    const sr = s.getBoundingClientRect();
    let bottom = sr.top;
    s.querySelectorAll(".slide-head, .slide-body > *, .tiles, .hint, .title-block, .tiles-head").forEach((e) => { const r = e.getBoundingClientRect(); if (r.height) bottom = Math.max(bottom, r.bottom); });
    const contentH = bottom - sr.top;
    const avail = innerHeight - bar;
    if (innerWidth >= 900 && contentH > avail + 2) out.push(s.id + ": content " + Math.round(contentH) + "px taller than the " + Math.round(avail) + "px screen" + (presenter ? " (presenter: cut off)" : ""));
    // overlapping SVG labels
    s.querySelectorAll("svg").forEach((g) => {
      if (!g.getBoundingClientRect().width) return;
      const ts = [...g.querySelectorAll("text")].filter((t) => t.textContent.trim() && getComputedStyle(t).display !== "none" && t.closest("[style*='display: none']") === null)
        .map((t) => ({ t, r: t.getBoundingClientRect() })).filter((o) => o.r.width > 0);
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i].r, b = ts[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 3) out.push(s.id + ": SVG labels overlap: \\"" + ts[i].t.textContent + "\\" / \\"" + ts[j].t.textContent + "\\"");
      }
    });
    // HTML boxes whose content spills out sideways
    s.querySelectorAll(".card, .tile, .rung, .prof-step, .peer, .lane, .callout-chip, td, .btn").forEach((e) => {
      if (e.offsetParent && e.scrollWidth > e.clientWidth + 2) out.push(s.id + ": ." + (e.className || e.tagName).toString().split(" ")[0] + " overflows sideways (" + e.scrollWidth + " > " + e.clientWidth + "): " + e.textContent.slice(0, 50));
    });
  });
  return out;
})`;
const AUDIT = AUDIT_FN + "(null)";
const auditSlide = (id) => evaluate(AUDIT_FN + "(" + JSON.stringify(id) + ")");

async function load(w, h, mobile = false) {
  await viewport(w, h, mobile);
  await send("Page.navigate", { url: PAGE });
  // wait until app.js has run (a cold browser start can take well over a second)
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { if (await evaluate(`typeof Demo === "object" && document.readyState === "complete" && document.querySelectorAll(".tile").length > 0`)) break; } catch { /* navigating */ }
  }
  await sleep(500);
}
async function slideIds() { return evaluate(`[...document.querySelectorAll(".slide")].map(s => s.id)`); }
async function goTo(i) { await evaluate(`Demo.go(${i}, true)`); await sleep(350); }
function report(tag, list) { for (const p of [...new Set(list)]) problems.push(`[${tag}] ${p}`); }

// 1. laptop / projector, normal and presenter mode, light and dark
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  await load(w, h);
  const ids = await slideIds();
  for (const presenter of [false, true]) {
    if (presenter) { await evaluate(`document.getElementById("btn-present").click()`); await sleep(400); }
    for (let i = 0; i < ids.length; i++) { await goTo(i); await shot(`${w}x${h}${presenter ? "-presenter" : ""}-${String(i + 1).padStart(2, "0")}-${ids[i]}`); }
    report(`${w}x${h}${presenter ? " presenter" : ""}`, await evaluate(AUDIT));
  }
}
// 2. interactive flows at 1280x720 presenter (the classroom projector)
let ids;
if (!QUICK) {
await load(1280, 720);
await evaluate(`document.getElementById("btn-present").click()`); await sleep(300);
ids = await slideIds();
const idx = (id) => ids.indexOf(id);
await goTo(idx("problem"));
for (let k = 1; k <= 4; k++) { await evaluate(`document.getElementById("problem-next").click()`); await sleep(2900); await shot(`flow-problem-step${k + 1}`); }
report("problem flow", await auditSlide("problem"));
await goTo(idx("profile"));
for (const cfg of [["APD", "APD", "block"], ["AD", "EI", "sequential"], ["EI", "AD", "random"]]) {
  await evaluate(`(() => { const s = document.querySelectorAll("#prof-controls select"); const v = ${JSON.stringify(cfg)};
    s.forEach((x, i) => { x.value = v[i]; x.dispatchEvent(new Event("change")); }); document.querySelector("#prof-controls .btn-primary").click(); })()`);
  await sleep(16000);
  await shot(`flow-profile-${cfg.join("-")}`);
  report("profiler " + cfg.join("/"), await auditSlide("profile"));
}
// strategy: every preset pairing renders without errors and agrees with the measured plan
const mism = await evaluate(`(() => {
  const bad = [];
  const sel = document.querySelectorAll("#peers select");
  for (const a of Demo.PRESETS) for (const b of Demo.PRESETS) {
    sel[0].value = a.id; sel[0].dispatchEvent(new Event("change"));
    sel[4].value = b.id; sel[4].dispatchEvent(new Event("change"));
    if (document.querySelector("#measured .check-line.bad")) bad.push(a.id + "/" + b.id);
    if (!document.querySelector("#ladder .rung.chosen")) bad.push("no rung chosen " + a.id + "/" + b.id);
  }
  sel[0].value = "pr"; sel[0].dispatchEvent(new Event("change"));
  sel[4].value = "srand"; sel[4].dispatchEvent(new Event("change"));
  return bad;
})()`);
report("strategy presets", mism.map((m) => "measured plan differs: " + m));
for (const [a, b] of [["pr", "srand"], ["fc", "fc"], ["sseq", "sseq"], ["srand", "srand"], ["pr", "cgn"], ["cgn", "cgn"]]) {
  await goTo(idx("strategy"));
  await evaluate(`(() => { const s = document.querySelectorAll("#peers select"); s[0].value = "${a}"; s[0].dispatchEvent(new Event("change")); s[4].value = "${b}"; s[4].dispatchEvent(new Event("change")); })()`);
  await sleep(200);
  await shot(`flow-strategy-${a}-${b}`);
  report(`strategy ${a}/${b}`, await auditSlide("strategy"));
  await goTo(idx("connect"));
  await evaluate(`document.getElementById("conn-play").click()`);
  await sleep(1800);
  await shot(`flow-connect-${a}-${b}-mid`);
  await sleep(10000);
  await shot(`flow-connect-${a}-${b}-end`);
  report(`connect ${a}/${b}`, await auditSlide("connect"));
}
await goTo(idx("birthday"));
await evaluate(`[...document.querySelectorAll("#bday-controls .presets .btn")][1].click()`); await sleep(200);
await evaluate(`[...document.querySelectorAll("#bday-legend .btn")][1].click()`); await sleep(600);
await shot("flow-birthday-block");
report("birthday", await auditSlide("birthday"));
}
// 3. dark theme
await load(1280, 720);
await evaluate(`document.getElementById("btn-present").click()`); await sleep(300);
ids = await slideIds();
await evaluate(`document.getElementById("btn-theme").click()`); await sleep(300);
for (let i = 0; i < ids.length; i++) { await goTo(i); await shot(`dark-${String(i + 1).padStart(2, "0")}-${ids[i]}`); }
report("dark", await evaluate(AUDIT));
// 4. phone
await load(390, 844, true);
ids = await slideIds();
for (let i = 0; i < ids.length; i++) { await goTo(i); await shot(`phone-${String(i + 1).padStart(2, "0")}-${ids[i]}`); }
report("phone 390px", await evaluate(AUDIT));
// 5. keyboard navigation
await load(1280, 720);
const nav = await evaluate(`(async () => {
  const seen = [];
  for (let i = 0; i < 4; i++) { document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "PageDown", bubbles: true})); await new Promise(r => setTimeout(r, 900)); seen.push(document.querySelector(".progress a.current .pn").textContent); }
  return seen;
})()`);
if (nav.join(",") !== "2,3,4,5") problems.push("[keyboard] PageDown visited groups " + nav.join(",") + " instead of 2,3,4,5");

ws.close();
proc.kill();
for (const m of [...new Set(consoleMsgs)]) problems.push("[console] " + m);
console.log(`Screenshots: ${OUT}`);
if (problems.length) { console.log(`${problems.length} problems:`); problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("No problems found.");
