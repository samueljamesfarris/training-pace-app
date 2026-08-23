/**
 * Watches smoothed pace against a segment's target and decides when to say so.
 *
 * Two rules keep it from nagging, both from the spec: the pace has to sit
 * outside the band for five continuous seconds before anything fires, and
 * warnings are rate limited to one per twenty seconds. Drifting a second over
 * the line and back is not worth a beep on a bike.
 *
 * Pure and stateful, so it can be tested without a clock or a speaker.
 */

export type OffTargetDirection = 'fast' | 'slow';

/** Outside the band for this long before it counts. */
export const OFF_TARGET_HOLD_MS = 5000;
/** And never more often than this. */
export const OFF_TARGET_COOLDOWN_MS = 20_000;

/** Default band, ±5 s/mile per the spec. */
export const DEFAULT_TOLERANCE_SEC = 5;

/**
 * Which side of the band the pace is on, or null when inside it.
 * Lower seconds-per-mile is faster, so a pace *below* the band is too fast.
 */
export function deviation(
  paceSecPerMile: number | null,
  targetSecPerMile: number | null | undefined,
  toleranceSec: number,
): OffTargetDirection | null {
  if (paceSecPerMile == null || targetSecPerMile == null) return null;
  if (paceSecPerMile < targetSecPerMile - toleranceSec) return 'fast';
  if (paceSecPerMile > targetSecPerMile + toleranceSec) return 'slow';
  return null;
}

export class OffTargetWatcher {
  private since: number | null = null;
  private direction: OffTargetDirection | null = null;
  private lastWarnedAt = -Infinity;

  /**
   * Feed the current pace. Returns a direction on the tick a warning should
   * fire, and null every other tick.
   */
  update(
    now: number,
    paceSecPerMile: number | null,
    targetSecPerMile: number | null | undefined,
    toleranceSec: number,
  ): OffTargetDirection | null {
    const dir = deviation(paceSecPerMile, targetSecPerMile, toleranceSec);

    if (dir == null) {
      // Back inside the band: the hold starts again from scratch next time.
      this.since = null;
      this.direction = null;
      return null;
    }

    // Crossing from one side to the other is a new problem, not a continuation.
    if (dir !== this.direction) {
      this.direction = dir;
      this.since = now;
      return null;
    }

    if (this.since == null) this.since = now;
    if (now - this.since < OFF_TARGET_HOLD_MS) return null;
    if (now - this.lastWarnedAt < OFF_TARGET_COOLDOWN_MS) return null;

    this.lastWarnedAt = now;
    // Restart the hold, so a sustained drift repeats on the cooldown rather
    // than firing on every tick once the five seconds have passed.
    this.since = now;
    return dir;
  }

  /** Called when the segment changes, or the session pauses. */
  reset() {
    this.since = null;
    this.direction = null;
  }

  /** A new session should not inherit the last one's cooldown. */
  resetAll() {
    this.reset();
    this.lastWarnedAt = -Infinity;
  }
}
