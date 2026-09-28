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

// Touch Events supply the complete live finger list, unlike individual pointer
// events. Reconcile against it on every gesture so a missed release cannot keep
// a note latched. Mouse/pen/keyboard contacts are deliberately left alone.
export class TouchInput {
  constructor(contacts, noteAt) {
    this.contacts = contacts;
    this.noteAt = noteAt;
  }

  reconcile(event) {
    const live = new Set(Array.from(event.touches, (touch) => `touch:${touch.identifier}`));
    for (const id of this.contacts.contacts.keys()) {
      if (typeof id === "string" && id.startsWith("touch:") && !live.has(id)) this.contacts.end(id);
    }
  }

  begin(event) {
    // A new touch may reuse a missed-release ID, even when it starts in the
    // blank space. Run this in document capture before any keyboard handler.
    for (const touch of event.changedTouches) this.contacts.end(`touch:${touch.identifier}`);
    this.reconcile(event);
  }

  start(event) {
    this.begin(event);
    for (const touch of event.changedTouches) {
      this.contacts.set(`touch:${touch.identifier}`, this.noteAt(touch.clientX, touch.clientY));
    }
  }

  move(event) {
    this.reconcile(event);
    for (const touch of event.changedTouches) {
      const id = `touch:${touch.identifier}`;
      // Never activate a touch that began in the non-playing space, or revive
      // an old finger after Reset/blur until it has been lifted and retouched.
      if (this.contacts.has(id)) this.contacts.set(id, this.noteAt(touch.clientX, touch.clientY));
    }
  }

  end(event) {
    for (const touch of event.changedTouches) this.contacts.end(`touch:${touch.identifier}`);
    this.reconcile(event);
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
