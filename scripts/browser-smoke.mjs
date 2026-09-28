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
async function click(selector) {
  const point = await evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
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
      resume() {
        if (window.__hangNextResume) {
          window.__hangNextResume = false;
          return new Promise(() => {});
        }
        return super.resume();
      }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      window.addEventListener(type, (event) => {
        if (window.__dropPointerEnds) event.stopImmediatePropagation();
      }, true);
    }
    for (const type of ['touchend', 'touchcancel']) {
      window.addEventListener(type, (event) => {
        if (window.__dropTouchEnds) event.stopImmediatePropagation();
      }, true);
    }
  ` });
  await call("Page.navigate", { url: appUrl });
  await until('document.querySelectorAll(".key").length === 36');
  await until('document.querySelector("#offline-state").textContent === "Ready for offline" && navigator.serviceWorker.controller');
  assert.equal(await evaluate('document.querySelectorAll(".white").length'), 21);
  assert.equal(await evaluate('document.querySelectorAll(".black").length'), 15);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".key"), (key) => Number(key.dataset.note))'), Array.from({ length: 36 }, (_, i) => 48 + i));
  // Explicit screen-height rule, not a width-derived approximation. Check
  // several iPad viewports and a short landscape viewport before returning.
  for (const [width, height] of [[1180, 820], [1024, 768], [1366, 1024], [844, 390], [1194, 834]]) {
    await metrics(width, height);
    await until(`Math.abs(document.querySelector('.keyboard').getBoundingClientRect().height - ${height} * 2 / 3) < 1`);
    const layout = await evaluate(`(() => {
      const whites = [...document.querySelectorAll('.white')].map((key) => key.getBoundingClientRect());
      const black = document.querySelector('.black').getBoundingClientRect();
      const space = document.querySelector('.piano-space').getBoundingClientRect();
      const strip = document.querySelector('.strip').getBoundingClientRect();
      return {
        height: whites[0].height, width: whites[0].width,
        left: whites[0].left, right: whites.at(-1).right, bottom: whites[0].bottom,
        spaceHeight: space.height, stripGap: whites[0].top - strip.bottom,
        blackLength: black.height / whites[0].height,
      };
    })()`);
    assert.ok(Math.abs(layout.height - height * 2 / 3) < 1, `${width}×${height}: exactly two-thirds height`);
    assert.ok(Math.abs(layout.width - width / 21) < 1, "21 equal white keys across the width");
    assert.ok(Math.abs(layout.left) < 1 && Math.abs(layout.right - width) < 1, "C3 to B5 fills the width");
    assert.ok(Math.abs(layout.bottom - height) < 1 && layout.spaceHeight >= 24, "keys stay at the bottom, inactive space above");
    assert.ok(Math.abs(layout.stripGap) < 1, "chord strip sits immediately above the keys");
    assert.ok(Math.abs(layout.blackLength - .61) < .01, "black keys remain shorter than white keys");
  }
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

  // Hit-test every white/black key, including the new third octave and B5 edge.
  const allKeyPoints = await evaluate(`Array.from(document.querySelectorAll('.key'), (key) => {
    const r = key.getBoundingClientRect();
    return { note: Number(key.dataset.note), id: 1, x: r.x + r.width / 2,
      y: r.y + r.height * (key.classList.contains('black') ? .5 : .82) };
  })`);
  for (const { note, ...point } of allKeyPoints) {
    const before = await evaluate('window.__oscillators');
    await touch("touchStart", [point]);
    assert.equal(await evaluate('document.querySelector(".pressed")?.dataset.note'), String(note));
    assert.equal(await evaluate('window.__oscillators'), before + 1, `MIDI ${note} starts a voice`);
    await touch("touchEnd", []);
    assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  }
  const upperChord = allKeyPoints.filter((p) => [72, 76, 79, 83].includes(p.note))
    .map(({ note, ...point }, index) => ({ ...point, id: index + 1 }));
  await touch("touchStart", upperChord);
  assert.equal(await evaluate('document.querySelector("#chord").textContent'), "Cmaj7", "C5 E5 G5 B5 is recognized");
  await touch("touchEnd", []);

  // Reproduce missing pointer releases: native Touch Events must still clean up.
  await evaluate('window.__dropPointerEnds = true');
  await touch("touchStart", [points[0]]);
  await touch("touchEnd", []);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  // Drop both release streams, then ensure a fresh gesture unsticks the note.
  await evaluate('window.__dropTouchEnds = true');
  await touch("touchStart", [points[0]]);
  await touch("touchEnd", []);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 1);
  await evaluate('window.__dropTouchEnds = false');
  const beforeRetouch = await evaluate('window.__oscillators');
  await touch("touchStart", [points[0]]);
  assert.equal(await evaluate('window.__oscillators'), beforeRetouch + 1);
  await touch("touchEnd", []);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  await evaluate('window.__dropPointerEnds = false');

  const blank = await evaluate(`(() => {
    const r = document.querySelector('.piano-space').getBoundingClientRect();
    return { id: 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await evaluate('window.__dropPointerEnds = window.__dropTouchEnds = true');
  await touch("touchStart", [points[0]]);
  await touch("touchEnd", []);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 1);
  await evaluate('window.__dropPointerEnds = window.__dropTouchEnds = false');
  const beforeBlank = await evaluate('window.__oscillators');
  await touch("touchStart", [blank]);
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0, "a blank-space gesture clears stale touches");
  await touch("touchMove", [points[0]]);
  await touch("touchEnd", []);
  assert.equal(await evaluate('window.__oscillators'), beforeBlank, "blank space is not playable, even when sliding onto keys");

  await touch("touchStart", points);
  await click("#reset");
  await until('document.querySelector("#start-gate").hidden && window.__contexts.at(-1).state === "running"');
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  assert.equal(await evaluate('window.__contexts[0].state'), "closed", "Reset closes the old engine");
  await touch("touchMove", points.map((p) => ({ ...p, x: p.x + 1 })));
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0, "held fingers cannot revive notes after Reset");
  await touch("touchEnd", []);

  // A never-settling Safari resume must still allow another user-triggered try.
  await evaluate('window.__hangNextResume = true');
  await click("#reset");
  await until('!document.querySelector("#start-gate").hidden && !document.querySelector("#start").disabled');
  await click("#start");
  await until('document.querySelector("#start-gate").hidden');
  await touch("touchStart", points);
  await metrics(834, 1194);
  await until('getComputedStyle(document.querySelector(".rotate")).display === "flex" && document.querySelectorAll(".pressed").length === 0');
  await screenshot("portrait.png");
  await touch("touchCancel", []);
  await metrics(1194, 834);
  await until('getComputedStyle(document.querySelector(".instrument")).display !== "none"');
  await delay(100); // allow the orientation-change event and ResizeObserver to settle
  await touch("touchStart", [points[0]]);
  await until('window.__contexts.at(-1).state === "running"');
  await evaluate('window.dispatchEvent(new Event("blur"))');
  assert.equal(await evaluate('document.querySelectorAll(".pressed").length'), 0);
  await touch("touchCancel", []);

  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call("Page.reload");
  await until('document.querySelectorAll(".key").length === 36 && document.querySelector("#start-gate").hidden === false');
  await touch("touchStart", [{ ...button, id: 1 }]);
  await touch("touchEnd", []);
  await until('document.querySelector("#start-gate").hidden');
  await touch("touchStart", points);
  assert.equal(await evaluate('document.querySelector("#chord").textContent'), "Cmaj9", "offline reload plays and detects chords");
  await touch("touchEnd", []);
  assert.deepEqual(errors, [], "no uncaught browser exceptions");
  console.log("PASS: 36 playable keys C3–B5, two-thirds height at five viewport sizes, upper-octave chords, inert blank space, real audio, six-note touch/glide/shared keys, release/Reset/hung-resume recovery, rotation/blur/wake, offline reload. Screenshots in .tmp/");
} finally {
  ws?.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  const stopped = [chrome, server].filter(Boolean).map((child) => child.pid && child.exitCode === null ? once(child, "exit").catch(() => {}) : Promise.resolve());
  chrome.kill();
  server?.kill();
  await Promise.all(stopped);
  await rm(profile, { recursive: true, force: true });
}
