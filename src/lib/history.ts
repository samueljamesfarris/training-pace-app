import { completedSegments } from './segments';
import { elapsedMs, isIndoor, type SessionRecord } from './types';
import { excelDate, excelDuration, type XlsxCell, type XlsxSheet } from './xlsx';
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

/**
 * A filename stem for anything exported from one session, without an
 * extension: `tuesday-800-repeats-2026-08-28`. A date and a workout name are
 * what make a file findable again in a message thread or a Files folder; the
 * session id means nothing to anyone.
 */
export function exportBaseName(rec: SessionRecord): string {
  const slug =
    (rec.workout?.name ?? 'Free run')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session';
  const d = new Date(rec.startedAt);
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return `${slug}-${stamp}`;
}

/** Seconds, as a duration Excel can add up. Undefined stays undefined. */
function duration(ms: number | null): number | undefined {
  return ms == null ? undefined : excelDuration(Math.round(ms / 1000));
}

/**
 * The session as a workbook: a summary sheet and a splits sheet.
 *
 * This is the CSV's content with the types put back on. The CSV has to hand a
 * spreadsheet text and hope — Excel reads `7:30` as half past seven in the
 * morning, and a totals row of durations comes out as a string that will not
 * add — so every duration and pace here is written as a real fraction of a
 * day. A column of splits sums, and averaging the pace column gives a pace.
 *
 * The columns are the same indoors as out, and the cells that would need a
 * measurement are simply empty. Keeping the shape stable is what lets two
 * exports be pasted under each other; keeping the cells blank rather than zero
 * is the same rule the CSV follows, for the same reason — a summed column of
 * zeroes claims a treadmill session covered no ground, which is a different
 * statement from not having measured.
 */
export function toWorkbook(rec: SessionRecord): XlsxSheet[] {
  const ceiling = ceilingFor(rec);
  const rows = completedSegments(rec, ceiling, rec.distanceMeters);
  const targets = rec.workout?.segments ?? [];
  const indoor = isIndoor(rec);
  const total = summarize(rec);

  const summary: XlsxSheet = {
    name: 'Summary',
    widths: [22, 26],
    freezeHeader: false,
    rows: [
      [{ value: 'Workout', style: 'bold' }, { value: total.workoutName ?? 'Free run' }],
      [{ value: 'Started', style: 'bold' }, { value: excelDate(rec.startedAt), style: 'date' }],
      [{ value: 'Mode', style: 'bold' }, { value: indoor ? 'Indoor' : 'Outdoor' }],
      [{ value: 'Source', style: 'bold' }, { value: indoor ? 'none' : rec.source }],
      [
        { value: 'Status', style: 'bold' },
        { value: total.finished ? 'Finished' : 'Unfinished' },
      ],
      [{ value: 'Total time', style: 'bold' }, { value: duration(total.totalMs), style: 'duration' }],
      [
        { value: 'Distance (mi)', style: 'bold' },
        {
          value: indoor ? undefined : Number(metersToMiles(total.distanceMeters).toFixed(3)),
          style: 'distance',
        },
      ],
      [
        { value: 'Avg pace (/mi)', style: 'bold' },
        {
          value: indoor || total.avgPaceSecPerMile == null
            ? undefined
            : excelDuration(Math.round(total.avgPaceSecPerMile)),
          style: 'pace',
        },
      ],
      [
        { value: rec.workout ? 'Segments' : 'Laps', style: 'bold' },
        { value: rows.length },
      ],
    ],
  };

  const header: XlsxCell[] = [
    { value: 'Segment', style: 'bold' },
    { value: 'Name', style: 'bold' },
    { value: 'Duration', style: 'bold' },
    { value: 'Distance (mi)', style: 'bold' },
    { value: 'Pace (/mi)', style: 'bold' },
    { value: 'Goal (/mi)', style: 'bold' },
    { value: 'vs Goal (s)', style: 'bold' },
  ];

  const body: XlsxCell[][] = rows.map((row) => {
    const paceSec = indoor ? null : sanePaceSecPerMile(row.distanceMeters, row.durationMs);
    const target = targets[row.index]?.targetPaceSecPerMile ?? null;
    return [
      { value: row.index + 1 },
      { value: row.name },
      { value: duration(row.durationMs), style: 'duration' },
      {
        value: indoor ? undefined : Number(metersToMiles(row.distanceMeters).toFixed(3)),
        style: 'distance',
      },
      { value: paceSec == null ? undefined : excelDuration(Math.round(paceSec)), style: 'pace' },
      {
        value: indoor || target == null ? undefined : excelDuration(target),
        style: 'pace',
      },
      // A pace we would not state is a pace we will not subtract: a blank pace
      // cell must not sprout a delta beside it.
      {
        value: paceSec == null || target == null ? undefined : Math.round(paceSec - target),
        style: 'delta',
      },
    ];
  });

  const totals: XlsxCell[] = [
    { value: 'Total', style: 'bold' },
    { value: total.workoutName ?? 'Free run', style: 'bold' },
    { value: duration(total.totalMs), style: 'boldDuration' },
    {
      value: indoor ? undefined : Number(metersToMiles(total.distanceMeters).toFixed(3)),
      style: 'boldDistance',
    },
    {
      value:
        indoor || total.avgPaceSecPerMile == null
          ? undefined
          : excelDuration(Math.round(total.avgPaceSecPerMile)),
      style: 'boldPace',
    },
    { style: 'bold' },
    { style: 'bold' },
  ];

  return [
    summary,
    {
      name: 'Splits',
      widths: [9, 22, 11, 13, 11, 11, 11],
      freezeHeader: true,
      rows: [header, ...body, totals],
    },
  ];
}
