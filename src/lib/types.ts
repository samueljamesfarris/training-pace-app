import type { ResolvedWorkout } from './workouts';

/** A GPS fix exactly as it arrived, before any smoothing or filtering. */
export interface RawFix {
  /** Fix time from the position source's clock (ms epoch). */
  t: number;
  lat: number;
  lon: number;
  /** meters/second from the device, or null when unavailable. */
  speed: number | null;
  /** Horizontal accuracy in meters. */
  accuracy: number;
  altitude: number | null;
  heading: number | null;
  source: 'geo' | 'sim';
}

export type SessionStatus = 'running' | 'paused' | 'finished';

/**
 * The instant a segment began, and the odometer reading at that instant.
 * Segment `i` starts at `boundaries[i]`. Free-run laps use the same list, so
 * laps and workout segments are one mechanism rather than two.
 */
export interface SegmentBoundary {
  at: number;
  distanceMeters: number;
}

/**
 * Everything needed to reconstruct the session's timing from wall-clock
 * timestamps alone. Nothing here is an accumulated tick count.
 */
export interface SessionRecord {
  id: string;
  createdAt: number;
  startedAt: number;
  /** Each pause interval; the last one may still be open (end === null). */
  pauses: { start: number; end: number | null }[];
  finishedAt: number | null;
  status: SessionStatus;
  /** Accumulated distance in meters, persisted so a reload doesn't lose it. */
  distanceMeters: number;
  fixCount: number;
  /** Which source produced this session's fixes. Replay is its own kind, or a
   *  replayed session is indistinguishable from a simulated one after the fact. */
  source: 'geo' | 'sim' | 'replay';
  /** The loaded workout, already flattened. Null for a free run. */
  workout: ResolvedWorkout | null;
  /** Segment (or lap) start instants, in order. */
  boundaries: SegmentBoundary[];
  /**
   * Heartbeat: the last moment the app was demonstrably alive and persisting.
   * If the app dies, everything after this is time the athlete wasn't running,
   * and resume excludes it rather than silently inflating the workout.
   */
  lastSeenAt: number;
}

/** Paused milliseconds falling inside the window [from, to]. */
export function pausedMsBetween(
  rec: SessionRecord,
  from: number,
  to: number,
): number {
  let total = 0;
  for (const p of rec.pauses) {
    const s = Math.max(p.start, from);
    const e = Math.min(p.end ?? to, to);
    if (e > s) total += e - s;
  }
  return total;
}

/** Total paused milliseconds as of `now`. */
export function pausedMs(rec: SessionRecord, now: number): number {
  const ceiling = rec.finishedAt ?? now;
  return pausedMsBetween(rec, rec.startedAt, ceiling);
}

/** Elapsed running time, derived from timestamps on every call. */
export function elapsedMs(rec: SessionRecord, now: number): number {
  const ceiling = rec.finishedAt ?? now;
  return Math.max(0, ceiling - rec.startedAt - pausedMs(rec, now));
}

/**
 * The wall-clock instant at which `durationMs` of *running* time will have
 * accrued since `from` — i.e. the same arithmetic as elapsedMs, inverted.
 * Returns null while an open pause makes the answer unknowable.
 */
export function wallClockAfter(
  rec: SessionRecord,
  from: number,
  durationMs: number,
): number | null {
  let t = from + durationMs;
  for (const p of rec.pauses) {
    const s = Math.max(p.start, from);
    if (s >= t) break;
    if (p.end == null) return null;
    if (p.end <= s) continue;
    t += p.end - s;
  }
  return t;
}
