import { MAX_CARD_ROWS, buildShareCard } from '../src/lib/shareCard.ts';
import { resolveWorkout, type WorkoutDef } from '../src/lib/workouts.ts';
import type { SessionRecord } from '../src/lib/types.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ': ' + detail : ''}`);
}

const base = 1_700_000_000_000;
const MILE = 1609.344;

/** Two half-mile segments at 8:00/mile, the second one carrying a goal. */
const workout: WorkoutDef = {
  id: 'w',
  name: 'Half mile repeats',
  blocks: [
    {
      id: 'b',
      repeat: 1,
      segments: [
        { name: 'Warmup', kind: 'recovery', end: { type: 'time', seconds: 240 } },
        {
          name: 'Rep 1',
          kind: 'work',
          end: { type: 'time', seconds: 240 },
          targetPaceSecPerMile: 480,
        },
      ],
    },
  ],
};

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    createdAt: base,
    startedAt: base,
    pauses: [],
    finishedAt: base + 480_000,
    status: 'finished',
    distanceMeters: MILE,
    fixCount: 480,
    source: 'geo',
    workout: resolveWorkout(workout),
    boundaries: [
      { at: base, distanceMeters: 0 },
      { at: base + 240_000, distanceMeters: MILE / 2 },
    ],
    lastSeenAt: base + 480_000,
    ...over,
  };
}

/** Columns, by their labels, which is what the drawn card actually shows. */
function labels(rec: SessionRecord): string[] {
  return buildShareCard(rec).columns.map((c) => c.label);
}

console.log('--- an outdoor session states every measured number ---');
{
  const card = buildShareCard(session());
  eq('title is the workout', card.title, 'Half mile repeats');
  eq('three headline stats', card.stats.length, 3);
  eq('time first', card.stats[0].value, '8:00');
  eq('miles second', card.stats[1].value, '1.00');
  eq('avg pace third', card.stats[2].value, '8:00');
  ok('goal column is offered', labels(session()).includes('vs goal'), labels(session()).join(','));
  eq('one row per segment', card.rows.length, 2);
  eq('segment name', card.rows[0].cells[0].text, 'Warmup');
  eq('segment time', card.rows[0].cells[1].text, '4:00');
  eq('segment distance', card.rows[0].cells[2].text, '0.50');
  eq('segment pace', card.rows[0].cells[3].text, '8:00');
  eq('a segment with no goal gets no delta', card.rows[0].cells[4].text, '—');
  eq('an exact hit reads even', card.rows[1].cells[4].text, 'even');
  eq('and is marked on target', card.rows[1].cells[4].tone, 'on');
  eq('nothing is elided', card.note, null);
  ok('the file is named for the workout', card.fileName.startsWith('half-mile-repeats-'), card.fileName);
  ok('and is a png', card.fileName.endsWith('.png'), card.fileName);
}

console.log('\n--- indoors, nothing derived from distance is stated ---');
{
  const card = buildShareCard(session({ mode: 'indoor', distanceMeters: 0 }));
  eq('two columns only', card.columns.length, 2);
  ok('no distance column', !labels(session({ mode: 'indoor' })).includes('dist'));
  ok('no pace column', !labels(session({ mode: 'indoor' })).includes('pace'));
  ok('no goal column', !labels(session({ mode: 'indoor' })).includes('vs goal'));
  eq('two headline stats', card.stats.length, 2);
  eq('and the second counts segments', card.stats[1].label, 'segments');
  eq('rows carry a name and a time', card.rows[0].cells.length, 2);
  ok('the subtitle says why', card.subtitle.includes('indoor'), card.subtitle);
  const flat = card.rows.flatMap((r) => r.cells.map((c) => c.text)).join(' ');
  ok('no distance appears anywhere', !/0\.00|0\.50/.test(flat), flat);
}

console.log('\n--- a pace we would not state grows no delta beside it ---');
{
  // A half mile that took an hour is below the sane floor, so the pace cell
  // blanks — and the goal delta must blank with it rather than reading +3120s.
  const crawl = session({
    finishedAt: base + 3_840_000,
    lastSeenAt: base + 3_840_000,
    boundaries: [
      { at: base, distanceMeters: 0 },
      { at: base + 240_000, distanceMeters: MILE / 2 },
    ],
  });
  const card = buildShareCard(crawl);
  eq('the pace blanks', card.rows[1].cells[3].text, '--:--');
  eq('so does the delta', card.rows[1].cells[4].text, '—');
  eq('and it carries no tone', card.rows[1].cells[4].tone, 'plain');
}

console.log('\n--- the goal band decides the tone, not the sign ---');
{
  // Three seconds off a 480 goal is inside the ±5 band, so it is a hit that
  // happens to print a number, not a miss painted like one.
  const near = session({
    boundaries: [
      { at: base, distanceMeters: 0 },
      { at: base + 240_000, distanceMeters: MILE / 2 },
    ],
    // Second segment: half a mile in 4:01.5 → 483 s/mile, +3 off the goal.
    finishedAt: base + 481_500,
    lastSeenAt: base + 481_500,
  });
  const cell = buildShareCard(near).rows[1].cells[4];
  eq('a small miss still prints its size', cell.text, '+3s');
  eq('but reads as on target', cell.tone, 'on');

  // Twenty seconds slow is outside the band and says so.
  const off = session({ finishedAt: base + 500_000, lastSeenAt: base + 500_000 });
  const slow = buildShareCard(off).rows[1].cells[4];
  ok('a real miss is signed', slow.text.startsWith('+'), slow.text);
  eq('and toned slow', slow.tone, 'slow');
}

console.log('\n--- a long session keeps its ends and says what it dropped ---');
{
  const many: WorkoutDef = {
    id: 'w2',
    name: 'Forty reps',
    blocks: [
      {
        id: 'b',
        repeat: 40,
        segments: [{ name: 'Rep', kind: 'work', end: { type: 'time', seconds: 60 } }],
      },
    ],
  };
  const rec = session({
    workout: resolveWorkout(many),
    boundaries: Array.from({ length: 40 }, (_, i) => ({
      at: base + i * 60_000,
      distanceMeters: (i * MILE) / 8,
    })),
    distanceMeters: (40 * MILE) / 8,
    finishedAt: base + 40 * 60_000,
    lastSeenAt: base + 40 * 60_000,
  });
  const card = buildShareCard(rec);
  eq('capped at the drawn maximum', card.rows.length, MAX_CARD_ROWS);
  eq('exactly one elision', card.rows.filter((r) => r.kind === 'elision').length, 1);
  const elision = card.rows.find((r) => r.kind === 'elision')!;
  eq('which counts what it hid', elision.note, '17 more segments');
  ok('and it sits in the middle', card.rows.indexOf(elision) > 0 && card.rows.indexOf(elision) < card.rows.length - 1);
  ok('the first rep survives', card.rows[0].kind === 'segment');
  ok('so does the last', card.rows[card.rows.length - 1].kind === 'segment');
  eq('and the card points at the CSV', card.note, 'Every segment is in the CSV export.');
}

console.log('\n--- a free run still makes a card ---');
{
  const card = buildShareCard(session({ workout: null }));
  eq('titled as a free run', card.title, 'Free run');
  ok('with no goal column', !card.columns.some((c) => c.label === 'vs goal'));
  eq('and laps for names', card.rows[0].cells[0].text, 'Lap 1');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
if (fails > 0) process.exit(1);
