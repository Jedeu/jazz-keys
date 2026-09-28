// Each contact owns a note. A note stays down until its LAST owner lets go.
// Moving inside a key does nothing; crossing a boundary changes notes once.
export class NoteContacts {
  constructor({ onPress = () => {}, onRelease = () => {}, onChange = () => {} } = {}) {
    this.contacts = new Map();
    this.counts = new Map();
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onChange = onChange;
  }

  get notes() { return [...this.counts.keys()].sort((a, b) => a - b); }
  has(id) { return this.contacts.has(id); }

  set(id, note) {
    const previous = this.contacts.get(id) ?? null;
    this.contacts.set(id, note);
    if (previous === note) return;
    if (previous !== null) {
      const remaining = this.counts.get(previous) - 1;
      if (remaining) this.counts.set(previous, remaining);
      else {
        this.counts.delete(previous);
        this.onRelease(previous);
      }
    }
    if (note !== null) {
      const count = this.counts.get(note) ?? 0;
      this.counts.set(note, count + 1);
      if (!count) this.onPress(note);
    }
    this.onChange(this.notes);
  }

  end(id) {
    if (!this.has(id)) return;
    this.set(id, null);
    this.contacts.delete(id);
  }

  clear() {
    const notes = this.notes;
    this.contacts.clear();
    this.counts.clear();
    for (const note of notes) this.onRelease(note);
    if (notes.length) this.onChange([]);
  }
}

// Rectangles are cached on layout changes, not read on every touch event.
// Black keys win where their rectangles overlap the white keys beneath them.
export function hitTest(x, y, rectangles) {
  const contains = (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  return rectangles.find((r) => r.black && contains(r))?.note
    ?? rectangles.find((r) => !r.black && contains(r))?.note
    ?? null;
}
