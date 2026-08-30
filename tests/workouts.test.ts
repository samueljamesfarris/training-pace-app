import {
  blankWorkout,
  clonePlan,
  coalesceBlocks,
  copyWorkout,
  endLabel,
  inferPlan,
  isDefaultSegmentName,
  isLadder,
  MILE,
  plannedMeters,
  plannedSeconds,
  planToBlocks,
  PRESET_WORKOUTS,
  resolveWorkout,
  workoutFromPlan,
  type SegmentDef,
  type WorkoutBlock,
  type WorkoutDef,
  type WorkoutPlan,
} from '../src/lib/workouts.ts';

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

console.log('--- resolveWorkout: every preset flattens to the expected shape ---');
for (const w of PRESET_WORKOUTS) {
  // A block that drops its final step contributes one segment fewer, and only
  // ever one — the last step of the last round.
  const dropped = (b: WorkoutBlock) => (b.dropFinalStep && b.segments.length > 1 ? 1 : 0);
  const expected = w.blocks.reduce(
    (n, b) => n + Math.max(1, b.repeat) * b.segments.length - dropped(b),
    0,
  );
  const segs = resolveWorkout(w).segments;
  eq(`${w.id} segment count`, segs.length, expected);

  // Order: walking the blocks by hand must reproduce the flat list exactly.
  const byHand: string[] = [];
  for (const b of w.blocks) {
    const times = Math.max(1, b.repeat);
    for (let i = 1; i <= times; i++) {
      const steps = i === times ? b.segments.length - dropped(b) : b.segments.length;
      for (const s of b.segments.slice(0, steps)) {
        byHand.push(times > 1 ? `${s.name} ${i}` : s.name);
      }
    }
  }
  eq(`${w.id} order`, segs.map((s) => s.name).join('|'), byHand.join('|'));
}

console.log('\n--- the index suffix appears only when a block actually repeats ---');
{
  const repeated = PRESET_WORKOUTS.find((w) => w.id === 'on-off-2min-30s-x4')!;
  const names = resolveWorkout(repeated).segments.map((s) => s.name);
  eq('4x block numbers its segments', names.slice(0, 4).join(','), 'On 1,Rest 1,On 2,Rest 2');
  // The set drops its closing rest, so the workout ends on the fourth rep.
  eq('last round is numbered too', names[names.length - 1], 'On 4');

  const single = PRESET_WORKOUTS.find((w) => w.id === 'tempo-2-3-1')!;
  const plain = resolveWorkout(single).segments.map((s) => s.name);
  eq('repeat-1 blocks are left unnumbered', plain.join(','), 'Warmup,Tempo,Cooldown');

  const ladder = PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!;
  const rungs = resolveWorkout(ladder).segments;
  eq('ladder resolves to nine steps', rungs.length, 9);
  ok('no ladder step is numbered', rungs.every((s) => !/ \d+$/.test(s.name)),
     rungs.map((s) => s.name).join(','));
}

console.log('\n--- resolveWorkout carries id and name, and copies segments ---');
{
  const w = PRESET_WORKOUTS[0]!;
  const r = resolveWorkout(w);
  eq('id preserved', r.id, w.id);
  eq('name preserved', r.name, w.name);
  const first = r.segments[0]!;
  first.name = 'mutated';
  ok('resolved segments are copies, not the authored objects',
     w.blocks[0]!.segments[0]!.name !== 'mutated', w.blocks[0]!.segments[0]!.name);
}

console.log('\n--- plannedSeconds ---');
{
  const timed = resolveWorkout(PRESET_WORKOUTS.find((w) => w.id === 'on-off-2min-30s-x4')!).segments;
  eq('all-timed workout totals its seconds', plannedSeconds(timed), 4 * 120 + 3 * 30);

  const mixed = resolveWorkout(PRESET_WORKOUTS.find((w) => w.id === 'repeats-mile-x4')!).segments;
  eq('one distance segment makes the total unknowable', plannedSeconds(mixed), null);

  const allDistance = resolveWorkout(PRESET_WORKOUTS.find((w) => w.id === 'repeats-800-x6')!).segments;
  eq('all-distance workout is null too', plannedSeconds(allDistance), null);

  eq('an empty list totals zero', plannedSeconds([]), 0);
}

console.log('\n--- plannedMeters counts distance segments only ---');
{
  const mixed: SegmentDef[] = [
    { name: 'a', kind: 'work', end: { type: 'distance', meters: 800 } },
    { name: 'b', kind: 'recovery', end: { type: 'time', seconds: 180 } },
    { name: 'c', kind: 'work', end: { type: 'distance', meters: 400 } },
  ];
  eq('timed segments contribute nothing', plannedMeters(mixed), 1200);
  eq('an all-timed workout measures zero meters', plannedMeters([mixed[1]!]), 0);

  const miles = resolveWorkout(PRESET_WORKOUTS.find((w) => w.id === 'tempo-2-3-1')!).segments;
  eq('tempo totals six miles', Math.round(plannedMeters(miles)), Math.round(6 * MILE));
}

console.log('\n--- copyWorkout is a deep copy under a new identity ---');
{
  const original = PRESET_WORKOUTS.find((w) => w.id === 'on-off-2min-30s-x4')!;
  const before = JSON.stringify(original);
  const copy = copyWorkout(original);

  ok('new id', copy.id !== original.id, `${copy.id} vs ${original.id}`);
  eq('builtIn cleared', copy.builtIn, false);
  ok('name marks it as a copy', copy.name.startsWith(original.name), copy.name);
  eq('custom name is honoured', copyWorkout(original, 'My version').name, 'My version');

  // Every level has to be a fresh object, or editing the copy reaches back.
  copy.name = 'edited';
  copy.blocks[0]!.repeat = 9;
  copy.blocks[0]!.segments[0]!.name = 'edited segment';
  copy.blocks[0]!.segments[0]!.end = { type: 'distance', meters: 5 };
  copy.blocks.push({ id: 'extra', repeat: 1, segments: [] });

  eq('the original is untouched', JSON.stringify(original), before);
  eq('and still resolves as before', resolveWorkout(original).segments.length, 7);
  // Nine rounds of two, less the closing rest the block still drops.
  eq('while the copy reflects its edits', resolveWorkout(copy).segments.length, 17);
}

console.log('\n--- a workout with no blocks resolves to nothing, not a crash ---');
{
  const empty: WorkoutDef = { id: 'e', name: 'Empty', blocks: [] };
  eq('no segments', resolveWorkout(empty).segments.length, 0);
  eq('no planned time', plannedSeconds(resolveWorkout(empty).segments), 0);
  eq('no planned distance', plannedMeters(resolveWorkout(empty).segments), 0);
}

console.log('\n--- coalesceBlocks: adjacent steps merge, sets never do ---');
{
  const step = (name: string) => ({
    id: `b-${name}`,
    repeat: 1,
    segments: [{ name, kind: 'work' as const, end: { type: 'time' as const, seconds: 60 } }],
  });
  const set = (name: string, repeat: number) => ({
    id: `b-${name}`,
    repeat,
    segments: [
      { name, kind: 'work' as const, end: { type: 'time' as const, seconds: 120 } },
      { name: `${name} rest`, kind: 'recovery' as const, end: { type: 'time' as const, seconds: 30 } },
    ],
  });

  eq('two adjacent steps become one block', coalesceBlocks([step('a'), step('b')]).length, 1);
  eq('and keep both segments in order',
     coalesceBlocks([step('a'), step('b')])[0]!.segments.map((x) => x.name).join(','), 'a,b');
  eq('three adjacent steps collapse too', coalesceBlocks([step('a'), step('b'), step('c')]).length, 1);

  eq('a set is never merged into a step', coalesceBlocks([step('a'), set('s', 4)]).length, 2);
  eq('nor a step into a set', coalesceBlocks([set('s', 4), step('a')]).length, 2);
  eq('nor two sets together', coalesceBlocks([set('s', 2), set('t', 3)]).length, 2);
  eq('a set between steps keeps them apart',
     coalesceBlocks([step('a'), set('s', 2), step('b')]).length, 3);

  eq('empty blocks are dropped',
     coalesceBlocks([{ id: 'x', repeat: 1, segments: [] }, step('a')]).length, 1);
  eq('coalescing nothing is nothing', coalesceBlocks([]).length, 0);

  // The whole point: this must be invisible to the engine.
  const cases = [
    [step('a'), step('b'), set('s', 3), step('c'), step('d')],
    [set('s', 2), step('a'), step('b'), set('t', 4)],
    ...PRESET_WORKOUTS.map((w) => w.blocks),
  ];
  let identical = 0;
  for (const blocks of cases) {
    const before = resolveWorkout({ id: 'x', name: 'x', blocks });
    const after = resolveWorkout({ id: 'x', name: 'x', blocks: coalesceBlocks(blocks) });
    if (JSON.stringify(before.segments) === JSON.stringify(after.segments)) identical++;
  }
  eq('resolveWorkout output is unchanged by coalescing', identical, cases.length);

  // A repeat-1 block's segments are never renamed, so merging cannot alter them.
  const merged = coalesceBlocks([step('Warmup'), step('Cooldown')]);
  eq('merged step names stay bare',
     resolveWorkout({ id: 'x', name: 'x', blocks: merged }).segments.map((x) => x.name).join(','),
     'Warmup,Cooldown');
}

console.log('\n--- dropFinalStep trims one step, from the last round only ---');
{
  const set = (dropFinalStep: boolean): WorkoutBlock => ({
    id: 'b',
    repeat: 3,
    dropFinalStep,
    segments: [
      { name: 'On', kind: 'work', end: { type: 'time', seconds: 60 } },
      { name: 'Rest', kind: 'recovery', end: { type: 'time', seconds: 30 } },
    ],
  });
  const names = (b: WorkoutBlock) =>
    resolveWorkout({ id: 'x', name: 'x', blocks: [b] }).segments.map((s) => s.name).join(',');

  eq('without the flag every round is whole', names(set(false)),
     'On 1,Rest 1,On 2,Rest 2,On 3,Rest 3');
  eq('with it only the last round loses its rest', names(set(true)),
     'On 1,Rest 1,On 2,Rest 2,On 3');

  // The whole reason the flag exists rather than a split block.
  const last = resolveWorkout({ id: 'x', name: 'x', blocks: [set(true)] }).segments.at(-1)!;
  eq('the final rep keeps its round number', last.repeatIndex, 3);
  eq('and its round total', last.repeatTotal, 3);
  eq('and its base name, so the voice still says it', last.baseName, 'On');

  const lone: WorkoutBlock = {
    id: 'b', repeat: 2, dropFinalStep: true,
    segments: [{ name: 'Only', kind: 'work', end: { type: 'time', seconds: 60 } }],
  };
  eq('a one-step block is never emptied', names(lone), 'Only 1,Only 2');
}

console.log('\n--- coalesceBlocks leaves a dropping block alone ---');
{
  const step = (name: string): WorkoutBlock => ({
    id: `b-${name}`, repeat: 1,
    segments: [{ name, kind: 'work', end: { type: 'time', seconds: 60 } }],
  });
  const dropping: WorkoutBlock = {
    id: 'b-d', repeat: 1, dropFinalStep: true,
    segments: [
      { name: 'x', kind: 'work', end: { type: 'time', seconds: 60 } },
      { name: 'y', kind: 'recovery', end: { type: 'time', seconds: 30 } },
    ],
  };
  eq('nothing merges into it', coalesceBlocks([dropping, step('a')]).length, 2);
  eq('nor it into anything', coalesceBlocks([step('a'), dropping]).length, 2);
  // Merging would have moved the flag onto somebody else's last step.
  eq('so the right step is dropped',
     resolveWorkout({ id: 'x', name: 'x', blocks: coalesceBlocks([dropping, step('a')]) })
       .segments.map((s) => s.name).join(','),
     'x,a');
}

console.log('\n--- endLabel and isDefaultSegmentName ---');
{
  eq('meters sit against their unit', endLabel({ type: 'distance', meters: 400 }), '400m');
  eq('a mile drops its trailing zeros', endLabel({ type: 'distance', meters: MILE }), '1 mi');
  eq('and a half mile keeps what it needs',
     endLabel({ type: 'distance', meters: 1.5 * MILE }), '1.5 mi');
  eq('time reads as a clock', endLabel({ type: 'time', seconds: 120 }), '2:00');

  ok('blank counts as a default', isDefaultSegmentName(''));
  ok('the shouted spelling counts', isDefaultSegmentName('WORK'));
  ok('so does the title-case one', isDefaultSegmentName('Cooldown'));
  ok('a typed name does not', !isDefaultSegmentName('800m'));
  ok('nor one that merely contains a default', !isDefaultSegmentName('Work hard'));
}

console.log('\n--- planToBlocks: a uniform set stays one block ---');
{
  const plan: WorkoutPlan = {
    warmup: { name: 'Warmup', kind: 'warmup', end: { type: 'distance', meters: MILE } },
    main: {
      kind: 'repeat',
      rounds: 3,
      dropFinalRecovery: false,
      steps: [
        { name: 'Rep', kind: 'work', end: { type: 'distance', meters: 800 } },
        { name: 'Jog', kind: 'recovery', end: { type: 'time', seconds: 120 } },
      ],
    },
    cooldown: { name: 'Cooldown', kind: 'cooldown', end: { type: 'distance', meters: MILE } },
  };
  const blocks = planToBlocks(plan);
  eq('warmup, set, cooldown', blocks.length, 3);
  eq('the set is one repeating block', blocks[1]!.repeat, 3);
  ok('and is not a ladder', !isLadder(plan.main));

  const names = resolveWorkout({ id: 'x', name: 'x', blocks }).segments.map((s) => s.name);
  eq('rounds are numbered', names.join(','),
     'Warmup,Rep 1,Jog 1,Rep 2,Jog 2,Rep 3,Jog 3,Cooldown');

  const trimmed = planToBlocks({
    ...plan,
    main: { ...plan.main, dropFinalRecovery: true } as WorkoutPlan['main'],
  });
  eq('dropping the last recovery goes straight to the cooldown',
     resolveWorkout({ id: 'x', name: 'x', blocks: trimmed }).segments.map((s) => s.name).join(','),
     'Warmup,Rep 1,Jog 1,Rep 2,Jog 2,Rep 3,Cooldown');

  // Authoring-only fields must not reach the engine.
  const laddered = planToBlocks({
    ...plan,
    main: {
      kind: 'repeat', rounds: 2, dropFinalRecovery: false,
      steps: [
        { name: '', kind: 'work', end: { type: 'distance', meters: 400 },
          perRound: [{ type: 'distance', meters: 400 }, { type: 'distance', meters: 800 }] },
        { name: 'Recovery', kind: 'recovery', end: { type: 'distance', meters: 400 },
          matchPrevious: true },
      ],
    },
  });
  const raw = JSON.stringify(laddered);
  ok('perRound never reaches a block', !raw.includes('perRound'), raw);
  ok('nor does matchPrevious', !raw.includes('matchPrevious'), raw);
}

console.log('\n--- planToBlocks: a ladder varies its rungs ---');
{
  const rungs = [400, 800, 1200, 800, 400];
  const plan: WorkoutPlan = {
    warmup: null,
    cooldown: null,
    main: {
      kind: 'repeat',
      rounds: rungs.length,
      dropFinalRecovery: true,
      steps: [
        {
          name: '',
          kind: 'work',
          end: { type: 'distance', meters: rungs[0]! },
          perRound: rungs.map((m) => ({ type: 'distance' as const, meters: m })),
        },
        {
          name: 'Recovery',
          kind: 'recovery',
          end: { type: 'distance', meters: 400 },
          matchPrevious: true,
        },
      ],
    },
  };
  ok('this one is a ladder', isLadder(plan.main));

  const segs = resolveWorkout({ id: 'x', name: 'x', blocks: planToBlocks(plan) }).segments;
  eq('nine steps, the closing recovery dropped', segs.length, 9);
  eq('a nameless varying step is named for its rung',
     segs.map((s) => s.name).join(','),
     '400m,Recovery,800m,Recovery,1200m,Recovery,800m,Recovery,400m');
  eq('the recovery mirrors the rung above it',
     segs.filter((s) => s.kind === 'recovery')
       .map((s) => (s.end.type === 'distance' ? s.end.meters : -1)).join(','),
     '400,800,1200,800');
  ok('no rung is numbered', segs.every((s) => !/ \d+$/.test(s.name)),
     segs.map((s) => s.name).join(','));

  // A name the athlete typed survives every round, unchanged.
  const named = planToBlocks({
    ...plan,
    main: {
      ...plan.main,
      steps: [{ ...(plan.main as { steps: SegmentDef[] }).steps[0]!, name: 'Rung' },
              (plan.main as { steps: SegmentDef[] }).steps[1]!],
    } as WorkoutPlan['main'],
  });
  const namedSegs = resolveWorkout({ id: 'x', name: 'x', blocks: named }).segments;
  ok('a typed name is never replaced by a rung label',
     namedSegs.filter((s) => s.kind === 'work').every((s) => s.name === 'Rung'),
     namedSegs.map((s) => s.name).join(','));
}

console.log('\n--- the ladder preset compiles to exactly what it always was ---');
{
  const ladder = PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!;
  const segs = resolveWorkout(ladder).segments;
  eq('names', segs.map((s) => s.name).join(','),
     '400m,Recovery,800m,Recovery,1200m,Recovery,800m,Recovery,400m');
  eq('distances',
     segs.map((s) => (s.end.type === 'distance' ? Math.round(s.end.meters) : -1)).join(','),
     '400,400,800,800,1200,1200,800,800,400');
}

console.log('\n--- every preset carries a plan that compiles back to its blocks ---');
{
  for (const w of PRESET_WORKOUTS) {
    ok(`${w.id} has a plan`, w.plan != null);
    if (!w.plan) continue;
    eq(`${w.id} plan compiles to its own blocks`,
       JSON.stringify(planToBlocks(w.plan).map((b) => ({ ...b, id: '' }))),
       JSON.stringify(w.blocks.map((b) => ({ ...b, id: '' }))));
  }
}

console.log('\n--- inferPlan reads plain blocks back as a structure ---');
{
  const seg = (name: string, kind: SegmentDef['kind'], seconds: number): SegmentDef => ({
    name, kind, end: { type: 'time', seconds },
  });

  const tempo = inferPlan([
    { id: 'b', repeat: 1, segments: [
      seg('Warmup', 'warmup', 600), seg('Tempo', 'work', 1200), seg('Cooldown', 'cooldown', 300),
    ] },
  ]);
  ok('warmup / steady / cooldown is recognised', tempo != null);
  eq('warmup peeled off the front', tempo?.warmup?.name, 'Warmup');
  eq('cooldown off the back', tempo?.cooldown?.name, 'Cooldown');
  eq('the middle is one steady piece', tempo?.main.kind, 'steady');

  const reps = inferPlan([
    { id: 'a', repeat: 1, segments: [seg('Warmup', 'warmup', 600)] },
    { id: 'b', repeat: 5, dropFinalStep: true, segments: [
      seg('On', 'work', 60), seg('Off', 'recovery', 60),
    ] },
  ]);
  eq('a repeating block is the main set', reps?.main.kind, 'repeat');
  eq('with its rounds', reps?.main.kind === 'repeat' ? reps.main.rounds : 0, 5);
  ok('and its dropped recovery',
     reps?.main.kind === 'repeat' && reps.main.dropFinalRecovery === true);
  eq('the cooldown stays absent rather than invented', reps?.cooldown, null);

  ok('two sets are not a structure this builder can say',
     inferPlan([
       { id: 'a', repeat: 3, segments: [seg('On', 'work', 60)] },
       { id: 'b', repeat: 4, segments: [seg('Fast', 'work', 30)] },
     ]) === null);
  ok('nor is a bare list of unlike steps',
     inferPlan([
       { id: 'a', repeat: 1, segments: [seg('One', 'work', 60), seg('Two', 'work', 60)] },
     ]) === null);
  ok('nor nothing at all', inferPlan([]) === null);
  ok('nor a warmup with no main', inferPlan([
    { id: 'a', repeat: 1, segments: [seg('Warmup', 'warmup', 600)] },
  ]) === null);

  // Inference must never change the workout it was asked about.
  const blocks: WorkoutBlock[] = [
    { id: 'a', repeat: 1, segments: [seg('Warmup', 'warmup', 600)] },
    { id: 'b', repeat: 4, segments: [seg('On', 'work', 60), seg('Off', 'recovery', 60)] },
  ];
  const untouched = JSON.stringify(blocks);
  const plan = inferPlan(blocks)!;
  eq('the blocks it read are unmodified', JSON.stringify(blocks), untouched);
  eq('and it round-trips to the same segments',
     JSON.stringify(resolveWorkout({ id: 'x', name: 'x', blocks: planToBlocks(plan) }).segments),
     JSON.stringify(resolveWorkout({ id: 'x', name: 'x', blocks }).segments));
}

console.log('\n--- a plan travels with a copy, and never shares its objects ---');
{
  const preset = PRESET_WORKOUTS.find((w) => w.id === 'repeats-800-x6')!;
  const copy = copyWorkout(preset);
  ok('the copy has a plan of its own', copy.plan != null);

  const before = JSON.stringify(preset.plan);
  if (copy.plan?.main.kind === 'repeat') {
    copy.plan.main.rounds = 99;
    copy.plan.main.steps[0]!.name = 'edited';
    copy.plan.main.steps[0]!.end = { type: 'time', seconds: 1 };
  }
  eq("editing the copy's plan leaves the preset alone", JSON.stringify(preset.plan), before);

  const cloned = clonePlan(PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!.plan!);
  if (cloned.main.kind === 'repeat') {
    cloned.main.steps[0]!.perRound![0] = { type: 'distance', meters: 1 };
    cloned.main.steps[1]!.matchPrevious = false;
  }
  eq('and a cloned ladder is deep too',
     JSON.stringify(PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!.plan),
     JSON.stringify(PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!.plan));
  ok('the clone changed and the preset did not',
     PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!.plan!.main.kind === 'repeat' &&
     (PRESET_WORKOUTS.find((w) => w.id === 'ladder-400-1200-400')!.plan!.main as {
        steps: { perRound?: { type: string; meters?: number }[] }[];
      }).steps[0]!.perRound![0]!.meters === 400);
}

console.log('\n--- a new workout starts as a shape, not an empty list ---');
{
  const w = blankWorkout();
  ok('it has a plan', w.plan != null);
  eq('with a warmup', w.plan?.warmup?.kind, 'warmup');
  eq('a set in the middle', w.plan?.main.kind, 'repeat');
  eq('and a cooldown', w.plan?.cooldown?.kind, 'cooldown');
  ok('its blocks are already compiled', w.blocks.length > 0);
  eq('and match the plan',
     JSON.stringify(resolveWorkout(w).segments.map((s) => s.name)),
     JSON.stringify(
       resolveWorkout({ ...w, blocks: planToBlocks(w.plan!) }).segments.map((s) => s.name),
     ));

  const named = workoutFromPlan(w.plan!, 'Named');
  eq('workoutFromPlan takes the name given', named.name, 'Named');
  ok('and mints its own id', named.id !== w.id);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
