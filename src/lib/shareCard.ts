/**
 * A finished session as a table that can leave the app as a picture.
 *
 * The CSV is for a spreadsheet and the text summary is for a paste; neither
 * survives a group message intact. This builds the same splits as a small
 * card — a title, three headline numbers, one row per segment — which shares
 * as a PNG that reads on a phone without being opened in anything.
 *
 * Pure: it produces a model of the card, not pixels, so every rule about what
 * may be stated is testable without a canvas. `shareImage.ts` draws it.
 */

import { summarize } from './history';
import { DEFAULT_TOLERANCE_SEC, deviation } from './offTarget';
import { completedSegments } from './segments';
import { isIndoor, type SessionRecord } from './types';
import {
  averageMph,
  formatClock,
  formatMiles,
  formatPace,
  sanePaceSecPerMile,
} from './units';

/**
 * Rows drawn before the middle is elided.
 *
 * A workout may resolve to 200 segments, and a card that tall arrives in
 * Messages scaled down to an unreadable strip. Twenty-four rows is about what
 * stays legible at a phone's width; past that the card keeps the start and the
 * finish, says how many it dropped, and points at the CSV for the rest.
 */
export const MAX_CARD_ROWS = 24;

/**
 * Color meaning on a cell, and never the only signal — the text carries the
 * sign and the word, so the card still reads in a screenshot with the color
 * washed out. `on` is inside the goal band, `fast` and `slow` are the two ways
 * out of it, which is the same three-way answer `deviation` gives the voice.
 */
export type CardTone = 'plain' | 'on' | 'fast' | 'slow';
export type CardAlign = 'left' | 'right';

export interface CardColumn {
  label: string;
  align: CardAlign;
}

export interface CardCell {
  text: string;
  tone: CardTone;
}

export interface CardRow {
  /** An elision row carries a single centered note instead of cells. */
  kind: 'segment' | 'elision';
  cells: CardCell[];
  note?: string;
}

export interface CardStat {
  label: string;
  value: string;
}

export interface ShareCard {
  title: string;
  subtitle: string;
  stats: CardStat[];
  columns: CardColumn[];
  rows: CardRow[];
  /** Says where the dropped rows went. Null when nothing was dropped. */
  note: string | null;
  /** What the shared file is called, which is what a message thread shows. */
  fileName: string;
}

function plain(text: string): CardCell {
  return { text, tone: 'plain' };
}

/** The same one-line date the history list and the text summary use. */
function when(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `tempo-repeats-2026-08-29.png` — a name that means something in a thread. */
function fileNameFor(title: string, startedAt: number): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session';
  const d = new Date(startedAt);
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return `${slug}-${stamp}.png`;
}

/**
 * Keep the head and the tail, drop the middle.
 *
 * The interesting reps of a long session are the first few and the last few;
 * the ones in between are what the CSV is for.
 */
function elide(rows: CardRow[], max: number): { rows: CardRow[]; hidden: number } {
  if (rows.length <= max) return { rows, hidden: 0 };
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  const hidden = rows.length - head - tail;
  return {
    rows: [
      ...rows.slice(0, head),
      { kind: 'elision', cells: [], note: `${hidden} more segments` },
      ...rows.slice(rows.length - tail),
    ],
    hidden,
  };
}

export function buildShareCard(rec: SessionRecord): ShareCard {
  const s = summarize(rec);
  const indoor = isIndoor(rec);
  const ceiling = rec.finishedAt ?? rec.lastSeenAt;
  const segments = completedSegments(rec, ceiling, rec.distanceMeters);
  const targets = rec.workout?.segments ?? [];
  // A goal column earns its place only when some segment actually had a goal,
  // and never indoors, where there is no measured pace to compare against one.
  const hasTargets = !indoor && targets.some((t) => t.targetPaceSecPerMile != null);

  const title = s.workoutName ?? 'Free run';
  const subtitle = [
    when(rec.startedAt),
    indoor ? 'indoor' : null,
    s.finished ? null : 'unfinished',
    rec.source !== 'geo' && !indoor ? rec.source : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Indoors nothing was measured, so miles and pace are absent rather than
  // zero — the same rule as the finish card, the history detail and the CSV.
  // The segment count takes their place so the card still has two numbers.
  const stats: CardStat[] = indoor
    ? [
        { label: 'time', value: formatClock(s.totalMs) },
        { label: rec.workout ? 'segments' : 'laps', value: String(segments.length) },
      ]
    : [
        { label: 'time', value: formatClock(s.totalMs) },
        { label: 'miles', value: formatMiles(s.distanceMeters) },
        { label: 'avg pace', value: formatPace(averageMph(s.distanceMeters, s.totalMs)) },
      ];

  const columns: CardColumn[] = [
    { label: 'segment', align: 'left' },
    { label: 'time', align: 'right' },
  ];
  if (!indoor) {
    columns.push({ label: 'dist', align: 'right' });
    columns.push({ label: 'pace', align: 'right' });
  }
  if (hasTargets) columns.push({ label: 'vs goal', align: 'right' });

  const built: CardRow[] = segments.map((row) => {
    const paceSec = indoor ? null : sanePaceSecPerMile(row.distanceMeters, row.durationMs);
    const cells: CardCell[] = [plain(row.name), plain(formatClock(row.durationMs))];
    if (!indoor) {
      cells.push(plain(formatMiles(row.distanceMeters)));
      cells.push(plain(formatPace(paceSec == null ? null : 3600 / paceSec)));
    }
    if (hasTargets) cells.push(deltaCell(paceSec, targets[row.index]?.targetPaceSecPerMile));
    return { kind: 'segment', cells };
  });

  const { rows, hidden } = elide(built, MAX_CARD_ROWS);

  return {
    title,
    subtitle,
    stats,
    columns,
    rows,
    note: hidden > 0 ? 'Every segment is in the CSV export.' : null,
    fileName: fileNameFor(title, rec.startedAt),
  };
}

/**
 * Seconds off the goal, signed, with the band applied.
 *
 * A pace we would not state is a pace we will not subtract: if the pace cell
 * reads `--:--`, this reads `—` rather than growing a delta beside it.
 *
 * The tone comes from `deviation`, the same call that decides whether the
 * voice speaks, so the card agrees with what the athlete heard on the ride.
 * Three seconds off a goal is a hit, not a miss, and marking it as one would
 * make an entirely good session look wrong. The band is the default one: a
 * session doesn't record the tolerance it ran with.
 */
function deltaCell(paceSec: number | null, target: number | null | undefined): CardCell {
  if (paceSec == null || target == null) return { text: '—', tone: 'plain' };
  const delta = Math.round(paceSec - target);
  const dir = deviation(paceSec, target, DEFAULT_TOLERANCE_SEC);
  return {
    text: delta === 0 ? 'even' : `${delta > 0 ? '+' : ''}${delta}s`,
    tone: dir ?? 'on',
  };
}
