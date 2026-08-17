import { computeAutoAdvance, currentSegment, onDeckSegment, remaining, segmentElapsedMs, completedSegments, isWorkoutComplete } from '../src/lib/segments.ts';
import { PRESET_WORKOUTS, resolveWorkout, blankWorkout, copyWorkout } from '../src/lib/workouts.ts';
import { elapsedMs, type SessionRecord } from '../src/lib/types.ts';
import { formatClock, formatCountdown } from '../src/lib/units.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

const DEF = PRESET_WORKOUTS.find(w => w.id === 'on-off-2min-30s-x4')!;
const W = resolveWorkout(DEF);
const base = 1_700_000_000_000;

function fresh(): SessionRecord {
  return {
    id: 's', createdAt: base, startedAt: base, pauses: [], finishedAt: null,
    status: 'running', distanceMeters: 0, fixCount: 0, source: 'sim',
    workout: W, boundaries: [{ at: base, distanceMeters: 0 }], lastSeenAt: base,
  };
}

/** Walk wall-clock time forward, applying advances the way the app does. */
function runTo(rec: SessionRecord, now: number, dist = 0) {
  const add = computeAutoAdvance(rec, now, dist);
  rec.boundaries = [...rec.boundaries, ...add];
  return rec;
}

console.log('--- workout shape: 4 x (2 min on / 30 s rest) ---');
eq('segment count', W.segments.length, 8);
eq('first is On 1', W.segments[0]!.name, 'On 1');
eq('second is Rest 1', W.segments[1]!.name, 'Rest 1');
eq('total planned', W.segments.reduce((a,s)=> a + (s.end.type==='time'? s.end.seconds:0), 0), 600);

console.log('\n--- countdown + on deck ---');
{
  const r = fresh();
  runTo(r, base + 5_000);
  eq('still on segment 1', currentSegment(r)!.name, 'On 1');
  eq('countdown at 5s in', formatClock(remaining(r, currentSegment(r)!, base + 5_000, 0)), '1:55');
  eq('on deck', onDeckSegment(r)!.name, 'Rest 1');
}

console.log('\n--- auto-advance lands exactly on the boundary ---');
{
  const r = fresh();
  runTo(r, base + 119_900);
  eq('not yet advanced at 1:59.9', currentSegment(r)!.name, 'On 1');
  runTo(r, base + 120_100);
  eq('advanced at 2:00.1', currentSegment(r)!.name, 'Rest 1');
  eq('boundary placed at exactly 2:00', r.boundaries[1]!.at - base, 120_000);
  eq('rest countdown is full 0:30', formatClock(remaining(r, currentSegment(r)!, base + 120_100, 0)), '0:29');
  eq('segment elapsed is 100ms, not 100ms+', segmentElapsedMs(r, base + 120_100), 100);
}

console.log('\n--- phone sleeps through a whole rest (the iOS case) ---');
{
  const r = fresh();
  // Nothing ticks between 0:00 and 2:40 — three boundaries are due at once.
  runTo(r, base + 160_000);
  eq('landed on the right segment, not one behind', currentSegment(r)!.name, 'On 2');
  eq('boundaries recorded', r.boundaries.length, 3);
  eq('On 1 -> Rest 1 at 2:00', r.boundaries[1]!.at - base, 120_000);
  eq('Rest 1 -> On 2 at 2:30', r.boundaries[2]!.at - base, 150_000);
  eq('On 2 already 10s in', formatClock(segmentElapsedMs(r, base + 160_000)), '0:10');
}

console.log('\n--- pause shifts every later boundary by the paused time ---');
{
  const r = fresh();
  r.pauses = [{ start: base + 60_000, end: base + 90_000 }];   // 30s paused mid-rep
  runTo(r, base + 145_000);
  eq('not advanced at 2:25 wall (only 1:55 run)', currentSegment(r)!.name, 'On 1');
  runTo(r, base + 151_000);
  eq('advanced once past 2:00 of running time', currentSegment(r)!.name, 'Rest 1');
  eq('boundary at wall 2:30', r.boundaries[1]!.at - base, 150_000);
}

console.log('\n--- an open pause never advances the schedule ---');
{
  const r = fresh();
  r.pauses = [{ start: base + 60_000, end: null }];
  r.status = 'paused';
  runTo(r, base + 600_000);
  eq('still on segment 1 after 10 wall minutes paused', currentSegment(r)!.name, 'On 1');
  eq('segment clock frozen at 1:00', formatClock(segmentElapsedMs(r, base + 600_000)), '1:00');
}

console.log('\n--- final segment runs into overtime instead of ending itself ---');
{
  const r = fresh();
  runTo(r, base + 700_000);
  eq('on the last segment', currentSegment(r)!.name, 'Rest 4');
  eq('index is last', r.boundaries.length, 8);
  eq('marked complete', isWorkoutComplete(r, base + 700_000, 0), true);
  eq('overtime is negative remaining', remaining(r, currentSegment(r)!, base + 700_000, 0) < 0, true);
  eq('no on-deck segment', onDeckSegment(r), undefined ?? null);
}

console.log('\n--- countdown and stopwatch flip on the same beat ---');
{
  // The reported bug: at 9.4s into a 2:00 segment the stopwatch reads 0:09
  // while a truncating countdown reads 1:50 — they sum to 119, not 120, so one
  // visibly changes a beat before the other.
  const r = fresh();
  let mismatched = 0;
  for (let ms = 0; ms <= 120_000; ms += 137) {   // deliberately off-grid sampling
    const shownElapsed = Math.floor(elapsedMs(r, base + ms) / 1000);
    const shownRemaining = Math.ceil((120_000 - segmentElapsedMs(r, base + ms)) / 1000);
    if (shownElapsed + shownRemaining !== 120) mismatched++;
  }
  eq('every sample sums to the full segment', mismatched, 0);
  eq('first second shows the full 2:00', formatCountdown(120_000 - 400), '2:00');
  eq('stopwatch shows 0:00 at the same instant', formatClock(400), '0:00');
  eq('9.4s in: countdown', formatCountdown(120_000 - 9_400), '1:51');
  eq('9.4s in: stopwatch', formatClock(9_400), '0:09');
  eq('hits 0:00 exactly on the boundary', formatCountdown(0), '0:00');
  eq('last tenth still shows 0:01', formatCountdown(100), '0:01');
}

console.log('\n--- builder: repeat groups flatten, presets stay pristine ---');
{
  const blank = blankWorkout();
  eq('blank has one 4x block', blank.blocks.length, 1);
  eq('blank resolves to 8 segments', resolveWorkout(blank).segments.length, 8);

  const dup = copyWorkout(DEF);
  eq('duplicate is editable', dup.builtIn, false);
  eq('duplicate gets a new id', dup.id === DEF.id, false);
  dup.blocks[0]!.repeat = 6;
  eq('editing the copy resolves to 12', resolveWorkout(dup).segments.length, 12);
  eq('preset untouched', resolveWorkout(DEF).segments.length, 8);
  eq('preset blocks untouched', DEF.blocks[0]!.repeat, 4);

  const single = { id: 'x', name: 'x', blocks: [{ id: 'b', repeat: 1, segments: [
    { name: 'Warmup', kind: 'warmup' as const, end: { type: 'time' as const, seconds: 300 } }] }] };
  eq('repeat of 1 does not number the name', resolveWorkout(single).segments[0]!.name, 'Warmup');
}

console.log('\n--- distance segments: 6 x 800m ---');
{
  const D = resolveWorkout(PRESET_WORKOUTS.find(w => w.id === 'repeats-800-x6')!);
  const r: SessionRecord = { ...fresh(), workout: D, boundaries: [{ at: base, distanceMeters: 0 }] };
  runTo(r, base + 200_000, 500);
  eq('mid-rep at 500m', currentSegment(r)!.name, '800m 1');
  eq('remaining 300m', Math.round(remaining(r, currentSegment(r)!, base + 200_000, 500)), 300);
  runTo(r, base + 300_000, 815);
  eq('advanced past 800m', currentSegment(r)!.name, 'Recovery 1');
  eq('anchored to the target, not the overshoot', r.boundaries[1]!.distanceMeters, 800);
  eq('recovery already 15m in', Math.round(815 - r.boundaries[1]!.distanceMeters), 15);
}

console.log('\n--- segment table derives from boundaries alone ---');
{
  const r = fresh();
  runTo(r, base + 310_000);
  const rows = completedSegments(r, base + 310_000, 1200);
  // 5:10 in: On1 2:00, Rest1 0:30, On2 2:00, Rest2 0:30, On3 open at 0:10
  eq('rows so far', rows.length, 5);
  eq('On 1 duration', formatClock(rows[0]!.durationMs), '2:00');
  eq('Rest 1 duration', formatClock(rows[1]!.durationMs), '0:30');
  eq('On 2 duration', formatClock(rows[2]!.durationMs), '2:00');
  eq('open row is the current one', rows[4]!.open, true);
  eq('open row name', rows[4]!.name, 'On 3');
  eq('open row duration so far', formatClock(rows[4]!.durationMs), '0:10');
  eq('total session time unaffected', formatClock(elapsedMs(r, base + 310_000)), '5:10');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
