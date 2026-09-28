import { PianoAudio } from "./audio.js";
import { detectChord, prettyChord } from "./chords.js";
import { NoteContacts, hitTest } from "./input.js";

const keyboard = document.querySelector("#keyboard");
const chord = document.querySelector("#chord");
const gate = document.querySelector("#start-gate");
const start = document.querySelector("#start");
const message = document.querySelector("#start-message");
const audioState = document.querySelector("#audio-state");
const audioDot = document.querySelector("#audio-dot");
const portrait = matchMedia("(orientation: portrait)");
const keys = new Map();
const blackPitches = new Set([1, 3, 6, 8, 10]);
const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
let ready = false;
let rectangles = [];

const audio = new PianoAudio((state) => {
  audioState.textContent = state === "running" ? "Ready" : state === "interrupted" ? "Sound paused" : "Resting";
  audioDot.classList.toggle("awake", state === "running");
  if (ready && (state === "interrupted" || (state === "suspended" && !audio.sleeping && !audio.resuming))) {
    showSoundGate("Sound was paused by your iPad. Tap to resume.");
  }
});

const contacts = new NoteContacts({
  onPress(note) {
    const key = keys.get(note);
    key.classList.add("pressed");
    key.setAttribute("aria-pressed", "true");
    try {
      // resume() is invoked synchronously in the touch handler; do not wait for
      // its promise before scheduling the attack on the audio timeline.
      audio.resume().catch((error) => showSoundGate(error.message));
      audio.noteOn(note);
    } catch (error) { showSoundGate(error.message); }
  },
  onRelease(note) {
    const key = keys.get(note);
    key.classList.remove("pressed");
    key.setAttribute("aria-pressed", "false");
    audio.noteOff(note);
  },
  onChange(notes) {
    const result = detectChord(notes);
    const enoughNotes = new Set(notes.map((note) => note % 12)).size >= 3;
    const label = result ? prettyChord(result.name) : enoughNotes ? "—" : "";
    if (chord.textContent !== label) chord.textContent = label;
    chord.title = result?.rootless ? "Possible rootless voicing; other names may be valid."
      : enoughNotes && !result ? "No common chord match" : "";
  },
});

let whiteIndex = 0;
for (let note = 48; note <= 71; note++) {
  const black = blackPitches.has(note % 12);
  const octave = Math.floor(note / 12) - 1;
  const key = document.createElement("button");
  key.type = "button";
  key.className = `key ${black ? "black" : "white"}`;
  key.dataset.note = note;
  key.style.setProperty("--position", whiteIndex);
  key.setAttribute("aria-label", `${noteNames[note % 12]}${octave}`);
  key.setAttribute("aria-pressed", "false");
  const label = document.createElement("span");
  label.className = "key-label";
  label.setAttribute("aria-hidden", "true");
  label.textContent = noteNames[note % 12];
  if (note % 12 === 0) {
    const sub = document.createElement("sub");
    sub.textContent = octave;
    label.append(sub);
  }
  key.append(label);
  keyboard.append(key);
  keys.set(note, key);
  if (!black) whiteIndex++;

  // Standard button keyboard access, without adding a settings/key-mapping UI.
  key.addEventListener("keydown", (event) => {
    if (!["Space", "Enter"].includes(event.code) || !ready) return;
    event.preventDefault();
    if (!event.repeat) contacts.set(`key:${note}:${event.code}`, note);
  });
  key.addEventListener("keyup", (event) => {
    if (!["Space", "Enter"].includes(event.code)) return;
    event.preventDefault();
    contacts.end(`key:${note}:${event.code}`);
  });
  key.addEventListener("blur", () => {
    contacts.end(`key:${note}:Space`);
    contacts.end(`key:${note}:Enter`);
  });
  // Assistive-technology activation without a physical pointer/key event.
  key.addEventListener("click", (event) => {
    if (event.detail || !ready) return;
    const id = Symbol("accessible tap");
    contacts.set(id, note);
    setTimeout(() => contacts.end(id), 180);
  });
}
keyboard.inert = true;

function measureKeys() {
  rectangles = [...keys].map(([note, key]) => {
    const { left, right, top, bottom } = key.getBoundingClientRect();
    return { note, left, right, top, bottom, black: blackPitches.has(note % 12) };
  });
}
new ResizeObserver(measureKeys).observe(keyboard);
window.addEventListener("resize", measureKeys);

keyboard.addEventListener("pointerdown", (event) => {
  if (!ready || portrait.matches || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  keyboard.setPointerCapture(event.pointerId);
  contacts.set(event.pointerId, hitTest(event.clientX, event.clientY, rectangles));
});
keyboard.addEventListener("pointermove", (event) => {
  if (!contacts.has(event.pointerId)) return;
  event.preventDefault();
  contacts.set(event.pointerId, hitTest(event.clientX, event.clientY, rectangles));
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  keyboard.addEventListener(type, (event) => contacts.end(event.pointerId));
}
keyboard.addEventListener("contextmenu", (event) => event.preventDefault());

function stopPlaying() {
  const pointers = [...contacts.contacts.keys()].filter((id) => typeof id === "number");
  contacts.clear();
  for (const id of pointers) {
    if (keyboard.hasPointerCapture(id)) keyboard.releasePointerCapture(id);
  }
  audio.silence({ suspend: true });
}

function showSoundGate(text) {
  ready = false;
  stopPlaying();
  keyboard.inert = true;
  gate.hidden = false;
  start.disabled = false;
  start.firstChild.textContent = "Tap to resume ";
  message.textContent = text || "Tap to turn sound back on.";
}

start.addEventListener("click", async () => {
  start.disabled = true;
  try {
    await audio.resume();
    if (document.hidden || portrait.matches) {
      audio.silence({ suspend: true });
      return;
    }
    ready = true;
    gate.hidden = true;
    keyboard.inert = false;
    measureKeys();
  } catch (error) { showSoundGate(error.message); }
  finally { start.disabled = false; }
});

window.addEventListener("blur", stopPlaying);
window.addEventListener("pagehide", stopPlaying);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlaying(); });
portrait.addEventListener("change", () => {
  stopPlaying();
  measureKeys();
});

// No polling or application API requests. Only our static app shell is cached.
async function prepareOffline() {
  const status = document.querySelector("#offline-state");
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    status.textContent = "Offline needs an HTTPS link";
    return;
  }
  try {
    await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url));
    await navigator.serviceWorker.ready;
    status.textContent = "Ready for offline";
  } catch {
    status.textContent = "Online only · reopen to retry";
  }
}
prepareOffline();
