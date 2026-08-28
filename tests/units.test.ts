import {
  countdownUnit,
  formatRemaining,
  METERS_PER_MILE,
  remainingLabel,
} from '../src/lib/units.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

console.log('--- a countdown never changes units under you ---');
{
  // The bug this replaces: a two-mile warmup counted 2.00 ... 1.00 and then
  // flipped to 1609 with nothing announcing it. The unit comes from the
  // segment's length, so it is the same at the start and at the finish.
  const twoMiles = 2 * METERS_PER_MILE;
  eq('a 2 mile warmup starts in miles', countdownUnit(twoMiles, null), 'mi');
  eq('and is still in miles with 1609 m left', countdownUnit(twoMiles, null), 'mi');
  eq('and with 10 m left', countdownUnit(twoMiles, null), 'mi');

  eq('an 800 counts in meters', countdownUnit(800, null), 'm');
  eq('a 400 counts in meters', countdownUnit(400, null), 'm');
  eq('exactly a mile counts in miles', countdownUnit(METERS_PER_MILE, null), 'mi');
  eq('just under a mile counts in meters', countdownUnit(METERS_PER_MILE - 1, null), 'm');
}

console.log('\n--- an explicit choice wins, whatever the segment ---');
{
  eq('meters asked for on a long segment', countdownUnit(5000, 'm'), 'm');
  eq('miles asked for on a short one', countdownUnit(400, 'mi'), 'mi');
}

console.log('\n--- the number itself ---');
{
  eq('miles keep two decimals', formatRemaining(2 * METERS_PER_MILE, 'mi'), '2.00');
  eq('a mile left', formatRemaining(METERS_PER_MILE, 'mi'), '1.00');
  eq('meters are whole', formatRemaining(802.4, 'm'), '802');
  eq('a finished segment reads zero, not a negative', formatRemaining(-50, 'm'), '0');
  eq('and in miles too', formatRemaining(-50, 'mi'), '0.00');
  eq('label follows the unit', remainingLabel('mi'), 'miles to go');
  eq('and in meters', remainingLabel('m'), 'meters to go');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
