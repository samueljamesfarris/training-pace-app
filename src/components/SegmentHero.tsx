import {
  currentIndex,
  currentSegment,
  isWorkoutComplete,
  onDeckSegment,
  remaining,
  segmentCount,
} from '../lib/segments';
import type { SessionRecord } from '../lib/types';
import { formatClock, formatCountdown, metersToMiles } from '../lib/units';
import { KIND_LABEL, MILE, type SegmentDef, type SegmentKind } from '../lib/workouts';

/** Colour is always paired with the word itself, never carrying it alone. */
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
}: {
  session: SessionRecord;
  now: number;
  distanceMeters: number;
}) {
  const seg = currentSegment(session);
  const next = onDeckSegment(session);
  if (!seg) return null;

  const complete = isWorkoutComplete(session, now, distanceMeters);
  const left = remaining(session, seg, now, distanceMeters);
  const over = left < 0;

  // Timed segments count down in m:ss; distance segments count down the
  // distance left, which simply stops moving during a GPS dropout.
  const value =
    seg.end.type === 'time'
      ? over
        ? `+${formatClock(-left)}`
        : formatCountdown(left)
      : `${Math.max(0, metersToMiles(left)).toFixed(2)}`;

  const unit = seg.end.type === 'time' ? 'remaining' : 'miles to go';
  const urgent = seg.end.type === 'time' && !over && left <= 10_000;

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
        {complete ? 'workout complete — tap finish' : over ? 'over — tap next' : unit}
      </div>

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
