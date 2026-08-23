import {
  currentIndex,
  currentSegment,
  isWorkoutComplete,
  onDeckSegment,
  remaining,
  segmentCount,
  segmentElapsedMs,
} from '../lib/segments';
import type { SessionRecord } from '../lib/types';
import { formatClock, formatCountdown, metersToMiles } from '../lib/units';
import { KIND_LABEL, MILE, type SegmentDef, type SegmentKind } from '../lib/workouts';

/** Color is always paired with the word itself, never carrying it alone. */
const KIND_STYLE: Record<SegmentKind, string> = {
  work: 'bg-work text-work-ink',
  recovery: 'bg-recovery text-recovery-ink',
  warmup: 'bg-neutral-kind text-neutral-kind-ink',
  cooldown: 'bg-neutral-kind text-neutral-kind-ink',
};

/** A segment's end condition as a short label. */
export function endLabel(seg: SegmentDef): string {
  if (seg.end.type === 'time') return formatClock(seg.end.seconds * 1000);
  return seg.end.meters >= MILE
    ? `${metersToMiles(seg.end.meters).toFixed(2)} mi`
    : `${Math.round(seg.end.meters)} m`;
}

export function SegmentHero({
  session,
  now,
  distanceMeters,
  stale,
  acquiring,
  measuring = true,
  band,
}: {
  session: SessionRecord;
  now: number;
  distanceMeters: number;
  stale: boolean;
  acquiring: boolean;
  /**
   * False on a treadmill, where no distance is measured. A distance segment
   * then has no countdown to show — counting one down from a frozen odometer
   * would be a fabricated reading — so it counts the segment's time up and
   * says which distance to watch the machine for.
   */
  measuring?: boolean;
  /** The target/verdict row, when the segment has a goal pace. */
  band?: React.ReactNode;
}) {
  const seg = currentSegment(session);
  const next = onDeckSegment(session);
  if (!seg) return null;

  const unmeasurable = !measuring && seg.end.type === 'distance';

  const complete = !unmeasurable && isWorkoutComplete(session, now, distanceMeters);
  const left = remaining(session, seg, now, distanceMeters);
  const over = left < 0;

  // Timed segments count down in m:ss; distance segments count down the
  // distance left, which simply stops moving during a GPS dropout.
  //
  // Under a mile, count meters: 0.50 -> 0.49 moves the last digit once every
  // 16 meters, which on an 800 rep reads as a number that isn't working. The
  // switch is on what's left, not the segment length, so a mile rep changes
  // units as it closes.
  const metersLeft = Math.max(0, left);
  const showMeters = seg.end.type === 'distance' && metersLeft < MILE;
  const value = unmeasurable
    ? formatClock(segmentElapsedMs(session, now))
    : seg.end.type === 'time'
      ? over
        ? `+${formatClock(-left)}`
        : formatCountdown(left)
      : showMeters
        ? String(Math.round(metersLeft))
        : `${Math.max(0, metersToMiles(left)).toFixed(2)}`;

  const unit = unmeasurable
    ? `elapsed · tap next at ${endLabel(seg)}`
    : seg.end.type === 'time'
      ? 'remaining'
      : showMeters
        ? 'meters to go'
        : 'miles to go';
  const urgent = !unmeasurable && seg.end.type === 'time' && !over && left <= 10_000;

  return (
    <section className="flex flex-col items-center">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-black tracking-widest ${KIND_STYLE[seg.kind]}`}
        >
          {KIND_LABEL[seg.kind]}
        </span>
        <span className="text-lg font-black">{seg.name}</span>
        <span className="text-sm font-bold text-muted">
          {currentIndex(session) + 1} / {segmentCount(session)}
        </span>
      </div>

      <div
        className={`text-[clamp(4.5rem,29vw,15rem)] leading-[0.9] font-black tracking-tight ${
          urgent ? 'text-stop' : ''
        }`}
      >
        {value}
      </div>

      <div className="text-sm font-bold tracking-widest text-muted uppercase">
        {complete ? 'workout complete — tap finish' : over && !unmeasurable ? 'over — tap next' : unit}
      </div>

      {/* Dimming alone reads as a rendering fault in direct sun, and the chip
          explaining it is away in the corner. Same wording as the chip. */}
      {stale && !acquiring && (
        <div className="mt-2 rounded bg-hold px-3 py-1 text-xs font-black tracking-widest text-hold-ink uppercase">
          GPS lost — numbers frozen
        </div>
      )}

      {band}

      <div className="mt-2 rounded-full bg-raised px-4 py-1 text-sm font-bold">
        {next ? (
          <>
            <span className="text-muted">NEXT</span> {next.name} · {endLabel(next)}
          </>
        ) : (
          <span className="text-muted">LAST SEGMENT</span>
        )}
      </div>
    </section>
  );
}
