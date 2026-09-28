const FLOOR = 0.0001;
const ATTACK = 0.004;
const RELEASE = 0.12;
export const IDLE_MS = 30_000;
export const MAX_VOICES = 32;

export const frequencyFor = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Analytic envelope value for Safari versions without cancelAndHoldAtTime.
export function envelopeAt(points, time) {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [end, value] = points[i];
    const [start, previous] = points[i - 1];
    if (time <= end) return previous * (value / previous) ** ((time - start) / (end - start));
  }
  return points.at(-1)[1];
}

export class PianoAudio {
  constructor(onState = () => {}) {
    this.context = null;
    this.disposed = false;
    this.active = new Map();
    this.sounding = new Set();
    this.idleTimer = null;
    this.sleeping = false;
    this.pendingSuspend = null;
    this.resuming = 0;
    this.onState = onState;
  }

  create() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error("This browser does not support Web Audio. Please use Safari.");
    const ctx = this.context = new AudioContext({ latencyHint: "interactive" });
    this.master = ctx.createGain();
    this.master.gain.value = 0.65;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.12;
    this.compressor.connect(this.master).connect(ctx.destination);
    // Harmonic body rather than a harsh stock sawtooth; no audio files/buffers.
    const partials = new Float32Array([0, 1, 0.42, 0.21, 0.11, 0.065, 0.035, 0.018]);
    this.wave = ctx.createPeriodicWave(new Float32Array(partials.length), partials);
    ctx.onstatechange = () => this.onState(ctx.state);
  }

  // Call directly within a user event, before awaiting anything.
  resume() {
    if (this.disposed) return Promise.reject(new Error("This audio engine has been reset."));
    if (!this.context) this.create();
    clearTimeout(this.idleTimer);
    this.sleeping = false;
    const pendingSuspend = this.pendingSuspend;
    this.resuming++;
    // Always request resume in the gesture, even if state still says running:
    // a suspend operation may have been queued on the audio thread already.
    return this.context.resume().then(async () => {
      if (this.disposed) return;
      if (pendingSuspend) {
        await pendingSuspend;
        if (!this.sleeping && !this.disposed) await this.context.resume();
      }
      // A newer lock/blur/reset request wins over an older in-flight resume.
      if (this.sleeping || this.disposed) return;
      if (this.context.state !== "running") throw new Error("Sound is paused. Tap to try again.");
      this.onState("running");
      if (!this.sounding.size) this.scheduleSleep();
    }).finally(() => { this.resuming--; });
  }

  noteOn(midi) {
    if (this.disposed || !this.context || this.context.state === "closed") return;
    clearTimeout(this.idleTimer);
    this.noteOff(midi);
    // Bound release tails even during very fast glissandi.
    if (this.sounding.size >= MAX_VOICES) this.destroy(this.sounding.values().next().value);
    const ctx = this.context;
    const now = ctx.currentTime;
    const duration = 2.8 - (midi - 48) * 0.025;
    const oscillator = ctx.createOscillator();
    const tone = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    oscillator.setPeriodicWave(this.wave);
    oscillator.frequency.value = frequencyFor(midi);
    tone.type = "lowpass";
    tone.Q.value = 0.35;
    tone.frequency.setValueAtTime(4400, now);
    tone.frequency.exponentialRampToValueAtTime(850, now + 0.9);
    const points = [[now, FLOOR], [now + ATTACK, 0.19], [now + 0.09, 0.075], [now + duration, FLOOR]];
    gain.gain.setValueAtTime(FLOOR, now);
    for (const [time, value] of points.slice(1)) gain.gain.exponentialRampToValueAtTime(value, time);
    oscillator.connect(tone).connect(gain).connect(this.compressor);
    const voice = { midi, oscillator, tone, gain, points };
    this.active.set(midi, voice);
    this.sounding.add(voice);
    oscillator.onended = () => this.cleanup(voice);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  noteOff(midi) {
    const voice = this.active.get(midi);
    if (!voice) return;
    this.active.delete(midi);
    const now = this.context.currentTime;
    const param = voice.gain.gain;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(envelopeAt(voice.points, now), now);
    }
    param.exponentialRampToValueAtTime(FLOOR, now + RELEASE);
    voice.oscillator.stop(now + RELEASE + 0.01);
  }

  cleanup(voice) {
    if (!this.sounding.delete(voice)) return;
    if (this.active.get(voice.midi) === voice) this.active.delete(voice.midi);
    voice.oscillator.onended = null;
    voice.oscillator.disconnect();
    voice.tone.disconnect();
    voice.gain.disconnect();
    if (!this.sounding.size) this.scheduleSleep();
  }

  destroy(voice) {
    voice.oscillator.stop();
    this.cleanup(voice);
  }

  scheduleSleep() {
    clearTimeout(this.idleTimer);
    if (this.disposed || this.context?.state !== "running") return;
    this.idleTimer = setTimeout(() => {
      if (this.sounding.size || this.context.state !== "running") return;
      this.suspend();
    }, IDLE_MS);
  }

  suspend() {
    this.sleeping = true;
    const pending = this.context.suspend().catch(() => { this.sleeping = false; });
    this.pendingSuspend = pending;
    pending.finally(() => {
      if (this.pendingSuspend === pending) this.pendingSuspend = null;
    });
  }

  dispose() {
    this.disposed = true;
    this.onState = () => {};
    if (this.context) this.context.onstatechange = null;
    this.silence();
    this.master?.disconnect();
    this.compressor?.disconnect();
    // Don't block a user-triggered recovery on another potentially stuck
    // audio-thread promise. Old callbacks are detached before closing.
    if (this.context && this.context.state !== "closed") this.context.close().catch(() => {});
  }

  // On lock, tab switch, or orientation change, leave no voices to resume later.
  silence({ suspend = false } = {}) {
    for (const voice of [...this.sounding]) this.destroy(voice);
    clearTimeout(this.idleTimer);
    if (suspend && this.context && this.context.state !== "closed") {
      this.suspend();
    } else this.scheduleSleep();
  }
}
