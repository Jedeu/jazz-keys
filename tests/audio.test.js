import test from "node:test";
import assert from "node:assert/strict";
import { PianoAudio, frequencyFor, envelopeAt, IDLE_MS, MAX_VOICES } from "../src/audio.js";

class Param {
  constructor() { this.events = []; }
  setValueAtTime(...args) { this.events.push(["set", ...args]); }
  exponentialRampToValueAtTime(...args) { this.events.push(["ramp", ...args]); }
  cancelScheduledValues(...args) { this.events.push(["cancel", ...args]); }
}
class Node {
  constructor() {
    for (const name of ["gain", "frequency", "Q", "threshold", "knee", "ratio", "attack", "release"]) this[name] = new Param();
  }
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
  setPeriodicWave() {}
  start(time) { this.started = time; }
  stop(time) { this.stopped = time; }
}
class FakeContext {
  constructor(options) {
    this.options = options;
    this.state = "suspended";
    this.currentTime = 0;
    this.destination = new Node();
    this.resumeCalls = 0;
  }
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createPeriodicWave() { return {}; }
  resume() { this.resumeCalls++; this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}
function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  t.after(() => {
    if (previous) globalThis.AudioContext = previous;
    else delete globalThis.AudioContext;
  });
  const audio = new PianoAudio();
  t.after(() => audio.silence());
  return audio;
}

test("standard pitch across C3 through B5", () => {
  assert.equal(frequencyFor(69), 440);
  assert.ok(Math.abs(frequencyFor(48) - 130.8128) < 0.001);
  assert.ok(Math.abs(frequencyFor(71) - 493.8833) < 0.001);
  assert.ok(Math.abs(frequencyFor(83) - 987.7666) < 0.001);
});
test("all three octaves schedule valid decay envelopes", async (t) => {
  const audio = setup(t);
  await audio.resume();
  for (let note = 48; note <= 83; note++) {
    audio.noteOn(note);
    const voice = audio.active.get(note);
    assert.equal(voice.oscillator.frequency.value, frequencyFor(note));
    assert.ok(voice.oscillator.stopped > 0.9, "the tone ramp must finish before the voice ends");
    assert.ok(voice.points.every(([time, value], index) => value > 0
      && (index === 0 || time > voice.points[index - 1][0])));
    audio.noteOff(note);
  }
});
test("fallback envelope follows exponential ramps", () => {
  assert.equal(envelopeAt([[0, 1], [2, 0.01]], 1), 0.1);
  assert.equal(envelopeAt([[0, 1], [2, 0.01]], 3), 0.01);
});
test("audio is lazy, interactive, and sleeps after 30 seconds of silence", async (t) => {
  const audio = setup(t);
  assert.equal(audio.context, null);
  await audio.resume();
  assert.equal(audio.context.options.latencyHint, "interactive");
  t.mock.timers.tick(IDLE_MS - 1);
  assert.equal(audio.context.state, "running");
  t.mock.timers.tick(1);
  assert.equal(audio.context.state, "suspended");
  await audio.resume();
  assert.equal(audio.context.state, "running");
});
test("six voices start immediately without awaiting resume", async (t) => {
  const audio = setup(t);
  await audio.resume();
  for (const note of [48, 52, 55, 59, 62, 64]) audio.noteOn(note);
  assert.equal(audio.active.size, 6);
  for (const voice of audio.sounding) assert.equal(voice.oscillator.started, 0);
  t.mock.timers.tick(IDLE_MS);
  assert.equal(audio.context.state, "running", "must not suspend while voices are sounding");
});
test("released voices fade, disconnect and then start the idle timer", async (t) => {
  const audio = setup(t);
  await audio.resume();
  audio.noteOn(48);
  const voice = audio.active.get(48);
  audio.context.currentTime = 0.1;
  audio.noteOff(48);
  assert.equal(audio.active.size, 0);
  assert.ok(voice.oscillator.stopped < 0.24);
  assert.equal(voice.gain.gain.events.at(-2)[0], "set", "Safari envelope fallback");
  voice.oscillator.onended();
  assert.equal(audio.sounding.size, 0);
  assert.equal(voice.gain.disconnected, true);
  t.mock.timers.tick(IDLE_MS);
  assert.equal(audio.context.state, "suspended");
});
test("held notes decay completely and can sleep without a pointerup", async (t) => {
  const audio = setup(t);
  await audio.resume();
  audio.noteOn(60);
  audio.active.get(60).oscillator.onended();
  assert.equal(audio.active.size, 0);
  t.mock.timers.tick(IDLE_MS);
  assert.equal(audio.context.state, "suspended");
});
test("old release-tail cleanup cannot delete a retriggered voice", async (t) => {
  const audio = setup(t);
  await audio.resume();
  audio.noteOn(60);
  const old = audio.active.get(60);
  audio.noteOff(60);
  audio.noteOn(60);
  const current = audio.active.get(60);
  old.oscillator.onended();
  assert.equal(audio.active.get(60), current);
});
test("fast glissandi have bounded polyphony; hiding destroys every voice", async (t) => {
  const audio = setup(t);
  await audio.resume();
  for (let i = 0; i < 100; i++) audio.noteOn(48 + i % 36);
  assert.equal(audio.sounding.size, MAX_VOICES);
  const voices = [...audio.sounding];
  audio.silence({ suspend: true });
  assert.equal(audio.sounding.size, 0);
  assert.equal(audio.active.size, 0);
  assert.equal(audio.context.state, "suspended");
  assert.ok(voices.every((voice) => voice.oscillator.disconnected));
});
test("resume reverses a pending suspend even if state still reports running", async (t) => {
  const audio = setup(t);
  await audio.resume();
  let finishSuspend;
  audio.context.suspend = () => new Promise((resolve) => {
    finishSuspend = () => { audio.context.state = "suspended"; resolve(); };
  });
  audio.suspend();
  const wake = audio.resume();
  audio.noteOn(60);
  assert.ok(audio.resuming > 0);
  assert.equal(audio.sleeping, false);
  finishSuspend();
  await wake;
  assert.equal(audio.context.state, "running");
  assert.equal(audio.active.size, 1, "the first note survives the transition");
  assert.equal(audio.resuming, 0);
});
test("Reset disposes all voices and the old audio graph", async (t) => {
  const audio = setup(t);
  await audio.resume();
  audio.noteOn(60);
  const voice = audio.active.get(60);
  audio.dispose();
  assert.equal(audio.context.state, "closed");
  assert.equal(audio.context.onstatechange, null);
  assert.equal(audio.sounding.size, 0);
  assert.equal(audio.active.size, 0);
  assert.equal(voice.oscillator.disconnected, true);
  assert.equal(audio.master.disconnected, true);
  assert.equal(audio.compressor.disconnected, true);
  await assert.rejects(audio.resume(), /reset/);
  audio.noteOn(60);
  assert.equal(audio.sounding.size, 0);
  t.mock.timers.tick(IDLE_MS);
  assert.equal(audio.context.state, "closed");
});
test("a late resume completion cannot revive a disposed engine", async (t) => {
  const audio = setup(t);
  await audio.resume();
  let finishResume;
  audio.context.resume = () => new Promise((resolve) => { finishResume = resolve; });
  const wake = audio.resume();
  audio.dispose();
  finishResume();
  await wake;
  assert.equal(audio.context.state, "closed");
  assert.equal(audio.resuming, 0);
  t.mock.timers.tick(IDLE_MS);
  assert.equal(audio.context.state, "closed");
});
test("a newer background suspension wins over an in-flight resume", async (t) => {
  const audio = setup(t);
  await audio.resume();
  const wake = audio.resume();
  audio.silence({ suspend: true });
  await wake;
  assert.equal(audio.context.state, "suspended");
  assert.equal(audio.sleeping, true);
});
