import {
  HALFWAY_MIN_M,
  HALFWAY_MIN_MS,
  SegmentCoach,
  warningMeters,
  WARNING_LEAD_MS,
} from '../src/lib/coach.ts';
import { METERS_PER_MILE } from '../src/lib/units.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

/** Walk a timed segment down from `total` to `end`, collecting what fired. */
function runTimed(total: number, from: number, to: number, stepMs = 100, index = 0) {
  const coach = new SegmentCoach();
  const fired: { cue: string; left: number }[] = [];
  for (let left = from; left >= to; left -= stepMs) {
    const cue = coach.update({ index, kind: 'time', total, left });
    if (cue) fired.push({ cue, left });
  }
  return fired;
}

console.log('--- how far out a distance heads-up lands ---');
// 200 m into a 400 is half of it; the callout has to be scaled to the rep.
eq('a 400 is called at 100 out', warningMeters(400), 100);
eq('an 800 at 200', warningMeters(800), 200);
eq('a mile at a quarter of one', warningMeters(METERS_PER_MILE), 400);
eq('and so is anything longer', warningMeters(3 * METERS_PER_MILE), 400);

console.log('\n--- the heads-up fires once, at the lead ---');
{
  const fired = runTimed(120_000, 120_000, 0);
  eq('exactly one', fired.length, 1);
  eq('and it is the warning', fired[0]?.cue, 'warning');
  eq('at ten seconds out', fired[0]?.left, WARNING_LEAD_MS);
}

console.log('\n--- a segment barely longer than its own heads-up gets none ---');
{
  // Announcing the end of a fifteen-second rest is talking through the rest.
  eq('15 seconds stays quiet', runTimed(15_000, 15_000, 0).length, 0);
  eq('20 seconds is still too short', runTimed(20_000, 20_000, 0).length, 0);
  eq('21 seconds earns one', runTimed(21_000, 21_000, 0).length, 1);
}

console.log('\n--- a cue that went by while the phone slept is swallowed ---');
{
  // iOS suspends JS in the background. Coming back with two seconds left and
  // announcing "ten seconds, then Rest number 3" is worse than saying nothing:
  // the beeps were scheduled on the audio clock and already told the truth.
  const coach = new SegmentCoach();
  eq(
    'a jump from 30s left to 2s says nothing',
    coach.update({ index: 0, kind: 'time', total: 120_000, left: 30_000 }) ??
      coach.update({ index: 0, kind: 'time', total: 120_000, left: 2_000 }),
    null,
  );
  eq(
    'and it stays spent, rather than firing late on the next tick',
    coach.update({ index: 0, kind: 'time', total: 120_000, left: 1_900 }),
    null,
  );
  // Five seconds is still worth hearing; the 3-2-1 beeps have not started.
  eq('five seconds still lands', runTimed(120_000, 30_000, 5_000, 25_000)[0]?.cue, 'warning');
}

console.log('\n--- one progress call, and only on a segment long enough to need it ---');
{
  eq('a two-minute rep gets no halfway', runTimed(120_000, 120_000, 0).filter((f) => f.cue === 'halfway').length, 0);
  const long = runTimed(HALFWAY_MIN_MS, HALFWAY_MIN_MS, 0);
  eq('a four-minute one does', long.map((f) => f.cue).join(','), 'halfway,warning');
  eq('at the midpoint', long[0]?.left, HALFWAY_MIN_MS / 2);
  eq('and only once', long.filter((f) => f.cue === 'halfway').length, 1);
}

console.log('\n--- a distance segment counts down in meters ---');
{
  const coach = new SegmentCoach();
  const fired: string[] = [];
  for (let left = 800; left >= 0; left -= 10) {
    const cue = coach.update({ index: 0, kind: 'distance', total: 800, left });
    if (cue) fired.push(`${cue}@${left}`);
  }
  eq('an 800 is called at 200 to go', fired.join(','), 'warning@200');

  // 1200 m clears the halfway minimum; 800 does not.
  const c2 = new SegmentCoach();
  const fired2: string[] = [];
  for (let left = HALFWAY_MIN_M; left >= 0; left -= 10) {
    const cue = c2.update({ index: 0, kind: 'distance', total: HALFWAY_MIN_M, left });
    if (cue) fired2.push(`${cue}@${left}`);
  }
  eq('a 1200 gets both', fired2.join(','), 'halfway@600,warning@200');
}

console.log('\n--- overtime and segment changes ---');
{
  // The last segment runs past zero until FINISH is tapped. Nothing is due
  // there, and nothing may fire twice.
  const coach = new SegmentCoach();
  for (let left = 120_000; left >= 0; left -= 100) coach.update({ index: 0, kind: 'time', total: 120_000, left });
  let extra = 0;
  for (let left = -100; left >= -30_000; left -= 100) {
    if (coach.update({ index: 0, kind: 'time', total: 120_000, left })) extra++;
  }
  eq('overtime is silent', extra, 0);

  // A new segment is a clean slate; without that, the second rep of a set
  // inherits the first one's spent heads-up and never gets called.
  eq(
    'the next segment starts over',
    coach.update({ index: 1, kind: 'time', total: 120_000, left: WARNING_LEAD_MS }),
    'warning',
  );

  coach.resetAll();
  eq(
    'and so does a new session at the same index',
    coach.update({ index: 1, kind: 'time', total: 120_000, left: WARNING_LEAD_MS }),
    'warning',
  );
}

console.log('\n--- a zero-length segment cannot divide by itself ---');
eq('nothing fires', new SegmentCoach().update({ index: 0, kind: 'time', total: 0, left: 0 }), null);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
