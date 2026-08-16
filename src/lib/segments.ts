import {
  pausedMsBetween,
  wallClockAfter,
  type SegmentBoundary,
  type SessionRecord,
} from './types';
import type { SegmentDef } from './workouts';

export function currentIndex(rec: SessionRecord): number {
  return Math.max(0, rec.boundaries.length - 1);
}

export function currentSegment(rec: SessionRecord): SegmentDef | null {
  return rec.workout?.segments[currentIndex(rec)] ?? null;
}

export function onDeckSegment(rec: SessionRecord): SegmentDef | null {
  return rec.workout?.segments[currentIndex(rec) + 1] ?? null;
}

export function segmentCount(rec: SessionRecord): number {
  return rec.workout?.segments.length ?? 0;
}

/** True once the final segment's end condition has been met. */
export function isWorkoutComplete(
  rec: SessionRecord,
  now: number,
  distanceMeters: number,
): boolean {
  const seg = currentSegment(rec);
  if (!rec.workout || !seg) return false;
  if (currentIndex(rec) < rec.workout.segments.length - 1) return false;
  return remaining(rec, seg, now, distanceMeters) <= 0;
}

/** Running time spent in the current segment. */
export function segmentElapsedMs(rec: SessionRecord, now: number): number {
  const b = rec.boundaries[currentIndex(rec)];
  if (!b) return 0;
  const ceiling = rec.finishedAt ?? now;
  return Math.max(0, ceiling - b.at - pausedMsBetween(rec, b.at, ceiling));
}

/** Distance covered inside the current segment, in meters. */
export function segmentDistanceM(rec: SessionRecord, distanceMeters: number): number {
  const b = rec.boundaries[currentIndex(rec)];
  if (!b) return 0;
  return Math.max(0, distanceMeters - b.distanceMeters);
}

/**
 * How much of the current segment is left — milliseconds for a timed segment,
 * meters for a distance segment. Never negative on the display side; callers
 * that care about overshoot compare against zero themselves.
 */
export function remaining(
  rec: SessionRecord,
  seg: SegmentDef,
  now: number,
  distanceMeters: number,
): number {
  return seg.end.type === 'time'
    ? seg.end.seconds * 1000 - segmentElapsedMs(rec, now)
    : seg.end.meters - segmentDistanceM(rec, distanceMeters);
}

/**
 * Boundaries that should have been crossed by `now` but haven't been recorded
 * yet. Returns a list rather than one, because a phone that slept through a
 * 30-second rest must land on the right segment, not merely the next one.
 *
 * Timed boundaries are placed at their exact wall-clock instant, so a catch-up
 * never smears the schedule; distance boundaries land at the target distance.
 */
export function computeAutoAdvance(
  rec: SessionRecord,
  now: number,
  distanceMeters: number,
): SegmentBoundary[] {
  const out: SegmentBoundary[] = [];
  const workout = rec.workout;
  if (!workout) return out;

  let idx = currentIndex(rec);
  let b = rec.boundaries[idx];
  if (!b) return out;

  // The final segment never auto-advances; it just runs into overtime until
  // Finish is tapped, so the workout can't end itself out from under him.
  while (idx < workout.segments.length - 1) {
    const seg = workout.segments[idx]!;
    if (seg.end.type === 'time') {
      const at = wallClockAfter(rec, b.at, seg.end.seconds * 1000);
      if (at == null || at > now) break;
      // Distance at that past instant isn't recoverable, so the odometer split
      // uses the current reading. Only matters if the phone slept through it.
      b = { at, distanceMeters };
    } else {
      if (distanceMeters - b.distanceMeters < seg.end.meters) break;
      // Anchor to the target, not the overshoot, so cumulative splits stay exact.
      b = { at: now, distanceMeters: b.distanceMeters + seg.end.meters };
    }
    out.push(b);
    idx++;
  }
  return out;
}

export interface CompletedSegment {
  index: number;
  name: string;
  startedAt: number;
  durationMs: number;
  distanceMeters: number;
  open: boolean;
}

/** Every segment or lap so far, derived entirely from the boundary list. */
export function completedSegments(
  rec: SessionRecord,
  now: number,
  totalDistanceMeters: number,
): CompletedSegment[] {
  const ceiling = rec.finishedAt ?? now;
  return rec.boundaries.map((b, i) => {
    const next = rec.boundaries[i + 1];
    const endAt = next?.at ?? ceiling;
    const endDist = next?.distanceMeters ?? totalDistanceMeters;
    return {
      index: i,
      name: rec.workout?.segments[i]?.name ?? `Lap ${i + 1}`,
      startedAt: b.at,
      durationMs: Math.max(0, endAt - b.at - pausedMsBetween(rec, b.at, endAt)),
      distanceMeters: Math.max(0, endDist - b.distanceMeters),
      open: !next,
    };
  });
}
