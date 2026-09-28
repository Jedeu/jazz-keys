import test from "node:test";
import assert from "node:assert/strict";
import { detectChord, prettyChord } from "../src/chords.js";

const roots = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const families = [
  ["", [0, 4, 7]], ["m", [0, 3, 7]],
  ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]],
  ["7", [0, 4, 7, 10]], ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]], ["6", [0, 4, 7, 9]],
  ["m6", [0, 3, 7, 9]], ["9", [0, 2, 4, 7, 10]],
  ["maj9", [0, 2, 4, 7, 11]], ["m9", [0, 2, 3, 7, 10]],
  ["6/9", [0, 2, 4, 7, 9]], ["7b9", [0, 1, 4, 7, 10]],
  ["7#9", [0, 3, 4, 7, 10]], ["7b5", [0, 4, 6, 10]],
  ["7#5", [0, 4, 8, 10]], ["7sus4", [0, 5, 7, 10]],
  ["maj13", [0, 2, 4, 7, 9, 11]], ["m13", [0, 2, 3, 7, 9, 10]],
  ["13", [0, 2, 4, 7, 9, 10]], ["m11", [0, 2, 3, 5, 7, 10]],
];
for (const [suffix, intervals] of families) {
  for (let root = 0; root < 12; root++) {
    test(`${roots[root]}${suffix}: root position`, () => {
      assert.equal(detectChord(intervals.map((n) => 48 + root + n))?.name, roots[root] + suffix);
    });
  }
}

const voicings = [
  ["Dm7", [50, 53, 57, 60]],
  ["G7", [55, 59, 62, 65]],
  ["Cmaj9", [48, 52, 55, 59, 62]],
  ["Cmaj7/E", [52, 55, 59, 60]],
  ["G7/B", [59, 62, 65, 67]],
  ["Dm9/F", [53, 57, 60, 62, 64]],
  ["Cmaj7", [48, 52, 59]], // shell, no fifth
  ["Dm7", [50, 53, 60]],
  ["G7", [55, 59, 65]],
  ["Cmaj9", [48, 52, 59, 62]],
  ["C9", [48, 52, 58, 62]],
  ["Cm9", [48, 51, 58, 62]],
  ["Cm7b5", [48, 51, 54, 58]],
  ["Cdim7", [48, 51, 54, 57]],
  ["C6", [48, 52, 55, 57]],
  ["Am7", [57, 60, 64, 67]], // same pitch classes as C6; bass breaks tie
  ["Em7", [52, 55, 59, 62]], // don't assert a speculative rootless Cmaj9
  ["C9/E", [52, 58, 62]], // guide tones + ninth, no better played-root match
  ["C/Db", [49, 60, 64, 67]],
  ["Cmaj7/F", [53, 60, 64, 67, 71]],
  ["Bbmaj7", [58, 62, 65, 69]],
  ["Cmaj13", [48, 52, 55, 59, 62, 69]],
  ["Cmaj13", [48, 52, 59, 62, 69]],
  ["C13", [48, 52, 58, 69]],
];
for (const [expected, notes] of voicings) {
  test(`voicing ${notes.join(",")} → ${expected}`, () => {
    assert.equal(detectChord(notes)?.name, expected);
    assert.equal(detectChord([...notes].reverse())?.name, expected, "touch order must not matter");
    assert.equal(detectChord([...notes, Math.min(...notes) + 12])?.name, expected, "doubling the bass must not matter");
  });
}

test("octave doublings and duplicate contacts do not change the chord", () => {
  assert.equal(detectChord([48, 52, 55, 59, 60, 64, 67, 71, 48]).name, "Cmaj7");
});
test("fewer than three distinct pitches is blank", () => {
  for (const notes of [[], [48], [48, 52], [48, 60, 72], [48, 52, 60, 64]]) {
    assert.equal(detectChord(notes), null);
  }
});
test("unknown cluster is not forced into a name", () => {
  assert.equal(detectChord([48, 49, 50]), null);
  assert.equal(detectChord([48, 49, 50, 51, 52, 53]), null);
});
test("a slash bass can be doubled without changing its name", () => {
  assert.equal(detectChord([49, 60, 61, 64, 67])?.name, "C/Db");
  assert.equal(detectChord([53, 60, 64, 65, 67, 71])?.name, "Cmaj7/F");
});
test("rootless results carry uncertainty metadata", () => {
  assert.equal(detectChord([52, 58, 62]).rootless, true);
  assert.equal(detectChord([48, 52, 59]).omittedFifth, true);
});
test("readable accidentals", () => {
  assert.equal(prettyChord("Bbm7b5/F#"), "B♭m7♭5/F♯");
});
