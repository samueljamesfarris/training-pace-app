export const METERS_PER_MILE = 1609.344;
export const MPS_TO_MPH = 2.2369362920544;

/** Outside this range a pace number would be nonsense, so we show `--:--`. */
export const MIN_SANE_MPH = 3;
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

/** Average speed in mph over a distance and a running duration. */
export function averageMph(meters: number, ms: number): number | null {
  if (ms <= 0 || meters <= 0) return null;
  return metersToMiles(meters) / (ms / 3_600_000);
}
