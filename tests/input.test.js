import test from "node:test";
import assert from "node:assert/strict";
import { NoteContacts, TouchInput, hitTest } from "../src/input.js";

function setup() {
  const events = [];
  const input = new NoteContacts({
    onPress: (note) => events.push(["on", note]),
    onRelease: (note) => events.push(["off", note]),
  });
  return { input, events };
}

test("supports ten simultaneous contacts", () => {
  const { input, events } = setup();
  for (let i = 0; i < 10; i++) input.set(i, 48 + i);
  assert.equal(input.notes.length, 10);
  assert.equal(events.length, 10);
  input.clear();
  assert.deepEqual(input.notes, []);
  assert.equal(events.filter(([type]) => type === "off").length, 10);
});
test("movement within the same key never retriggers", () => {
  const { input, events } = setup();
  for (let i = 0; i < 100; i++) input.set(1, 48);
  assert.deepEqual(events, [["on", 48]]);
});
test("glide releases previous note, starts next note exactly once", () => {
  const { input, events } = setup();
  input.set(1, 48);
  input.set(1, 49);
  input.set(1, 49);
  input.end(1);
  input.end(1); // lostpointercapture after pointerup is harmless
  assert.deepEqual(events, [["on", 48], ["off", 48], ["on", 49], ["off", 49]]);
});
test("two fingers share a key until the last finger releases", () => {
  const { input, events } = setup();
  input.set(1, 48);
  input.set(2, 48);
  input.end(1);
  assert.deepEqual(input.notes, [48]);
  assert.deepEqual(events, [["on", 48]]);
  input.end(2);
  assert.deepEqual(events, [["on", 48], ["off", 48]]);
});
test("glide onto a held key doesn't retrigger or release the other finger", () => {
  const { input, events } = setup();
  input.set(1, 48);
  input.set(2, 50);
  input.set(1, 50);
  input.end(2);
  assert.deepEqual(input.notes, [50]);
  assert.deepEqual(events, [["on", 48], ["on", 50], ["off", 48]]);
  input.end(1);
  assert.deepEqual(events.at(-1), ["off", 50]);
});
test("leaving and reentering the keyboard doesn't leave a stuck note", () => {
  const { input, events } = setup();
  input.set(1, 48);
  input.set(1, null);
  assert.equal(input.has(1), true);
  input.set(1, 52);
  input.clear();
  input.end(1);
  assert.deepEqual(events, [["on", 48], ["off", 48], ["on", 52], ["off", 52]]);
});
test("a glide publishes one complete chord change, not an intermediate one", () => {
  const changes = [];
  const input = new NoteContacts({ onChange: (notes) => changes.push(notes) });
  input.set(1, 48);
  input.set(2, 52);
  input.set(1, 50);
  assert.deepEqual(changes, [[48], [48, 52], [50, 52]]);
});
const finger = (identifier, note) => ({ identifier, clientX: note, clientY: 0 });
const touchEvent = (touches, changedTouches = touches) => ({ touches, changedTouches });

test("native multi-touch tracks ten fingers independently", () => {
  const { input, events } = setup();
  const touch = new TouchInput(input, (x) => x);
  const fingers = Array.from({ length: 10 }, (_, i) => finger(i, 48 + i));
  touch.start(touchEvent(fingers));
  assert.equal(input.notes.length, 10);
  touch.end(touchEvent([], fingers));
  assert.equal(input.notes.length, 0);
  assert.equal(events.length, 20);
});
test("a missed touch release is repaired by the next gesture", () => {
  const { input, events } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48)]));
  // No touchend is delivered for finger 1. The next live list is authoritative.
  touch.start(touchEvent([finger(2, 48)]));
  assert.deepEqual(events, [["on", 48], ["off", 48], ["on", 48]]);
  assert.equal(input.has("touch:1"), false);
  touch.end(touchEvent([], [finger(2, 48)]));
  assert.deepEqual(input.notes, []);
});
test("a reused touch identifier starts a fresh note, rather than staying latched", () => {
  const { input, events } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48)]));
  touch.start(touchEvent([finger(1, 48)]));
  assert.deepEqual(events, [["on", 48], ["off", 48], ["on", 48]]);
});
test("touchmove clears a vanished finger but preserves the fingers still held", () => {
  const { input } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48), finger(2, 52)]));
  touch.move(touchEvent([finger(2, 53)]));
  assert.deepEqual(input.notes, [53]);
});
test("shared native touches neither retrigger nor release the other finger", () => {
  const { input, events } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48)]));
  touch.start(touchEvent([finger(1, 48), finger(2, 48)], [finger(2, 48)]));
  touch.end(touchEvent([finger(2, 48)], [finger(1, 48)]));
  touch.move(touchEvent([finger(2, 48)]));
  assert.deepEqual(events, [["on", 48]]);
  touch.end(touchEvent([], [finger(2, 48)]));
  assert.deepEqual(events, [["on", 48], ["off", 48]]);
});
test("global touch cleanup doesn't end mouse, pen, or physical keyboard notes", () => {
  const { input } = setup();
  const touch = new TouchInput(input, (x) => x);
  input.set(10, 48);
  input.set("key:52:Space", 52);
  touch.start(touchEvent([finger(1, 55)]));
  touch.end(touchEvent([], [finger(1, 55)]));
  assert.deepEqual(input.notes, [48, 52]);
});
test("blank-space touches never start notes, even if they later move onto keys", () => {
  const { input } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.begin(touchEvent([finger(1, 48)]));
  touch.move(touchEvent([finger(1, 52)]));
  assert.deepEqual(input.notes, []);
});
test("a reused ID beginning on blank space releases the stale key without playing", () => {
  const { input, events } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(0, 48)]));
  // Missed release, then a new touch with the SAME identifier outside the keys.
  touch.begin(touchEvent([finger(0, 52)]));
  assert.deepEqual(input.notes, []);
  touch.move(touchEvent([finger(0, 55)]));
  assert.deepEqual(events, [["on", 48], ["off", 48]]);
});
test("cancel clears all absent contacts, not just the changedTouches subset", () => {
  const { input } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48), finger(2, 52)]));
  touch.end(touchEvent([], [finger(1, 48)]));
  assert.deepEqual(input.notes, []);
});
test("fingers still down after Reset/blur cannot revive notes until retouched", () => {
  const { input } = setup();
  const touch = new TouchInput(input, (x) => x);
  touch.start(touchEvent([finger(1, 48)]));
  input.clear();
  touch.move(touchEvent([finger(1, 52)]));
  assert.deepEqual(input.notes, []);
  touch.end(touchEvent([], [finger(1, 52)]));
  touch.start(touchEvent([finger(2, 52)]));
  assert.deepEqual(input.notes, [52]);
});

test("black keys take hit-test priority; lower area belongs to white keys", () => {
  const rects = [
    { note: 48, left: 0, right: 100, top: 40, bottom: 700, black: false },
    { note: 50, left: 100, right: 200, top: 40, bottom: 700, black: false },
    { note: 49, left: 70, right: 130, top: 40, bottom: 430, black: true },
  ];
  assert.equal(hitTest(80, 80, rects), 49);
  assert.equal(hitTest(120, 80, rects), 49);
  assert.equal(hitTest(80, 500, rects), 48);
  assert.equal(hitTest(100, 500, rects), 50);
  assert.equal(hitTest(200, 500, rects), null);
  assert.equal(hitTest(20, 30, rects), null);
  assert.equal(hitTest(-1, 500, rects), null);
});
