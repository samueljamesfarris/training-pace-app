import { speakableDuration, speakablePace } from '../src/lib/speech.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

console.log('--- pace, as a person says it ---');
// "8:04" read literally is "eight colon zero four", which is not a pace.
eq('8:04', speakablePace(484), '8 oh 4');
eq('8:00 is flat', speakablePace(480), '8 flat');
eq('7:30', speakablePace(450), '7 30');
eq('5:45', speakablePace(345), '5 45');
eq('6:09 keeps the oh', speakablePace(369), '6 oh 9');
eq('rounds to the nearest second', speakablePace(484.4), '8 oh 4');
eq('null stays null', speakablePace(null), null);
eq('infinity is not a pace', speakablePace(Infinity), null);

console.log('\n--- durations ---');
eq('30 seconds', speakableDuration(30_000), '30 seconds');
eq('one second is singular', speakableDuration(1_000), '1 second');
eq('2 minutes exactly', speakableDuration(120_000), '2 minutes');
eq('one minute is singular', speakableDuration(60_000), '1 minute');
eq('1:59', speakableDuration(119_000), '1 59');
eq('2:05 keeps the oh', speakableDuration(125_000), '2 oh 5');
eq('zero', speakableDuration(0), '0 seconds');
eq('negative clamps', speakableDuration(-5_000), '0 seconds');
// Must agree with the clock on screen, which floors. Rounding here made the
// voice say "29 seconds" beside a pill reading 0:28.
eq('truncates like the display, not rounds', speakableDuration(28_600), '28 seconds');
eq('and does so past a minute too', speakableDuration(119_900), '1 59');

console.log('\n--- phrases stay short enough to finish before the next cue ---');
{
  // A boundary announcement is spoken 1.7s after the tone; the next countdown
  // warning is 10s before the following boundary, so there is room, but only
  // if the phrase is a few words rather than a sentence.
  const phrase = `${speakableDuration(119_000)}, ${speakablePace(450)} pace`;
  eq('boundary phrase', phrase, '1 59, 7 30 pace');
  eq('word count stays small', phrase.split(' ').length <= 7, true);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
