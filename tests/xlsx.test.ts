import { exportBaseName, toWorkbook } from '../src/lib/history.ts';
import { resolveWorkout, type WorkoutDef } from '../src/lib/workouts.ts';
import type { SessionRecord } from '../src/lib/types.ts';
import { buildXlsx, columnName, crc32, excelDate, excelDuration } from '../src/lib/xlsx.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const good = Object.is(got, want);
  if (!good) fails++;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${label}: ${got}${good ? '' : ` (want ${want})`}`);
}
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ': ' + detail : ''}`);
}

const base = 1_700_000_000_000;
const MILE = 1609.344;

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

/** One mile in 8:00, across two half-mile segments; the second has a goal. */
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

console.log('--- the pieces the format is built from ---');
{
  eq('first column', columnName(0), 'A');
  eq('last single letter', columnName(25), 'Z');
  eq('and it carries', columnName(26), 'AA');
  eq('a known crc', crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  eq('an empty crc', crc32(new Uint8Array(0)), 0);
  // A duration is a fraction of a day, so a column of them adds up.
  eq('an hour is a twenty-fourth of a day', excelDuration(3600), 1 / 24);
  eq('eight minutes', excelDuration(480), 480 / 86400);
  // Serial 0 is Excel's 1899-12-31; 1970-01-01 sits 25569 days later.
  const epochLocal = Date.parse('1970-01-01T00:00:00') ;
  eq('the unix epoch lands on Excel day 25569', excelDate(epochLocal), 25569);
}

console.log('\n--- an outdoor session keeps every measured number ---');
{
  const [summary, splits] = toWorkbook(session());
  eq('two sheets', toWorkbook(session()).length, 2);
  eq('summary is named', summary.name, 'Summary');
  eq('splits are named', splits.name, 'Splits');
  ok('the splits header is frozen', splits.freezeHeader);
  ok('the summary header is not', !summary.freezeHeader);

  eq('the workout is named', summary.rows[0][1].value, 'Half mile repeats');
  eq('the total time is a duration', summary.rows[5][1].value, excelDuration(480));
  eq('and is styled as one', summary.rows[5][1].style, 'duration');
  eq('the distance is a number', summary.rows[6][1].value, 1);
  eq('the avg pace is a duration', summary.rows[7][1].value, excelDuration(480));

  eq('header, two segments and a total', splits.rows.length, 4);
  eq('the header names the goal column', splits.rows[0][6].value, 'vs Goal (s)');
  const rep = splits.rows[2];
  eq('the segment is numbered', rep[0].value, 2);
  eq('and named', rep[1].value, 'Rep 1');
  eq('its duration is a duration', rep[2].value, excelDuration(240));
  eq('its distance is a number', rep[3].value, 0.5);
  eq('its pace is a duration', rep[4].value, excelDuration(480));
  eq('its goal is a duration too', rep[5].value, excelDuration(480));
  eq('an exact hit is zero, not blank', rep[6].value, 0);

  const warmup = splits.rows[1];
  eq('a segment with no goal has no goal cell', warmup[5].value, undefined);
  eq('and no delta', warmup[6].value, undefined);

  const totals = splits.rows[3];
  eq('the last row totals', totals[0].value, 'Total');
  eq('in bold', totals[2].style, 'boldDuration');
  eq('with the whole session time', totals[2].value, excelDuration(480));
}

console.log('\n--- indoors the cells are empty, never zero ---');
{
  const [summary, splits] = toWorkbook(session({ mode: 'indoor', distanceMeters: 0 }));
  eq('the mode says so', summary.rows[2][1].value, 'Indoor');
  eq('and no source is claimed', summary.rows[3][1].value, 'none');
  eq('no total distance', summary.rows[6][1].value, undefined);
  eq('no avg pace', summary.rows[7][1].value, undefined);
  eq('the time is still there', summary.rows[5][1].value, excelDuration(480));

  // The columns stay put so two exports can be stacked; the cells are blank.
  eq('the columns are unchanged', splits.rows[0].length, 7);
  const rep = splits.rows[2];
  eq('no distance', rep[3].value, undefined);
  eq('no pace', rep[4].value, undefined);
  eq('no goal', rep[5].value, undefined);
  eq('no delta', rep[6].value, undefined);
  eq('but the duration survives', rep[2].value, excelDuration(240));

  const values = splits.rows.flatMap((r) => r.map((c) => c.value));
  ok('and nothing anywhere is a zero distance', !values.includes(0), JSON.stringify(values));
}

console.log('\n--- a pace we would not state is a pace we do not subtract ---');
{
  // A half mile taking four minutes is fine; taking an hour is below the sane
  // floor, so the pace blanks — and the delta has to blank with it.
  const crawl = session({ distanceMeters: MILE / 200 });
  const [, splits] = toWorkbook(crawl);
  eq('the pace is absent', splits.rows[2][4].value, undefined);
  eq('so is the delta', splits.rows[2][6].value, undefined);
  eq('though the goal still shows what was asked', splits.rows[2][5].value, excelDuration(480));
}

console.log('\n--- file names are for humans ---');
{
  eq('slugged and dated', exportBaseName(session()), 'half-mile-repeats-2023-11-14');
  eq('a free run says so', exportBaseName(session({ workout: null })), 'free-run-2023-11-14');
}

console.log('\n--- the bytes are a real archive ---');
{
  const bytes = buildXlsx(toWorkbook(session()), base);
  ok('it starts with a local file header', bytes[0] === 0x50 && bytes[1] === 0x4b);
  const tail = bytes.subarray(bytes.length - 22);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  eq('it ends with the central directory record', view.getUint32(0, true), 0x06054b50);
  eq('holding seven entries', view.getUint16(10, true), 7);
  eq('and the directory is where it says', view.getUint32(16, true) + view.getUint32(12, true), bytes.length - 22);

  // A name from a shared link is untrusted, and lands in a file someone opens.
  const nasty = session({
    workout: { ...resolveWorkout(workout), name: 'A & B <c> "d" [Sheet]:*?' },
  });
  const xml = new TextDecoder().decode(buildXlsx(toWorkbook(nasty), base));
  ok('the ampersand is escaped', xml.includes('A &amp; B'), '');
  ok('the angle brackets are escaped', xml.includes('&lt;c&gt;'), '');
  ok('no raw quote survives in the sheet name', !xml.includes('name="A & B'), '');
  ok('and the sheet names are still the plain two', xml.includes('name="Summary"') && xml.includes('name="Splits"'));
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
if (fails > 0) process.exit(1);
