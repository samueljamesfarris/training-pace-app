/**
 * When to speak *inside* a segment, as opposed to at its edges.
 *
 * Boundaries announce themselves — a boundary is an event, and the event
 * carries the cue. The two things a solo runner otherwise has to look at the
 * phone for happen mid-segment: knowing a transition is coming before it lands,
 * and knowing whether a long effort is holding its pace.
 *
 * Both fire at most once per segment. Pure and stateful, like `OffTargetWatcher`
 * next door, so the timing is testable without a clock, a speaker or a GPS.
 *
 * Two rules keep it honest rather than merely quiet:
 *
 *  - A cue is spent the moment its threshold is crossed, whether or not it was
 *    spoken. If the phone slept through the last ten seconds of a rest, "ten
 *    seconds, then On number 3" arriving two seconds late is worse than silence
 *    — the beeps already told the truth. So a cue that has gone stale is
 *    swallowed, not deferred.
 *  - A segment barely longer than its own heads-up gets none. Announcing the
 *    end of a fifteen-second rest is talking through the rest.
 */

import { METERS_PER_MILE } from './units';

export type CoachCue = 'warning' | 'halfway';

/** Timed segments get the heads-up where the warning beep already is. */
export const WARNING_LEAD_MS = 10_000;

/**
 * How far out the heads-up lands on a distance segment.
 *
 * Distance reps had no advance cue at all: nothing knows when one will end, so
 * nothing could be scheduled. But the distance itself is knowable, and "200
 * meters, then Recovery" is the callout an actual coach standing at the line
 * would give. Scaled to the rep, because 200 m into a 400 is half of it.
 */
export function warningMeters(segmentMeters: number): number {
  if (segmentMeters < 600) return 100;
  if (segmentMeters < METERS_PER_MILE) return 200;
  return 400;
}

/**
 * A progress call is only worth it on a segment long enough to get lost in. A
 * two-minute rep is over before wondering about it is useful; a three-mile
 * tempo is twenty minutes of not knowing.
 */
export const HALFWAY_MIN_MS = 240_000;
export const HALFWAY_MIN_M = 1200;

/** How much of the lead must remain for a cue to still be worth speaking. */
const STALE_FRACTION = 0.4;
/** Same idea at the halfway mark, which has a whole half-segment to be late in. */
const HALFWAY_STALE_FRACTION = 0.35;

export interface SegmentProgress {
  /** Which segment this is. A change resets every cue. */
  index: number;
  kind: 'time' | 'distance';
  /** The segment's whole length: milliseconds for time, meters for distance. */
  total: number;
  /** How much of it is left, in the same unit. Negative once past the end. */
  left: number;
}

export class SegmentCoach {
  private index = -1;
  private spent = new Set<CoachCue>();

  /**
   * Feed the current segment's progress. Returns a cue on the tick it should
   * fire, and null every other tick.
   */
  update(p: SegmentProgress): CoachCue | null {
    if (p.index !== this.index) {
      this.index = p.index;
      this.spent.clear();
    }
    if (!(p.total > 0)) return null;

    // Halfway always comes before the warning, so it is checked first: if both
    // thresholds have been crossed the segment ran on while the phone slept,
    // and the stale one is swallowed on its way past.
    if (!this.spent.has('halfway')) {
      const eligible =
        p.kind === 'time' ? p.total >= HALFWAY_MIN_MS : p.total >= HALFWAY_MIN_M;
      if (!eligible) {
        this.spent.add('halfway');
      } else if (p.left <= p.total / 2) {
        this.spent.add('halfway');
        if (p.left > p.total * HALFWAY_STALE_FRACTION) return 'halfway';
      }
    }

    if (!this.spent.has('warning')) {
      const lead = p.kind === 'time' ? WARNING_LEAD_MS : warningMeters(p.total);
      // Longer than twice its own heads-up, or the heads-up is the segment.
      if (p.total <= lead * 2) {
        this.spent.add('warning');
      } else if (p.left <= lead) {
        this.spent.add('warning');
        if (p.left > lead * STALE_FRACTION) return 'warning';
      }
    }

    return null;
  }

  /** A new session, or a workout swapped in under one, starts from scratch. */
  resetAll() {
    this.index = -1;
    this.spent.clear();
  }
}
