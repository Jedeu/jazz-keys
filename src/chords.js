// Pitch-class matching, independent of touch order and octave doubling.
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const pc = (note) => ((note % 12) + 12) % 12;

// The unaltered fifth (and ninth in thirteenths) may be omitted. A missing third/seventh must not
// silently turn an ambiguous collection of notes into a confident jazz label.
const SHAPES = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["sus2", [0, 2, 7]],
  ["sus4", [0, 5, 7]],
  ["maj7", [0, 4, 7, 11], true],
  ["m7", [0, 3, 7, 10], true],
  ["7", [0, 4, 7, 10], true],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["6", [0, 4, 7, 9], true],
  ["m6", [0, 3, 7, 9], true],
  ["maj9", [0, 2, 4, 7, 11], true, true],
  ["m9", [0, 2, 3, 7, 10], true, true],
  ["9", [0, 2, 4, 7, 10], true, true],
  ["add9", [0, 2, 4, 7]],
  ["madd9", [0, 2, 3, 7]],
  ["6/9", [0, 2, 4, 7, 9], true],
  ["m6/9", [0, 2, 3, 7, 9], true],
  ["mMaj7", [0, 3, 7, 11], true],
  ["7sus4", [0, 5, 7, 10], true],
  ["7b9", [0, 1, 4, 7, 10], true],
  ["7#9", [0, 3, 4, 7, 10], true],
  ["7b5", [0, 4, 6, 10]],
  ["7#5", [0, 4, 8, 10]],
  ["m11", [0, 2, 3, 5, 7, 10], true],
  ["11", [0, 2, 4, 5, 7, 10], true],
  ["maj13", [0, 2, 4, 7, 9, 11], true, false, true],
  ["m13", [0, 2, 3, 7, 9, 10], true, false, true],
  ["13", [0, 2, 4, 7, 9, 10], true, false, true],
];

export function detectChord(notes) {
  const sorted = [...new Set(notes)].filter(Number.isInteger).sort((a, b) => a - b);
  const pitches = [...new Set(sorted.map(pc))];
  if (pitches.length < 3) return null;
  const bass = pc(sorted[0]);
  let best = null;

  const consider = (played, externalBass) => {
    for (let root = 0; root < 12; root++) {
      const intervals = played.map((pitch) => pc(pitch - root));
      for (const [suffix, shape, allowFifth, allowRootless, allowNinth] of SHAPES) {
        if (intervals.some((interval) => !shape.includes(interval))) continue;
        const missing = shape.filter((interval) => !intervals.includes(interval));
        if (missing.some((interval) => !(interval === 7 && allowFifth)
          && !(interval === 0 && allowRootless) && !(interval === 2 && allowNinth))) continue;
        const rootless = missing.includes(0);
        // Do not infer an absent root AND an unrelated slash bass.
        if (rootless && externalBass) continue;
        const score = 100 - missing.length * 6 - (rootless ? 24 : 0)
          - (externalBass ? 18 : 0) + (bass === root ? 4 : 0);
        if (!best || score > best.score) {
          best = {
            name: `${NAMES[root]}${suffix}${bass === root ? "" : `/${NAMES[bass]}`}`,
            root, bass, rootless, omittedFifth: missing.includes(7), score,
          };
        }
      }
    }
  };

  consider(pitches, false);
  // Also support an independent bass under a recognizable upper chord.
  // Remove its pitch class, not just one note: doubling the bass cannot change
  // the harmony (Cmaj7/F stays Cmaj7/F when another F is played an octave up).
  const upper = pitches.filter((pitch) => pitch !== bass);
  if (upper.length >= 3) consider(upper, true);
  if (!best) return null;
  const { score, ...result } = best;
  return result;
}

export function prettyChord(name) {
  return name.replaceAll("b", "♭").replaceAll("#", "♯");
}
