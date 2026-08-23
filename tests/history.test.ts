import { sortSessions, summarize, toCsv, toTextSummary } from '../src/lib/history.ts';
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

const workout: WorkoutDef = {
  id: 'w', name: 'Test, with comma',
  blocks: [{ id: 'b', repeat: 2, segments: [
    { name: 'On', kind: 'work', end: { type: 'time', seconds: 120 }, targetPaceSecPerMile: 480 },
    { name: 'Rest', kind: 'recovery', end: { type: 'time', seconds: 30 } },
  ] }],
};

/** One mile covered in 8:00 across two segments, then finished. */
function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1', createdAt: base, startedAt: base, pauses: [],
    finishedAt: base + 480_000, status: 'finished',
    distanceMeters: MILE, fixCount: 480, source: 'geo',
    workout: resolveWorkout(workout),
    boundaries: [
      { at: base, distanceMeters: 0 },
      { at: base + 240_000, distanceMeters: MILE / 2 },
    ],
    lastSeenAt: base + 480_000,
    ...over,
  };
}

console.log('--- summarize ---');
{
  const s = summarize(session());
  eq('total time', s.totalMs, 480_000);
  eq('distance', Math.round(s.distanceMeters), Math.round(MILE));
  eq('avg pace is 8:00 per mile', Math.round(s.avgPaceSecPerMile!), 480);
  eq('workout name', s.workoutName, 'Test, with comma');
  eq('segment count', s.segmentCount, 2);
  eq('finished', s.finished, true);
}

console.log('\n--- pauses and dead time are excluded ---');
{
  const paused = session({ pauses: [{ start: base + 60_000, end: base + 120_000 }] });
  eq('a minute paused comes off the clock', summarize(paused).totalMs, 420_000);

  // An unfinished session reads to its heartbeat, not to now: the app was dead
  // for whatever came after, and that is not workout time.
  const crashed = session({
    finishedAt: null, status: 'running', lastSeenAt: base + 300_000,
  });
  eq('an unfinished session stops at its heartbeat', summarize(crashed).totalMs, 300_000);
  eq('and is marked unfinished', summarize(crashed).finished, false);
}

console.log('\n--- free run has no workout name ---');
eq('null, not a placeholder', summarize(session({ workout: null })).workoutName, null);

console.log('\n--- newest first ---');
{
  const list = [
    session({ id: 'old', startedAt: base - 90_000 }),
    session({ id: 'new', startedAt: base + 90_000 }),
    session({ id: 'mid', startedAt: base }),
  ];
  eq('order', sortSessions(list).map((s) => s.id).join(','), 'new,mid,old');
  eq('input is not mutated', list[0]!.id, 'old');
}

console.log('\n--- CSV ---');
{
  const csv = toCsv(session());
  const lines = csv.split('\n');
  eq('header first', lines[0]!.startsWith('segment,name,duration_s'), true);
  eq('a row per segment plus a total', lines.length, 4);
  ok('segment row carries the human pace too', /,8:00,/.test(lines[1]!), lines[1]);
  ok('target and delta present where set', lines[1]!.trim().endsWith(',480,0'), lines[1]);
  ok('a segment without a target leaves them blank', lines[2]!.trim().endsWith(',,'), lines[2]);
  ok('totals row is labelled', lines[3]!.startsWith('total,'), lines[3]);

  // A workout name with a comma must not become two columns.
  ok('commas in names are quoted', lines[3]!.includes('"Test, with comma"'), lines[3]);
  // Count fields by actually parsing, not by pattern: a regex miscounts
  // quoted commas and trailing empties, which is a broken test, not a broken file.
  const fieldCount = (line: string) => {
    let n = 1, inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) n++;
    }
    return n;
  };
  eq('header declares nine columns', fieldCount(lines[0]!), 9);
  eq('every row has the same column count',
     new Set(lines.map(fieldCount)).size, 1);
}

console.log('\n--- CSV quoting handles quotes themselves ---');
{
  const nasty: WorkoutDef = {
    id: 'w2', name: 'He said "go"',
    blocks: [{ id: 'b', repeat: 1, segments: [
      { name: 'Say "hi"', kind: 'work', end: { type: 'time', seconds: 60 } }] }],
  };
  const csv = toCsv(session({ workout: resolveWorkout(nasty), boundaries: [{ at: base, distanceMeters: 0 }] }));
  ok('doubled quotes', csv.includes('"Say ""hi"""'), csv.split('\n')[1]);
}

console.log('\n--- text summary ---');
{
  const text = toTextSummary(session());
  const lines = text.split('\n');
  eq('starts with the workout', lines[0], 'Test, with comma');
  ok('has a totals line', /8:00 · 1\.00 mi · 8:00\/mi/.test(lines[2]!), lines[2]);
  ok('lists each segment', lines.filter((l) => /^On |^Rest /.test(l)).length === 2, text);
  ok('shows the delta against a target', /On 1 .*(even|[+-]\d+s)/.test(text), text);
  ok('short enough to paste', text.split('\n').length <= 12, `${text.split('\n').length} lines`);
}

console.log('\n--- a pace the app refuses to show grows no delta ---');
{
  // 20m in six minutes is 0.12 mph, which the hero renders as `--:--`.
  // Nothing downstream may invent a number from a reading we won't state.
  const crawl = session({
    boundaries: [{ at: base, distanceMeters: 0 }],
    finishedAt: base + 360_000, lastSeenAt: base + 360_000, distanceMeters: 20,
  });
  const csvLines = toCsv(crawl).split('\n');
  const row = csvLines[1]!;
  ok('csv leaves the pace columns empty', /,,,/.test(row + ','), row);
  ok('and states no delta', !/[+-]?\d{3,}s?$/.test(row.split(',').pop() ?? ''), row);
  const text = toTextSummary(crawl);
  ok('text shows --:--', text.includes('--:--'), text.split('\n').slice(-2).join(' | '));
  ok('no absurd delta anywhere',
     !/[+-]\d{4,}/.test(text) && !/[+-]\d{4,}/.test(csvLines.join('\n')), text);
}

console.log('\n--- a session with no segments still exports ---');
{
  const bare = session({ boundaries: [{ at: base, distanceMeters: 0 }], workout: null });
  ok('csv has header, one row, total', toCsv(bare).split('\n').length === 3);
  ok('text summary does not throw', toTextSummary(bare).length > 0);
}

console.log('\n--- an indoor session states time, and nothing distance implies ---');
{
  // The odometer never moved on a treadmill. Zero miles is not a measurement,
  // so the export leaves those columns empty rather than reporting a session
  // that covered nothing at a pace of nothing.
  // A name without a comma in it, so a row splits cleanly on commas here.
  const treadmill = session({
    mode: 'indoor',
    distanceMeters: 0,
    fixCount: 0,
    workout: resolveWorkout({ ...workout, name: 'Treadmill' }),
  });
  const s = summarize(treadmill);
  eq('flagged indoor', s.indoor, true);
  eq('time is still exact', s.totalMs, 480_000);
  eq('no average pace', s.avgPaceSecPerMile, null);

  const lines = toCsv(treadmill).split('\n');
  eq('header still declares nine columns', lines[0]!.split(',').length, 9);
  for (const row of lines.slice(1)) {
    const cells = row.split(',');
    ok('distance cell empty', cells[4] === '', row);
    ok('pace cells empty', cells[5] === '' && cells[6] === '', row);
    ok('no delta against the goal', cells[8] === '', row);
    ok('duration is still there', Number(cells[2]) > 0, row);
  }

  const text = toTextSummary(treadmill);
  ok('text says indoor', text.includes('indoor'), text.split('\n')[1]!);
  ok('text states no miles', !text.includes(' mi'), text);
  ok('text states no pace', !text.includes('/mi') && !text.includes('--:--'), text);
  ok('but still lists the segments', text.split('\n').filter((l) => /^On |^Rest /.test(l)).length === 2, text);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
