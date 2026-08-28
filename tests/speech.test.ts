import {
  boundaryPhrases,
  speakableDuration,
  speakablePace,
  spokenSegmentName,
} from '../src/lib/speech.ts';
import { resolveWorkout, type WorkoutDef } from '../src/lib/workouts.ts';

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


console.log('\n--- a rep inside a set is named the way a coach says it ---');
{
  const ladder: WorkoutDef = {
    id: 'w', name: 'Set test',
    blocks: [
      { id: 'a', repeat: 1, segments: [{ name: 'Warmup', kind: 'warmup', end: { type: 'time', seconds: 600 } }] },
      { id: 'b', repeat: 4, segments: [
        { name: 'On', kind: 'work', end: { type: 'time', seconds: 60 } },
        { name: 'Rest', kind: 'recovery', end: { type: 'time', seconds: 60 } },
      ] },
    ],
  };
  const segs = resolveWorkout(ladder).segments;
  eq('a standalone step keeps its plain name on screen', segs[0]!.name, 'Warmup');
  eq('and is spoken the same way', spokenSegmentName(segs[0]!), 'Warmup');
  eq('a rep still displays as before', segs[2]!.name, 'Rest 1');
  eq('but is spoken with "number"', spokenSegmentName(segs[2]!), 'Rest number 1');
  eq('second round', spokenSegmentName(segs[3]!), 'On number 2');
  eq('the standalone step carries no repeat index', segs[0]!.repeatIndex, undefined);
  eq('a rep knows which round it is', segs[3]!.repeatIndex, 2);
  eq('and how many there are', segs[3]!.repeatTotal, 4);
}

console.log('\n--- what gets said at a boundary ---');
{
  // Inside a set the report of the rep just finished is dropped: on a 60s rep
  // it is still talking when the next rep has started, and the next rep is the
  // point. Only the new step is announced.
  eq(
    'a rep inside a set announces only what is next',
    boundaryPhrases({ durationMs: 60_000, paceSecPerMile: 450, inRepeat: true }, 'Rest number 2').join(' | '),
    'Rest number 2',
  );
  eq(
    'a standalone step still reports its split first',
    boundaryPhrases({ durationMs: 600_000, paceSecPerMile: 480, inRepeat: false }, 'Tempo').join(' | '),
    '10 minutes, 8 flat pace | Tempo',
  );
  eq(
    'with no measurable pace it states the time alone',
    boundaryPhrases({ durationMs: 600_000, paceSecPerMile: null, inRepeat: false }, 'Tempo').join(' | '),
    '10 minutes | Tempo',
  );
  eq(
    'a free-run lap has nothing next, so it is just the split',
    boundaryPhrases({ durationMs: 300_000, paceSecPerMile: 450, inRepeat: false }, null).join(' | '),
    '5 minutes, 7 30 pace',
  );
  eq(
    'a mis-tap gets no eulogy',
    boundaryPhrases({ durationMs: 900, paceSecPerMile: 450, inRepeat: false }, 'Tempo').join(' | '),
    'Tempo',
  );
  eq(
    'the last segment of a set says nothing at all',
    boundaryPhrases({ durationMs: 60_000, paceSecPerMile: 450, inRepeat: true }, null).length,
    0,
  );
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
