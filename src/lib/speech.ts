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
 *
 * What the voice is *for* is running the workout for someone with no coach and
 * no reason to look at the phone: what is starting, how long it lasts, what to
 * aim for, and a heads-up before each of those changes. Everything here is
 * budgeted against that — enough to act on, short enough to finish.
 */

import { METERS_PER_MILE } from './units';

export interface SpeechSettings {
  enabled: boolean;
  /**
   * The guiding layer: a heads-up before every transition, the length and goal
   * of what is starting, a progress call on a long segment, and the start and
   * finish callouts. Off leaves the bare reports — the split just closed and
   * the name of what is next — which is all this app used to say.
   *
   * It is a setting because how much talking helps is a question only a real
   * rep answers, and the answer may differ between a solo run and a ride
   * alongside someone.
   */
  coaching: boolean;
  /** 0.5 slow .. 2 fast. iOS clamps beyond that anyway. */
  rate: number;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_SPEECH: SpeechSettings = {
  enabled: true,
  coaching: true,
  rate: 1.1,
  volume: 1,
};

/**
 * The shape the voice needs from a segment. Structural rather than an import of
 * `SegmentDef`, so this file stays free of the workout model — its whole job is
 * turning values into words.
 */
export interface SpokenSegment {
  name: string;
  baseName?: string;
  repeatIndex?: number;
  repeatTotal?: number;
  end: { type: 'time'; seconds: number } | { type: 'distance'; meters: number };
  targetPaceSecPerMile?: number;
}

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
 * A written name read the way it is meant. "800m" spoken literally comes out
 * "eight hundred em", which on the second rep of a set is the runner wondering
 * what the phone just said instead of running.
 */
export function speakableName(raw: string): string {
  return raw.replace(/(\d)\s*mi\b/gi, '$1 miles').replace(/(\d)\s*m\b/gi, '$1 meters');
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
  if (seg.repeatIndex == null || !seg.baseName) return speakableName(seg.name);
  return `${speakableName(seg.baseName)} number ${seg.repeatIndex}`;
}

/**
 * A *planned* length, as a coach states it: "2 minutes", "1 minute 30",
 * "400 meters", "3 miles".
 *
 * Not `speakableDuration`, which reads a split off a stopwatch — "1 30" is the
 * right way to read a finishing time and the wrong way to hand out an
 * instruction, where the units are the point.
 */
export function speakableLength(seg: SpokenSegment['end']): string {
  if (seg.type === 'time') {
    const total = Math.max(0, Math.round(seg.seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m === 0) return `${s} second${s === 1 ? '' : 's'}`;
    const minutes = `${m} minute${m === 1 ? '' : 's'}`;
    return s === 0 ? minutes : `${minutes} ${s}`;
  }
  if (seg.meters >= METERS_PER_MILE) {
    // Two decimals at most: "3.11 miles" is a 5K, "3.1067 miles" is a readout.
    const miles = Math.round((seg.meters / METERS_PER_MILE) * 100) / 100;
    return `${miles} ${miles === 1 ? 'mile' : 'miles'}`;
  }
  return `${Math.round(seg.meters)} meters`;
}

/**
 * Whether a segment's name already carries its own length.
 *
 * "800 meters number 2, 800 meters" is the voice reading one fact twice at the
 * moment there is least room for it. Judged on the *authored* name rather than
 * the resolved one, because "On number 2" contains a digit that has nothing to
 * do with how long the rep is.
 */
function nameCarriesLength(baseName: string): boolean {
  return (
    /\d/.test(baseName) ||
    /\b(mile|miles|meter|meters|min|mins|minute|minutes|sec|secs|second|seconds)\b/i.test(
      baseName,
    )
  );
}

/**
 * What to do, in one line: which step this is, how long it lasts, and what to
 * aim for. This is the phrase that replaces looking at the screen.
 */
export function segmentInstruction(
  seg: SpokenSegment,
  opts?: { sayTarget?: boolean },
): string {
  const parts = [spokenSegmentName(seg)];
  if (!nameCarriesLength(seg.baseName ?? seg.name)) parts.push(speakableLength(seg.end));
  if (opts?.sayTarget !== false) {
    const target = speakablePace(seg.targetPaceSecPerMile ?? null);
    if (target) parts.push(`target ${target}`);
  }
  return parts.join(', ');
}

/** The segment beginning at a boundary, and how much to say about it. */
export interface UpNext {
  seg: SpokenSegment;
  /**
   * False leaves the goal pace unsaid because it hasn't changed. Eight reps
   * into a set "target 7 30" has stopped being information and started being
   * something to talk over.
   */
  sayTarget: boolean;
  /** The last rep of a set, or the last segment of the workout. */
  last: 'rep' | 'segment' | null;
}

/**
 * What the voice says at a boundary, in order. Empty means stay quiet.
 *
 * `coaching` false is the older, barer behavior: the split that just closed and
 * the bare name of what is next.
 */
export function boundaryPhrases(
  closed: {
    durationMs: number;
    /** Null when no pace worth stating was measured. */
    paceSecPerMile: number | null;
    /** True when it was a rep inside a repeat set. */
    inRepeat: boolean;
  } | null,
  /** Null on the last segment and on a free-run lap. */
  next: UpNext | null,
  coaching = true,
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

  if (!next) return out;
  if (!coaching) {
    out.push(spokenSegmentName(next.seg));
    return out;
  }
  // Said first and on its own: it is the one word that changes how the next
  // few minutes are run, and it survives even if the rest gets cut off.
  if (next.last === 'segment') out.push('Last segment');
  else if (next.last === 'rep') out.push('Last one');
  out.push(segmentInstruction(next.seg, { sayTarget: next.sayTarget }));
  return out;
}

/**
 * The heads-up before a transition.
 *
 * The beeps already mean "ten seconds"; what the voice adds is what comes
 * *after* them, which is the thing you would otherwise have to look at the
 * phone for. `leadIn` is how far out it is — "10 seconds", "200 meters" — in
 * the segment's own unit.
 */
export function nextUpPhrase(leadIn: string, next: SpokenSegment | null): string {
  return next ? `${leadIn}, then ${spokenSegmentName(next)}` : `Last ${leadIn}`;
}

/**
 * The one progress call on a long segment. Ten minutes into a tempo the only
 * question is whether the pace is holding, and it is the only question a
 * runner would otherwise pull the phone up to answer.
 */
export function halfwayPhrase(paceSecPerMile: number | null): string {
  const pace = speakablePace(paceSecPerMile);
  return pace ? `Halfway, ${pace} pace` : 'Halfway';
}

/**
 * Off target: the beep says adjust, the word says which way — and now also
 * what to adjust *to*, because "ease up" without a number is a guess.
 */
export function offTargetPhrase(
  direction: 'fast' | 'slow',
  targetSecPerMile: number | null | undefined,
): string {
  const word = direction === 'fast' ? 'Ease up' : 'Pick it up';
  const target = speakablePace(targetSecPerMile ?? null);
  return target ? `${word}, target ${target}` : word;
}

/** What starts the session: the first instruction, spoken after the go tone. */
export function startPhrases(first: SpokenSegment | null): string[] {
  return first ? [segmentInstruction(first)] : [];
}

/**
 * The end of a workout.
 *
 * The last segment never auto-advances — it runs into overtime until FINISH is
 * tapped — so without this the workout simply stops happening, silently, which
 * is the one moment nobody should have to look at the phone to notice.
 */
export function completionPhrases(
  durationMs: number,
  paceSecPerMile: number | null,
): string[] {
  const pace = speakablePace(paceSecPerMile);
  return [
    'Workout complete',
    `${speakableDuration(durationMs)}${pace ? `, ${pace} pace` : ''}`,
    'Tap finish',
  ];
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
