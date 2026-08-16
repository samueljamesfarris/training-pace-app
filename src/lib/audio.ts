/**
 * Beeps are the primary channel. Everything here is scheduled against
 * `AudioContext.currentTime` rather than setTimeout, so a cue fires on time even
 * when iOS throttles the JS timer loop — which it does the moment the screen
 * dims or a notification lands.
 *
 * Cue vocabulary (kept distinct so they're told apart at speed, outdoors):
 *
 *   10 s warning   two short beeps at 784 Hz        "ten seconds"
 *   3 / 2 / 1      one short beep at 1046 Hz        "counting down"
 *   boundary       one long 1.5 s beep at 1568 Hz   "go / next segment"
 *   manual lap     one short chirp at 1318 Hz
 *
 * Frequencies sit in the 750–1600 Hz band where a phone speaker is loudest and
 * wind noise is weakest; a bike at 10 mph is a noisy place.
 */

export type CueName = 'warning' | 'countdown' | 'boundary' | 'lap';

interface ToneSpec {
  freq: number;
  /** Seconds. */
  duration: number;
  /** Offset from the cue's start, in seconds. */
  at: number;
}

const CUES: Record<CueName, ToneSpec[]> = {
  warning: [
    { freq: 784, duration: 0.12, at: 0 },
    { freq: 784, duration: 0.12, at: 0.22 },
  ],
  countdown: [{ freq: 1046, duration: 0.13, at: 0 }],
  boundary: [{ freq: 1568, duration: 1.5, at: 0 }],
  lap: [{ freq: 1318, duration: 0.1, at: 0 }],
};

/** Seconds before a segment ends at which each cue fires. */
export const WARNING_AT_SEC = 10;
export const COUNTDOWN_AT_SEC = [3, 2, 1];

export interface AudioSettings {
  enabled: boolean;
  warning: boolean;
  countdown: boolean;
  boundary: boolean;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_AUDIO: AudioSettings = {
  enabled: true,
  warning: true,
  countdown: true,
  boundary: true,
  volume: 1,
};

export class BeepEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Scheduled sources plus their start times, so a reschedule can cancel
   *  the ones that haven't sounded yet — and only those. */
  private pending: { osc: OscillatorNode; startAt: number }[] = [];
  settings: AudioSettings = { ...DEFAULT_AUDIO };

  /** Must be called from a user gesture — iOS refuses to start audio otherwise. */
  init() {
    if (this.ctx) {
      void this.resume();
      return;
    }
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    // Audio must never be able to take the workout down with it: a failure
    // here should cost beeps, not the session.
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.volume;
      this.master.connect(this.ctx.destination);
      // A silent blip inside the gesture unlocks the pipeline on iOS, so the
      // first real cue isn't the one that gets swallowed.
      this.tone(this.ctx.currentTime, { freq: 440, duration: 0.05, at: 0 }, 0.0001);
    } catch (e) {
      console.warn('[audio] init failed; continuing without cues', e);
      this.ctx = null;
      this.master = null;
    }
  }

  get ready() {
    return this.ctx != null;
  }

  get state() {
    return this.ctx?.state ?? 'none';
  }

  /** Call on every visibilitychange back to visible, and after interruptions. */
  async resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // Nothing to do; the next user gesture will retry.
      }
    }
  }

  setVolume(v: number) {
    this.settings.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private enabledFor(cue: CueName): boolean {
    if (!this.settings.enabled) return false;
    if (cue === 'warning') return this.settings.warning;
    if (cue === 'countdown') return this.settings.countdown;
    if (cue === 'boundary') return this.settings.boundary;
    return true;
  }

  private tone(startAt: number, spec: ToneSpec, gainOverride?: number, cancellable = true) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square'; // carries further through wind than a sine
    osc.frequency.value = spec.freq;

    // Never schedule into the past: on a freshly created context currentTime
    // is 0, and a negative AudioParam time throws.
    const t = Math.max(startAt + spec.at, this.ctx.currentTime);
    const peak = gainOverride ?? 0.32;
    // Short ramps instead of hard edges; a square wave switched instantly
    // clicks, and the click is what sounds broken on a phone speaker. Scaled to
    // the tone's own length so a very short blip can't invert its envelope.
    const attack = Math.min(0.012, spec.duration * 0.25);
    const release = Math.min(0.02, spec.duration * 0.25);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + spec.duration - release);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + spec.duration + 0.02);
    // Only future, scheduled cues are cancellable. A cue fired *now* is a fact
    // about the present; a later reschedule must not silence it mid-beep.
    if (cancellable) {
      const entry = { osc, startAt: t };
      this.pending.push(entry);
      osc.onended = () => {
        this.pending = this.pending.filter((e) => e !== entry);
      };
    }
  }

  /**
   * Schedule a cue at an absolute wall-clock instant. Returns false if it
   * couldn't be scheduled (no audio yet, or the moment has already passed).
   */
  scheduleAt(cue: CueName, wallClockMs: number): boolean {
    if (!this.ctx || !this.enabledFor(cue)) return false;
    const leadSec = (wallClockMs - Date.now()) / 1000;
    if (leadSec < 0.05) return false;
    const startAt = this.ctx.currentTime + leadSec;
    for (const spec of CUES[cue]) this.tone(startAt, spec);
    return true;
  }

  /** Fire a cue now — for events with no knowable future time, like a lap. */
  play(cue: CueName) {
    if (!this.ctx || !this.enabledFor(cue)) return;
    void this.resume();
    const startAt = this.ctx.currentTime + 0.02;
    for (const spec of CUES[cue]) this.tone(startAt, spec, undefined, false);
  }

  /** Preview a cue regardless of its toggle, for the settings test buttons. */
  preview(cue: CueName) {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    void this.resume();
    const startAt = this.ctx.currentTime + 0.02;
    for (const spec of CUES[cue]) this.tone(startAt, spec, undefined, false);
  }

  /**
   * Drop everything not yet sounded — after a pause, or a manual advance.
   *
   * Crucially, a cue that has *already started* is left alone. Segments
   * re-schedule the instant they advance, which is the same instant the 1.5s
   * boundary tone begins; cancelling indiscriminately clipped it to a click
   * every single time.
   */
  cancelPending() {
    const now = this.ctx?.currentTime ?? 0;
    const stillPending: typeof this.pending = [];
    for (const entry of this.pending) {
      if (entry.startAt > now + 0.01) {
        try {
          entry.osc.stop();
        } catch {
          // Already stopped; harmless.
        }
      } else {
        stillPending.push(entry);
      }
    }
    this.pending = stillPending;
  }
}
