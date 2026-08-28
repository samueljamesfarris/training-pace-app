/**
 * Speech is the enhancement, never the channel anything depends on.
 *
 * `speechSynthesis` on iOS fails silently after interruptions, loads its voices
 * asynchronously, and can leave the queue wedged after a phone call. So every
 * call here is best-effort and wrapped: if speech dies mid-workout the beeps
 * carry on and the ride is unaffected. Nothing in this file throws.
 *
 * Phrases are deliberately short — "On 2", "1:59, 7 30 pace" — because a long
 * sentence is still talking when the next thing happens.
 */

export interface SpeechSettings {
  enabled: boolean;
  /** 0.5 slow .. 2 fast. iOS clamps beyond that anyway. */
  rate: number;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_SPEECH: SpeechSettings = {
  enabled: true,
  rate: 1.1,
  volume: 1,
};

/**
 * Numbers as a person says them. "8:04" read literally comes out as
 * "eight colon zero four"; a pace is spoken "eight oh four".
 */
export function speakablePace(secPerMile: number | null): string | null {
  if (secPerMile == null || !Number.isFinite(secPerMile)) return null;
  const total = Math.round(secPerMile);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${m} flat`;
  if (s < 10) return `${m} oh ${s}`;
  return `${m} ${s}`;
}

/**
 * A duration the way you'd say it out loud.
 *
 * Truncates, because this reads out a split and the screen showing that same
 * split truncates too — rounding here made the voice say "29 seconds" next to
 * a pill reading 0:28. Stopwatches truncate; only countdowns round up.
 */
export function speakableDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} second${s === 1 ? '' : 's'}`;
  if (s === 0) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${m} ${s < 10 ? 'oh ' : ''}${s}`;
}

/**
 * A segment's name the way it should be said.
 *
 * Inside a repeat set the index is a count, not part of the name, and "Rest 2"
 * read aloud is ambiguous with a segment actually called that. "Rest number 2"
 * is how a coach says it on a track.
 */
export function spokenSegmentName(seg: {
  name: string;
  baseName?: string;
  repeatIndex?: number;
}): string {
  if (seg.repeatIndex == null || !seg.baseName) return seg.name;
  return `${seg.baseName} number ${seg.repeatIndex}`;
}

/** What the voice says at a boundary, in order. Empty means stay quiet. */
export function boundaryPhrases(
  closed: {
    durationMs: number;
    /** Null when no pace worth stating was measured. */
    paceSecPerMile: number | null;
    /** True when it was a rep inside a repeat set. */
    inRepeat: boolean;
  } | null,
  /** Already spoken-form; null on the last segment and on a free-run lap. */
  nextName: string | null,
): string[] {
  const out: string[] = [];

  /*
   * A rep inside a set gets no report at all. On a 60-second rep the callout
   * is still talking when the next rep has started, and by then what matters
   * is what to do now, not what just happened. A standalone step is different:
   * there the split is the point, so it keeps its time and pace.
   *
   * Under two seconds is a mis-tap either way, and never worth a eulogy.
   */
  if (closed && !closed.inRepeat && closed.durationMs > 2000) {
    const pace = speakablePace(closed.paceSecPerMile);
    out.push(`${speakableDuration(closed.durationMs)}${pace ? `, ${pace} pace` : ''}`);
  }
  if (nextName) out.push(nextName);
  return out;
}

export class SpeechEngine {
  settings: SpeechSettings = { ...DEFAULT_SPEECH };
  private voice: SpeechSynthesisVoice | null = null;
  private warmed = false;

  get supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  private pickVoice() {
    if (!this.supported) return;
    try {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return; // still loading; try again later
      this.voice =
        voices.find((v) => v.lang.startsWith('en') && v.localService) ??
        voices.find((v) => v.lang.startsWith('en')) ??
        voices[0] ??
        null;
    } catch {
      this.voice = null;
    }
  }

  /**
   * Prime the engine from a user gesture. iOS won't speak otherwise, and the
   * first utterance after a cold start is the one most likely to be swallowed,
   * so it's spent here on silence rather than on a real cue.
   */
  warm() {
    if (!this.supported) return;
    try {
      this.pickVoice();
      // Voices often aren't ready on the first call.
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice(), {
        once: true,
      });
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = this.settings.rate;
      window.speechSynthesis.speak(u);
      this.warmed = true;
    } catch {
      // Speech simply won't be available; the beeps still are.
    }
  }

  /**
   * Clear a wedged queue. iOS can leave `speaking` stuck true after a call or a
   * backgrounding, and every later utterance is then dropped silently.
   */
  recover() {
    if (!this.supported || !this.warmed) return;
    try {
      const s = window.speechSynthesis;
      if (s.paused) s.resume();
      if (s.speaking || s.pending) s.cancel();
    } catch {
      // Nothing to do.
    }
  }

  say(text: string) {
    if (!this.supported || !this.settings.enabled || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = this.settings.rate;
      u.volume = this.settings.volume;
      window.speechSynthesis.speak(u);
    } catch {
      // Best effort, always.
    }
  }

  cancel() {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing to do.
    }
  }
}
