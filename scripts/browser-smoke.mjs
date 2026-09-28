// Optional integration test using an ALREADY installed Chrome and Node 22+.
// No packages or browsers are downloaded. Run: node scripts/browser-smoke.mjs
// To check a hosted deployment instead: APP_URL=https://.../ node scripts/browser-smoke.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(join(tmpdir(), "jazz-keys-chrome-"));
const appUrl = process.env.APP_URL || "http://127.0.0.1:4179/";
const server = process.env.APP_URL ? null : spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, env: { ...process.env, PORT: "4179" } });
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"]);
let ws;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Map();
let nextId = 0;
const errors = [];
function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function metrics(width, height) {
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: width > height ? "landscapePrimary" : "portraitPrimary", angle: width > height ? 90 : 0 } });
}
async function touch(type, points) {
  await call("Input.dispatchTouchEvent", { type, touchPoints: points.map((point) => ({ radiusX: 3, radiusY: 3, force: 1, ...point })) });
}
async function screenshot(name) {
  const image = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(root, ".tmp", name), Buffer.from(image.data, "base64"));
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not start. Set CHROME_BIN to an installed Chrome.")), 10_000);
    let stderr = "";
    chrome.on("error", (error) => { clearTimeout(timer); reject(error); });
    chrome.stderr.on("data", (data) => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const debugOrigin = endpoint.replace(/^ws:/, "http:").split("/devtools/")[0];
  const pages = await (await fetch(`${debugOrigin}/json/list`)).json();
  ws = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
  });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 10 });
  await metrics(1194, 834);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__oscillators = 0;
    window.__contexts = [];
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); window.__contexts.push(this); }
      createOscillator() { window.__oscillators++; return super.createOscillator(); }
    };
  ` });
  await call("Page.navigate", { url: appUrl });
  await until('document.querySelectorAll(".key").length === 24');
  await until('document.querySelector("#offline-state").textContent === "Ready for offline" && navigator.serviceWorker.controller');
  assert.equal(await evaluate('document.querySelectorAll(".white").length'), 14);
  assert.equal(await evaluate('document.querySelectorAll(".black").length'), 10);
  assert.equal(await evaluate("window.__contexts.length"), 0, "audio is not created before the first tap");
  await mkdir(join(root, ".tmp"), { recursive: true });
  await screenshot("welcome.png");
  const button = await evaluate('(() => { const r = document.querySelector("#start").getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()');
  await touch("touchStart", [{ ...button, id: 1 }]);
  await touch("touchEnd", []);
  await until('document.querySelector("#start-gate").hidden');
  const points = await evaluate(`
    [48, 52, 55, 59, 62, 64].map((note, id) => {
      const r = document.querySelector('[data-note="' + note + '"]').getBoundingClientRect();
      return {id: id + 1, x: r.x + r.width / 2, y: r.y + r.height * .82};
    })
  `);
  await touch("touchStart", points);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 6);
  assert.equal(await evaluate('document.querySelector("#chord").textContent'), "Cmaj9");
  const oscillators = await evaluate("window.__oscillators");
  await touch("touchMove", points.map((p) => ({ ...p, x: p.x + 1 })));
  assert.equal(await evaluate("window.__oscillators"), oscillators, "same-key glide does not retrigger");
  await screenshot("keyboard.png");
  const shared = { ...points[0], id: 7 };
  await touch("touchStart", [...points, shared]);
  assert.equal(await evaluate("window.__oscillators"), oscillators, "second finger shares a voice");
  await touch("touchEnd", points);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 1);
  assert.equal(await evaluate('document.querySelector("#chord").textContent'), "");
  await touch("touchEnd", []);
  await touch("touchStart", points);
  await metrics(834, 1194);
  await until('getComputedStyle(document.querySelector(".rotate")).display === "flex" && document.querySelectorAll(".pressed").length === 0');
  await screenshot("portrait.png");
  await touch("touchCancel", []);
  await metrics(1194, 834);
  await until('getComputedStyle(document.querySelector(".instrument")).display !== "none"');
  await delay(100); // allow the orientation-change event and ResizeObserver to settle
  await touch("touchStart", [points[0]]);
  await until('window.__contexts[0].state === "running"');
  await evaluate('window.dispatchEvent(new Event("blur"))');
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  await touch("touchCancel", []);

  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call("Page.reload");
  await until('document.querySelectorAll(".key").length === 24 && document.querySelector("#start-gate").hidden === false');
  await touch("touchStart", [{ ...button, id: 1 }]);
  await touch("touchEnd", []);
  await until('document.querySelector("#start-gate").hidden');
  await touch("touchStart", points);
  assert.equal(await evaluate('document.querySelector("#chord").textContent'), "Cmaj9", "offline reload plays and detects chords");
  await touch("touchEnd", []);
  assert.deepEqual(errors, [], "no uncaught browser exceptions");
  console.log("PASS: 24-key layout, real Web Audio, six-note touch chord, glide, shared key, rotation/blur cleanup, wake, offline reload. Screenshots in .tmp/");
} finally {
  ws?.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  const stopped = [chrome, server].filter(Boolean).map((child) => child.pid && child.exitCode === null ? once(child, "exit").catch(() => {}) : Promise.resolve());
  chrome.kill();
  server?.kill();
  await Promise.all(stopped);
  await rm(profile, { recursive: true, force: true });
}
