import {
  coalesceBlocks,
  copyWorkout,
  MILE,
  plannedMeters,
  plannedSeconds,
  PRESET_WORKOUTS,
  resolveWorkout,
  type SegmentDef,
  type WorkoutDef,
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
  const expected = w.blocks.reduce((n, b) => n + Math.max(1, b.repeat) * b.segments.length, 0);
  const segs = resolveWorkout(w).segments;
  eq(`${w.id} segment count`, segs.length, expected);

  // Order: walking the blocks by hand must reproduce the flat list exactly.
  const byHand: string[] = [];
  for (const b of w.blocks) {
    const times = Math.max(1, b.repeat);
    for (let i = 1; i <= times; i++) {
      for (const s of b.segments) byHand.push(times > 1 ? `${s.name} ${i}` : s.name);
    }
  }
  eq(`${w.id} order`, segs.map((s) => s.name).join('|'), byHand.join('|'));
}

console.log('\n--- the index suffix appears only when a block actually repeats ---');
{
  const repeated = PRESET_WORKOUTS.find((w) => w.id === 'on-off-2min-30s-x4')!;
  const names = resolveWorkout(repeated).segments.map((s) => s.name);
  eq('4x block numbers its segments', names.slice(0, 4).join(','), 'On 1,Rest 1,On 2,Rest 2');
  eq('last round is numbered too', names[names.length - 1], 'Rest 4');

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
  eq('all-timed workout totals its seconds', plannedSeconds(timed), 4 * (120 + 30));

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
  eq('an all-timed workout measures zero metres', plannedMeters([mixed[1]!]), 0);

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
  eq('and still resolves as before', resolveWorkout(original).segments.length, 8);
  eq('while the copy reflects its edits', resolveWorkout(copy).segments.length, 18);
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

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
