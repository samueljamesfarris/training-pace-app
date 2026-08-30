import {
  boundaryPhrases,
  completionPhrases,
  halfwayPhrase,
  nextUpPhrase,
  offTargetPhrase,
  segmentInstruction,
  speakableDuration,
  speakableLength,
  speakableName,
  speakablePace,
  spokenSegmentName,
  startPhrases,
  type SpokenSegment,
} from '../src/lib/speech.ts';
import { MILE, resolveWorkout, type WorkoutDef } from '../src/lib/workouts.ts';

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

console.log('\n--- a distance in a name is read as a distance ---');
// "800m" spoken literally is "eight hundred em", which is the runner wondering
// what the phone said instead of running.
eq('meters', speakableName('800m'), '800 meters');
eq('with a space', speakableName('400 m'), '400 meters');
eq('miles', speakableName('3 mi'), '3 miles');
eq('a word ending in m is left alone', speakableName('Warm'), 'Warm');
eq('so is a plain name', speakableName('Tempo'), 'Tempo');
eq('and the indexed form still reads right', spokenSegmentName({
  name: '800m 2', baseName: '800m', repeatIndex: 2,
}), '800 meters number 2');

console.log('\n--- a planned length is stated in units, not as a stopwatch ---');
// speakableDuration reads a split off a clock; a length is an instruction, and
// "On, 1 30" leaves the units to be guessed at.
eq('round minutes', speakableLength({ type: 'time', seconds: 120 }), '2 minutes');
eq('one minute is singular', speakableLength({ type: 'time', seconds: 60 }), '1 minute');
eq('minutes and seconds', speakableLength({ type: 'time', seconds: 90 }), '1 minute 30');
eq('under a minute', speakableLength({ type: 'time', seconds: 30 }), '30 seconds');
eq('short reps in meters', speakableLength({ type: 'distance', meters: 800 }), '800 meters');
eq('a mile', speakableLength({ type: 'distance', meters: MILE }), '1 mile');
eq('several miles', speakableLength({ type: 'distance', meters: 3 * MILE }), '3 miles');
eq('a 5K reads as a distance, not a readout', speakableLength({ type: 'distance', meters: 5000 }), '3.11 miles');

console.log('\n--- the instruction: what this is, how long, what to aim for ---');
{
  const on: SpokenSegment = {
    name: 'On 3', baseName: 'On', repeatIndex: 3, repeatTotal: 4,
    end: { type: 'time', seconds: 120 }, targetPaceSecPerMile: 450,
  };
  eq('name, length, goal', segmentInstruction(on), 'On number 3, 2 minutes, target 7 30');
  eq(
    'the goal is dropped once it has been said',
    segmentInstruction(on, { sayTarget: false }),
    'On number 3, 2 minutes',
  );
  eq(
    'no goal, no target clause',
    segmentInstruction({ name: 'Rest', end: { type: 'time', seconds: 30 } }),
    'Rest, 30 seconds',
  );
  // "800 meters number 2, 800 meters" is one fact read twice, at the moment
  // there is least room for it.
  eq(
    'a name that carries its own length does not repeat it',
    segmentInstruction({ name: '800m 2', baseName: '800m', repeatIndex: 2, end: { type: 'distance', meters: 800 } }),
    '800 meters number 2',
  );
  eq(
    'nor does one that names the unit in words',
    segmentInstruction({ name: 'Mile', end: { type: 'distance', meters: MILE } }),
    'Mile',
  );
  // The digit in "On number 2" belongs to the rep count, not the length, which
  // is why the test is made on the authored name.
  eq(
    'the rep index is not mistaken for a length',
    segmentInstruction({ name: 'On 2', baseName: 'On', repeatIndex: 2, end: { type: 'time', seconds: 120 } }),
    'On number 2, 2 minutes',
  );
  eq(
    'a session opens with the first instruction',
    startPhrases({ name: 'Warmup', end: { type: 'distance', meters: 2 * MILE }, targetPaceSecPerMile: 510 }).join(' | '),
    'Warmup, 2 miles, target 8 30',
  );
  eq('a free run opens with nothing', startPhrases(null).length, 0);
}

console.log('\n--- what gets said at a boundary ---');
{
  const rest2: SpokenSegment = {
    name: 'Rest 2', baseName: 'Rest', repeatIndex: 2, repeatTotal: 4,
    end: { type: 'time', seconds: 30 },
  };
  const tempo: SpokenSegment = {
    name: 'Tempo', end: { type: 'distance', meters: 3 * MILE }, targetPaceSecPerMile: 450,
  };
  const up = (seg: SpokenSegment, over: Partial<{ sayTarget: boolean; last: 'rep' | 'segment' | null }> = {}) =>
    ({ seg, sayTarget: true, last: null, ...over });

  // Inside a set the report of the rep just finished is dropped: on a 60s rep
  // it is still talking when the next rep has started, and the next rep is the
  // point. Only the new step is announced.
  eq(
    'a rep inside a set announces only what is next',
    boundaryPhrases({ durationMs: 60_000, paceSecPerMile: 450, inRepeat: true }, up(rest2)).join(' | '),
    'Rest number 2, 30 seconds',
  );
  eq(
    'a standalone step still reports its split first',
    boundaryPhrases({ durationMs: 600_000, paceSecPerMile: 480, inRepeat: false }, up(tempo)).join(' | '),
    '10 minutes, 8 flat pace | Tempo, 3 miles, target 7 30',
  );
  eq(
    'the goal is left unsaid when it has not changed',
    boundaryPhrases(null, up(tempo, { sayTarget: false })).join(' | '),
    'Tempo, 3 miles',
  );
  eq(
    'with no measurable pace it states the time alone',
    boundaryPhrases({ durationMs: 600_000, paceSecPerMile: null, inRepeat: false }, up(tempo)).join(' | '),
    '10 minutes | Tempo, 3 miles, target 7 30',
  );
  eq(
    'a free-run lap has nothing next, so it is just the split',
    boundaryPhrases({ durationMs: 300_000, paceSecPerMile: 450, inRepeat: false }, null).join(' | '),
    '5 minutes, 7 30 pace',
  );
  eq(
    'a mis-tap gets no eulogy',
    boundaryPhrases({ durationMs: 900, paceSecPerMile: 450, inRepeat: false }, up(tempo)).join(' | '),
    'Tempo, 3 miles, target 7 30',
  );
  eq(
    'the last segment of a set says nothing at all',
    boundaryPhrases({ durationMs: 60_000, paceSecPerMile: 450, inRepeat: true }, null).length,
    0,
  );

  // "Last one" changes how the rep is run, so it leads and stands alone — it
  // survives even if the rest of the phrase is cut off by the next thing.
  eq(
    'the last rep of a set is called',
    boundaryPhrases(null, up({ name: 'On 4', baseName: 'On', repeatIndex: 4, repeatTotal: 4, end: { type: 'time', seconds: 120 } }, { last: 'rep' })).join(' | '),
    'Last one | On number 4, 2 minutes',
  );
  eq(
    'and so is the last segment of the workout',
    boundaryPhrases(null, up({ name: 'Cooldown', end: { type: 'distance', meters: MILE } }, { last: 'segment' })).join(' | '),
    'Last segment | Cooldown, 1 mile',
  );

  // Coaching off is the older, barer behavior: the split, and the bare name.
  eq(
    'coaching off says only the split and the name',
    boundaryPhrases({ durationMs: 600_000, paceSecPerMile: 480, inRepeat: false }, up(tempo, { last: 'segment' }), false).join(' | '),
    '10 minutes, 8 flat pace | Tempo',
  );
}

console.log('\n--- the heads-up before a transition ---');
{
  // The beeps already mean "ten seconds"; the words are for what comes after.
  eq(
    'timed',
    nextUpPhrase('10 seconds', { name: 'Rest 2', baseName: 'Rest', repeatIndex: 2, end: { type: 'time', seconds: 30 } }),
    '10 seconds, then Rest number 2',
  );
  eq(
    'distance reps get one too, in their own unit',
    nextUpPhrase('200 meters', { name: 'Recovery', end: { type: 'distance', meters: 400 } }),
    '200 meters, then Recovery',
  );
  eq('nothing next means this is the end of it', nextUpPhrase('10 seconds', null), 'Last 10 seconds');
  eq('and in meters', nextUpPhrase('400 meters', null), 'Last 400 meters');
}

console.log('\n--- the halfway call, and the off-target correction ---');
{
  eq('halfway with a pace', halfwayPhrase(450), 'Halfway, 7 30 pace');
  // Invariant: if no pace may be stated, none is stated anywhere.
  eq('halfway without one states none', halfwayPhrase(null), 'Halfway');
  eq('too fast, and what to come back to', offTargetPhrase('fast', 450), 'Ease up, target 7 30');
  eq('too slow', offTargetPhrase('slow', 450), 'Pick it up, target 7 30');
  eq('with no target it is direction alone', offTargetPhrase('slow', null), 'Pick it up');
}

console.log('\n--- the end of the workout ---');
{
  // The last segment never auto-advances, so without this it simply stops
  // happening, silently.
  eq(
    'complete, with the summary and what to do',
    completionPhrases(1_440_000, 465).join(' | '),
    'Workout complete | 24 minutes, 7 45 pace | Tap finish',
  );
  eq(
    'indoors there is no pace to state',
    completionPhrases(1_440_000, null).join(' | '),
    'Workout complete | 24 minutes | Tap finish',
  );
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
