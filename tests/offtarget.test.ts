import {
  deviation,
  OffTargetWatcher,
  OFF_TARGET_COOLDOWN_MS,
  OFF_TARGET_HOLD_MS,
} from '../src/lib/offTarget.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

const T = 480;   // 8:00 target
const TOL = 5;

console.log('--- which side of the band (lower seconds is faster) ---');
eq('on target', deviation(480, T, TOL), null);
eq('inside the band, slightly fast', deviation(476, T, TOL), null);
eq('inside the band, slightly slow', deviation(484, T, TOL), null);
eq('exactly on the fast edge is still inside', deviation(475, T, TOL), null);
eq('exactly on the slow edge is still inside', deviation(485, T, TOL), null);
eq('past the fast edge', deviation(474, T, TOL), 'fast');
eq('past the slow edge', deviation(486, T, TOL), 'slow');
eq('no pace, no verdict', deviation(null, T, TOL), null);
eq('no target, no verdict', deviation(470, null, TOL), null);
eq('no target set on the segment', deviation(470, undefined, TOL), null);

console.log('\n--- it waits five continuous seconds before saying anything ---');
{
  const w = new OffTargetWatcher();
  let fired: string | null = null;
  for (let t = 0; t < OFF_TARGET_HOLD_MS; t += 250) {
    fired = w.update(t, 460, T, TOL) ?? fired;
  }
  eq('silent for the first five seconds', fired, null);
  eq('fires once the hold is met', w.update(OFF_TARGET_HOLD_MS, 460, T, TOL), 'fast');
}

console.log('\n--- a brief excursion never fires ---');
{
  const w = new OffTargetWatcher();
  let fired: string | null = null;
  for (let t = 0; t < 3000; t += 250) fired = w.update(t, 460, T, TOL) ?? fired;
  // back inside the band before the hold elapsed
  for (let t = 3000; t < 9000; t += 250) fired = w.update(t, 480, T, TOL) ?? fired;
  eq('drifting over the line and back stays quiet', fired, null);
}

console.log('\n--- crossing to the other side restarts the clock ---');
{
  const w = new OffTargetWatcher();
  let fired: string | null = null;
  for (let t = 0; t < 4500; t += 250) fired = w.update(t, 460, T, TOL) ?? fired;   // fast
  eq('nothing yet', fired, null);
  // flip to slow just before the hold would have elapsed
  for (let t = 4500; t < 8000; t += 250) fired = w.update(t, 500, T, TOL) ?? fired;
  eq('the flip does not inherit the old hold', fired, null);
  eq('and fires only after a fresh five seconds', w.update(9600, 500, T, TOL), 'slow');
}

console.log('\n--- rate limited to once every twenty seconds ---');
{
  const w = new OffTargetWatcher();
  const fires: number[] = [];
  for (let t = 0; t <= 70_000; t += 250) {
    if (w.update(t, 460, T, TOL)) fires.push(t);
  }
  eq('first warning at the five second mark', fires[0], OFF_TARGET_HOLD_MS);
  eq('second a full cooldown later', fires[1], OFF_TARGET_HOLD_MS + OFF_TARGET_COOLDOWN_MS);
  eq('third likewise', fires[2], OFF_TARGET_HOLD_MS + 2 * OFF_TARGET_COOLDOWN_MS);
  eq('and no more than that in 70 seconds', fires.length, 4);
}

console.log('\n--- reset behaviour ---');
{
  const w = new OffTargetWatcher();
  for (let t = 0; t <= 6000; t += 250) w.update(t, 460, T, TOL);
  w.reset();  // segment changed
  let fired: string | null = null;
  for (let t = 6000; t < 10_500; t += 250) fired = w.update(t, 460, T, TOL) ?? fired;
  eq('a new segment starts the hold again', fired, null);

  const fresh = new OffTargetWatcher();
  fresh.resetAll();
  eq('a new session does not inherit a cooldown',
     (() => { let f: string | null = null;
       for (let t = 0; t <= OFF_TARGET_HOLD_MS; t += 250) f = fresh.update(t, 460, T, TOL) ?? f;
       return f; })(), 'fast');
}

console.log('\n--- a segment with no target is never warned about ---');
{
  const w = new OffTargetWatcher();
  let fired: string | null = null;
  for (let t = 0; t <= 60_000; t += 250) fired = w.update(t, 300, undefined, TOL) ?? fired;
  eq('silent for a whole minute of wild pace', fired, null);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
