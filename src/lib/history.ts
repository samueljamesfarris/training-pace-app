import { completedSegments } from './segments';
import { elapsedMs, isIndoor, type SessionRecord } from './types';
import {
  averageMph,
  formatClock,
  formatMiles,
  formatPace,
  metersToMiles,
  sanePaceSecPerMile,
} from './units';

/**
 * Everything the history list needs about one session, derived rather than
 * stored — the record already carries the timestamps, so a summary is a view
 * of it, not a second copy that can drift.
 */
export interface SessionSummary {
  id: string;
  startedAt: number;
  /** Running time, excluding pauses and any gap the app was dead for. */
  totalMs: number;
  distanceMeters: number;
  avgPaceSecPerMile: number | null;
  workoutName: string | null;
  segmentCount: number;
  finished: boolean;
  source: SessionRecord['source'];
  /** True when no position was measured, so distance and pace mean nothing. */
  indoor: boolean;
}

/** The instant a session's clock should be read at: its end, or its heartbeat. */
function ceilingFor(rec: SessionRecord): number {
  return rec.finishedAt ?? rec.lastSeenAt;
}

export function summarize(rec: SessionRecord): SessionSummary {
  const totalMs = elapsedMs(rec, ceilingFor(rec));
  // An indoor session's odometer never moved. Zero meters already yields a
  // null pace, but the flag says *why*, so a reader shows a blank rather than
  // a suspiciously slow ride.
  const mph = averageMph(rec.distanceMeters, totalMs);
  return {
    id: rec.id,
    startedAt: rec.startedAt,
    totalMs,
    distanceMeters: rec.distanceMeters,
    avgPaceSecPerMile: mph == null ? null : 3600 / mph,
    workoutName: rec.workout?.name ?? null,
    segmentCount: rec.boundaries.length,
    finished: rec.status === 'finished',
    source: rec.source,
    indoor: isIndoor(rec),
  };
}

/** Newest first, which is the only order a training log is ever read in. */
export function sortSessions(recs: SessionRecord[]): SessionRecord[] {
  return recs.slice().sort((a, b) => b.startedAt - a.startedAt);
}

/** RFC 4180 enough: quote anything containing a comma, quote or newline. */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per segment, plus a totals row. Numbers are left unformatted where a
 * spreadsheet would rather do the math itself — seconds and miles as numbers,
 * with the human-readable pace alongside.
 */
export function toCsv(rec: SessionRecord): string {
  const ceiling = ceilingFor(rec);
  const rows = completedSegments(rec, ceiling, rec.distanceMeters);
  const targets = rec.workout?.segments ?? [];
  // Indoors the distance columns are empty, not zero: a spreadsheet summing a
  // column of 0.000 miles would report a treadmill session as a ride that
  // covered nothing, which is a different claim from "not measured".
  const indoor = isIndoor(rec);

  const header = [
    'segment',
    'name',
    'duration_s',
    'duration',
    'distance_mi',
    'pace_s_per_mi',
    'pace',
    'target_s_per_mi',
    'delta_s',
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    const paceSec = sanePaceSecPerMile(row.distanceMeters, row.durationMs);
    const mph = paceSec == null ? null : 3600 / paceSec;
    const target = targets[row.index]?.targetPaceSecPerMile ?? null;
    lines.push(
      [
        row.index + 1,
        csvCell(row.name),
        Math.round(row.durationMs / 1000),
        csvCell(formatClock(row.durationMs)),
        indoor ? '' : metersToMiles(row.distanceMeters).toFixed(3),
        indoor || paceSec == null ? '' : Math.round(paceSec),
        csvCell(indoor || paceSec == null ? '' : formatPace(mph)),
        target ?? '',
        !indoor && target != null && paceSec != null ? Math.round(paceSec - target) : '',
      ].join(','),
    );
  }

  const total = summarize(rec);
  lines.push(
    [
      'total',
      csvCell(rec.workout?.name ?? 'Free run'),
      Math.round(total.totalMs / 1000),
      csvCell(formatClock(total.totalMs)),
      indoor ? '' : metersToMiles(total.distanceMeters).toFixed(3),
      indoor || total.avgPaceSecPerMile == null ? '' : Math.round(total.avgPaceSecPerMile),
      csvCell(indoor ? '' : formatPace(averageMph(total.distanceMeters, total.totalMs))),
      '',
      '',
    ].join(','),
  );
  return lines.join('\n');
}

/** A summary short enough to paste into a message without editing it down. */
export function toTextSummary(rec: SessionRecord): string {
  const ceiling = ceilingFor(rec);
  const s = summarize(rec);
  const when = new Date(rec.startedAt).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const head = [
    s.workoutName ?? 'Free run',
    s.indoor ? `${when} · indoor` : when,
    s.indoor
      ? formatClock(s.totalMs)
      : `${formatClock(s.totalMs)} · ${formatMiles(s.distanceMeters)} mi · ${formatPace(
          averageMph(s.distanceMeters, s.totalMs),
        )}/mi`,
  ];

  const rows = completedSegments(rec, ceiling, rec.distanceMeters);
  const targets = rec.workout?.segments ?? [];
  const body = rows.map((row) => {
    const paceSec = sanePaceSecPerMile(row.distanceMeters, row.durationMs);
    const mph = paceSec == null ? null : 3600 / paceSec;
    const target = targets[row.index]?.targetPaceSecPerMile;
    const delta = target != null && paceSec != null ? Math.round(paceSec - target) : null;
    if (s.indoor) return `${row.name}  ${formatClock(row.durationMs)}`;
    return (
      `${row.name}  ${formatClock(row.durationMs)}  ${formatMiles(row.distanceMeters)} mi  ` +
      `${formatPace(mph)}` +
      (delta == null ? '' : `  ${delta === 0 ? 'even' : `${delta > 0 ? '+' : ''}${delta}s`}`)
    );
  });

  return [...head, '', ...body].join('\n');
}
