export const METERS_PER_MILE = 1609.344;
export const MPS_TO_MPH = 2.2369362920544;

/**
 * Outside this range a pace number would be nonsense, so we show `--:--`.
 *
 * The floor exists to stop a stationary phone's noise being rendered as a pace,
 * not to judge how fast someone is going. At 3 mph it caught a walk-back
 * recovery and blanked the largest number on screen mid-workout, so it sits at
 * 2 — still well clear of the ~1.5 mph a parked phone's jitter averages.
 */
export const MIN_SANE_MPH = 2;
export const MAX_SANE_MPH = 25;

export function mpsToMph(mps: number): number {
  return mps * MPS_TO_MPH;
}

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}

/** Running pace in min/mile, formatted `m:ss`. */
export function formatPace(mph: number | null | undefined): string {
  if (mph == null || !Number.isFinite(mph)) return '--:--';
  if (mph < MIN_SANE_MPH || mph > MAX_SANE_MPH) return '--:--';
  const totalSeconds = Math.round((60 / mph) * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Pace already in seconds per mile, formatted `m:ss`. */
export function formatPaceSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** mph to one decimal. */
export function formatSpeed(mph: number | null | undefined): string {
  if (mph == null || !Number.isFinite(mph)) return '--.-';
  return mph.toFixed(1);
}

/**
 * `m:ss`, or `h:mm:ss` once past an hour. Truncates, which is what a stopwatch
 * counting *up* should do: it reads 0:09 for the whole of the tenth second.
 */
export function formatClock(ms: number): string {
  return clock(Math.max(0, Math.floor(ms / 1000)));
}

/**
 * The same clock for a timer counting *down*. It has to round up, not down:
 * with 110.4s left, truncation shows 1:50 while the stopwatch shows 0:09, and
 * the pair reads a second out of step because they sum to 119 instead of 120.
 * Rounding up shows the full 2:00 for the first second and hits 0:00 exactly
 * on the boundary, so both clocks flip on the same instant.
 */
export function formatCountdown(ms: number): string {
  return clock(Math.max(0, Math.ceil(ms / 1000)));
}

function clock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMiles(meters: number): string {
  return metersToMiles(meters).toFixed(2);
}

/**
 * Pace in seconds per mile, or null when the numbers don't support one.
 *
 * The single definition of "a pace we are willing to state". If the hero
 * refuses to show it as `--:--`, then a split table, a CSV column, a delta
 * against a goal, and the voice must all refuse too — otherwise a segment
 * reading `--:--` sprouts a delta of +17269s beside it.
 */
export function sanePaceSecPerMile(meters: number, ms: number): number | null {
  const mph = averageMph(meters, ms);
  if (mph == null || mph < MIN_SANE_MPH || mph > MAX_SANE_MPH) return null;
  return 3600 / mph;
}

/** Average speed in mph over a distance and a running duration. */
export function averageMph(meters: number, ms: number): number | null {
  if (ms <= 0 || meters <= 0) return null;
  return metersToMiles(meters) / (ms / 3_600_000);
}

/** Which unit a distance countdown is displayed in. */
export type DistanceUnit = 'mi' | 'm';

/**
 * The unit a distance countdown counts in.
 *
 * Chosen from the segment's own length, once, and never from what is left. The
 * version that switched on the remaining distance turned a two-mile warmup
 * into a meters countdown at the halfway point: the number under the runner's
 * eyes went from 1.00 to 1609 with nothing announcing it, which reads as a
 * fault rather than a unit change. A countdown has to mean the same thing for
 * its whole length.
 *
 * An explicit choice always wins, and holds until it is changed again.
 */
export function countdownUnit(
  segmentMeters: number,
  chosen: DistanceUnit | null,
): DistanceUnit {
  if (chosen) return chosen;
  // A rep measured in hundreds of meters is counted in meters; anything a mile
  // or longer is counted in miles. The same rule the segment chips use.
  return segmentMeters >= METERS_PER_MILE ? 'mi' : 'm';
}

/** Distance remaining, in the unit asked for. Never negative. */
export function formatRemaining(metersLeft: number, unit: DistanceUnit): string {
  const left = Math.max(0, metersLeft);
  return unit === 'mi' ? metersToMiles(left).toFixed(2) : String(Math.round(left));
}

/** The words under a distance countdown. */
export function remainingLabel(unit: DistanceUnit): string {
  return unit === 'mi' ? 'miles to go' : 'meters to go';
}
