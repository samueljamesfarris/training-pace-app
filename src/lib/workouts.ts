import { formatClock } from './units';

export type SegmentKind = 'work' | 'recovery' | 'warmup' | 'cooldown';

export type EndCondition =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number };

export interface SegmentDef {
  name: string;
  kind: SegmentKind;
  end: EndCondition;
  /**
   * Which round of a repeat group this segment is, 1-based, and how many there
   * are. Written by `resolveWorkout`, never authored and never stored in a
   * workout — the builder edits blocks, and the repeat lives on the block.
   *
   * It exists because a rep inside a set is spoken differently from a step
   * that stands alone: "Rest number 2" rather than "Rest 2", and no report of
   * the rep that just ended, which on a 60-second rep is still talking when
   * the next one starts. Absent on segments resolved before this existed, so
   * an older session simply keeps the old wording.
   */
  repeatIndex?: number;
  repeatTotal?: number;
  /** The name without the index, for saying it out loud. */
  baseName?: string;
  /**
   * Optional goal pace in seconds per mile. Optional on purpose: it is absent
   * from every workout already stored in IndexedDB, and an optional field costs
   * no migration. The tolerance around it is a single setting rather than a
   * per-segment value — one band, adjustable once.
   */
  targetPaceSecPerMile?: number;
}

/**
 * A block is one repeat group: `repeat` × the segments inside it. Authoring
 * happens in blocks; the session engine never sees them.
 */
export interface WorkoutBlock {
  id: string;
  repeat: number;
  segments: SegmentDef[];
  /**
   * Drop the block's last step on its last round only.
   *
   * A set that ends on a recovery leaves the athlete jogging a recovery
   * nobody is recovering for — straight into the cooldown, or into nothing at
   * all. Splitting the set into `n-1` rounds plus a short one would say the
   * same thing, but it renumbers the final rep as "On" instead of "On 6" and
   * the voice loses "number 6" with it. So the set stays whole and the flag
   * rides on the block.
   *
   * Never drops the only step in a block: a set has to resolve to something.
   */
  dropFinalStep?: boolean;
}

/**
 * One step inside a repeat set, as authored.
 *
 * The two extra fields are what make a ladder a single set rather than five
 * blocks that only look like one: `perRound` gives the step a different end
 * condition each time around, and `matchPrevious` is the recovery that mirrors
 * whatever rep it follows. Both are authoring concepts — `planToBlocks`
 * resolves them away, and the engine never sees either.
 */
export interface RepeatStep extends SegmentDef {
  /** This step's end condition, round by round. Length must equal `rounds`. */
  perRound?: EndCondition[];
  /** Take the preceding step's resolved end condition for this round. */
  matchPrevious?: boolean;
}

/**
 * The middle of a workout: either one steady piece, or one set of reps.
 *
 * Deliberately one thing rather than a list. A workout that wants two
 * different sets is authored in the advanced editor, which still edits blocks
 * directly — the structure is the common path, not a cage.
 */
export type MainSection =
  | { kind: 'steady'; segment: SegmentDef }
  | {
      kind: 'repeat';
      rounds: number;
      steps: RepeatStep[];
      /** Skip the closing recovery on the final round. */
      dropFinalRecovery: boolean;
    };

/**
 * A workout as the structured builder sees it: warm up, the main set, cool
 * down. Warmup and cooldown are nullable because plenty of sessions genuinely
 * have neither — the structure is a shape to fill in, not a requirement.
 *
 * This is an authoring form only. `planToBlocks` compiles it to the blocks
 * that everything else in the app already understands, so nothing downstream
 * — the engine, history, share links, stored sessions — knows plans exist.
 */
export interface WorkoutPlan {
  warmup: SegmentDef | null;
  main: MainSection;
  cooldown: SegmentDef | null;
}

/** The editable, stored form of a workout. */
export interface WorkoutDef {
  id: string;
  name: string;
  blocks: WorkoutBlock[];
  /**
   * The structured form, when this workout has one.
   *
   * `blocks` stays the source of truth: it is what `resolveWorkout` walks,
   * what IndexedDB already holds, and what a share link has always carried.
   * The plan is an editing convenience layered on top, recompiled to blocks on
   * every save. Optional on purpose — every workout stored before this existed
   * simply has none, and opens in the advanced editor instead of a migration.
   */
  plan?: WorkoutPlan;
  /** Presets can't be edited or deleted, only duplicated. */
  builtIn?: boolean;
  updatedAt?: number;
}

/** The flat form the session engine walks. */
export interface ResolvedWorkout {
  id: string;
  name: string;
  segments: SegmentDef[];
}

export const MILE = 1609.344;

/**
 * Flatten repeat groups into a linear segment list. Done once, when the workout
 * loads, which is what keeps auto-advance, resume-after-reload and the segment
 * list simple — they only ever index into an array.
 */
export function resolveWorkout(w: WorkoutDef): ResolvedWorkout {
  const segments: SegmentDef[] = [];
  for (const b of w.blocks) {
    const times = Math.max(1, Math.floor(b.repeat));
    for (let i = 1; i <= times; i++) {
      // The closing recovery is dropped from the last round only, and never
      // when it is the block's only step — a set has to resolve to something.
      const steps =
        i === times && b.dropFinalStep && b.segments.length > 1
          ? b.segments.length - 1
          : b.segments.length;
      for (let si = 0; si < steps; si++) {
        const s = b.segments[si]!;
        // The displayed name is unchanged — "Rest 2" on screen, as before.
        // The parts are carried alongside it for the voice to use.
        segments.push(
          times > 1
            ? {
                ...s,
                name: `${s.name} ${i}`,
                baseName: s.name,
                repeatIndex: i,
                repeatTotal: times,
              }
            : { ...s },
        );
      }
    }
  }
  return { id: w.id, name: w.name, segments };
}

/** Total planned time, or null when any segment is distance-driven. */
export function plannedSeconds(segments: SegmentDef[]): number | null {
  let total = 0;
  for (const s of segments) {
    if (s.end.type !== 'time') return null;
    total += s.end.seconds;
  }
  return total;
}

/** Total planned distance in meters, counting only distance segments. */
export function plannedMeters(segments: SegmentDef[]): number {
  return segments.reduce((a, s) => a + (s.end.type === 'distance' ? s.end.meters : 0), 0);
}

export const KIND_LABEL: Record<SegmentKind, string> = {
  work: 'WORK',
  recovery: 'RECOVERY',
  warmup: 'WARMUP',
  cooldown: 'COOLDOWN',
};

export const KINDS: SegmentKind[] = ['work', 'recovery', 'warmup', 'cooldown'];

/**
 * What a segment of each kind is called before anybody names it.
 *
 * Title case, not the shouted `KIND_LABEL`: this one is read aloud and shown
 * in a name field, where "WARMUP" looked like a placeholder nobody was meant
 * to keep.
 */
export const KIND_DEFAULT_NAME: Record<SegmentKind, string> = {
  work: 'Work',
  recovery: 'Recovery',
  warmup: 'Warmup',
  cooldown: 'Cooldown',
};

/**
 * True when a name is still whatever the app supplied, so replacing it is
 * safe. A name the athlete typed is his, and nothing may quietly overwrite it.
 *
 * Case-insensitive because both spellings have shipped: the old builder seeded
 * a new segment with `KIND_LABEL` ("WORK"), the structured one uses
 * `KIND_DEFAULT_NAME` ("Work"), and a workout saved under either is still
 * carrying a default.
 */
export function isDefaultSegmentName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  return KINDS.some((k) => KIND_DEFAULT_NAME[k].toLowerCase() === n);
}

/**
 * An end condition as a short label — "400m", "1.5 mi", "2:00".
 *
 * Used for names, so meters are tight against their unit: a ladder rung is
 * called "400m", not "400 m". Miles drop trailing zeros for the same reason,
 * so a mile rep reads "1 mi" rather than "1.00 mi".
 */
export function endLabel(end: EndCondition): string {
  if (end.type === 'time') return formatClock(end.seconds * 1000);
  return end.meters >= MILE
    ? `${+(end.meters / MILE).toFixed(2)} mi`
    : `${Math.round(end.meters)}m`;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function block(repeat: number, segments: SegmentDef[]): WorkoutBlock {
  return { id: newId('b'), repeat, segments };
}

/* ------------------------------------------------------------------------- *
 * Plans, and the one-way trip down to blocks.
 * ------------------------------------------------------------------------- */

function cloneSegment(s: SegmentDef): SegmentDef {
  return { ...s, end: { ...s.end } };
}

/** A step with its authoring-only fields removed, ready to be a segment. */
function plainStep(s: RepeatStep): SegmentDef {
  const { perRound: _perRound, matchPrevious: _matchPrevious, ...rest } = s;
  return cloneSegment(rest);
}

/** True when the set's rounds differ from one another. */
export function isLadder(main: MainSection): boolean {
  if (main.kind !== 'repeat') return false;
  return main.steps.some((s) => (s.perRound && s.perRound.length > 0) || s.matchPrevious);
}

/** One step's end condition on a given round, zero-based. */
function roundEnd(
  step: RepeatStep,
  round: number,
  previous: EndCondition | null,
): EndCondition {
  if (step.matchPrevious && previous) return { ...previous };
  const per = step.perRound?.[round];
  if (per) return { ...per };
  return { ...step.end };
}

/**
 * Compile a plan into blocks.
 *
 * A uniform set stays one block, so the flat segments keep their round numbers
 * and the voice keeps saying "number 3". A ladder can't: its rounds differ, so
 * it becomes one repeat-1 block per round, which `coalesceBlocks` then folds
 * into a single run of steps — exactly the shape the ladder preset has always
 * had.
 */
export function planToBlocks(plan: WorkoutPlan): WorkoutBlock[] {
  const blocks: WorkoutBlock[] = [];
  if (plan.warmup) blocks.push(block(1, [cloneSegment(plan.warmup)]));

  const main = plan.main;
  if (main.kind === 'steady') {
    blocks.push(block(1, [cloneSegment(main.segment)]));
  } else if (main.steps.length > 0) {
    const rounds = Math.max(1, Math.floor(main.rounds));
    const drop = main.dropFinalRecovery && main.steps.length > 1;

    if (!isLadder(main)) {
      const b = block(rounds, main.steps.map(plainStep));
      blocks.push(drop ? { ...b, dropFinalStep: true } : b);
    } else {
      for (let r = 0; r < rounds; r++) {
        const segments: SegmentDef[] = [];
        let previous: EndCondition | null = null;
        for (const step of main.steps) {
          const end = roundEnd(step, r, previous);
          previous = end;
          segments.push({
            ...plainStep(step),
            // Only a step that actually varies is named for its round. A
            // recovery mirroring the rep above it stays "Recovery" — calling
            // every rung's recovery "1200m" said nothing the countdown wasn't
            // already saying.
            name:
              step.perRound && isDefaultSegmentName(step.name)
                ? endLabel(end)
                : step.name,
            end,
          });
        }
        if (drop && r === rounds - 1) segments.pop();
        if (segments.length > 0) blocks.push(block(1, segments));
      }
    }
  }

  if (plan.cooldown) blocks.push(block(1, [cloneSegment(plan.cooldown)]));
  return coalesceBlocks(blocks);
}

/**
 * Read blocks back as a plan, or say they aren't one.
 *
 * Used for workouts that predate plans and for imported links that carry none.
 * Deliberately strict: a null answer sends the workout to the advanced editor,
 * which is a fine place for it, whereas a loose guess would quietly restructure
 * something that already ran. Nothing here rewrites the workout — the blocks
 * are untouched until a save actually happens.
 */
export function inferPlan(blocks: WorkoutBlock[]): WorkoutPlan | null {
  const rest = coalesceBlocks(blocks).map((b) => ({
    ...b,
    segments: b.segments.map(cloneSegment),
  }));
  if (rest.length === 0) return null;

  let warmup: SegmentDef | null = null;
  let cooldown: SegmentDef | null = null;

  const first = rest[0]!;
  if (first.repeat === 1 && !first.dropFinalStep && first.segments[0]?.kind === 'warmup') {
    warmup = first.segments.shift()!;
    if (first.segments.length === 0) rest.shift();
  }

  const last = rest[rest.length - 1];
  if (
    last &&
    last.repeat === 1 &&
    !last.dropFinalStep &&
    last.segments[last.segments.length - 1]?.kind === 'cooldown'
  ) {
    cooldown = last.segments.pop()!;
    if (last.segments.length === 0) rest.pop();
  }

  // Whatever is left has to be exactly one main section.
  if (rest.length !== 1) return null;
  const main = rest[0]!;
  if (main.repeat > 1) {
    return {
      warmup,
      cooldown,
      main: {
        kind: 'repeat',
        rounds: main.repeat,
        steps: main.segments,
        dropFinalRecovery: main.dropFinalStep === true,
      },
    };
  }
  if (main.segments.length === 1) {
    return { warmup, cooldown, main: { kind: 'steady', segment: main.segments[0]! } };
  }
  return null;
}

function sameEnd(a: EndCondition, b: EndCondition): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'time'
    ? a.seconds === (b as { seconds: number }).seconds
    : a.meters === (b as { meters: number }).meters;
}

function sameSegment(a: SegmentDef | null, b: SegmentDef | null): boolean {
  if (a == null || b == null) return a === b;
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.targetPaceSecPerMile === b.targetPaceSecPerMile &&
    sameEnd(a.end, b.end)
  );
}

/**
 * Whether two plans say the same thing.
 *
 * Used by the share encoder to decide whether a plan is worth putting in the
 * link at all: if `inferPlan` can read the structure back out of the blocks,
 * the plan is redundant and every one of its bytes lands in somebody's text
 * message for nothing.
 */
export function samePlan(a: WorkoutPlan, b: WorkoutPlan): boolean {
  if (!sameSegment(a.warmup, b.warmup)) return false;
  if (!sameSegment(a.cooldown, b.cooldown)) return false;

  const x = a.main;
  const y = b.main;
  if (x.kind === 'steady' && y.kind === 'steady') return sameSegment(x.segment, y.segment);
  if (x.kind !== 'repeat' || y.kind !== 'repeat') return false;
  if (x.rounds !== y.rounds) return false;
  if (x.dropFinalRecovery !== y.dropFinalRecovery) return false;
  if (x.steps.length !== y.steps.length) return false;

  return x.steps.every((step, i) => {
    const other = y.steps[i]!;
    if (!sameSegment(step, other)) return false;
    if (!!step.matchPrevious !== !!other.matchPrevious) return false;
    const p = step.perRound ?? [];
    const q = other.perRound ?? [];
    return p.length === q.length && p.every((e, j) => sameEnd(e, q[j]!));
  });
}

/** A workout built from a plan, with the blocks compiled to match. */
export function workoutFromPlan(
  plan: WorkoutPlan,
  name: string,
  id = newId('w'),
): WorkoutDef {
  return { id, name, plan, blocks: planToBlocks(plan) };
}

/** A preset: authored as a plan, shipped with its blocks already compiled. */
function preset(id: string, name: string, plan: WorkoutPlan): WorkoutDef {
  return { ...workoutFromPlan(plan, name, id), builtIn: true };
}

const time = (seconds: number): EndCondition => ({ type: 'time', seconds });
const dist = (meters: number): EndCondition => ({ type: 'distance', meters });

export const PRESET_WORKOUTS: WorkoutDef[] = [
  preset('on-off-2min-30s-x4', '4 × (2 min on / 30 s rest)', {
    warmup: null,
    main: {
      kind: 'repeat',
      rounds: 4,
      steps: [
        { name: 'On', kind: 'work', end: time(120) },
        { name: 'Rest', kind: 'recovery', end: time(30) },
      ],
      dropFinalRecovery: true,
    },
    cooldown: null,
  }),
  preset('repeats-800-x6', '6 × 800m, 400m recovery', {
    warmup: null,
    main: {
      kind: 'repeat',
      rounds: 6,
      steps: [
        { name: '800m', kind: 'work', end: dist(800) },
        { name: 'Recovery', kind: 'recovery', end: dist(400) },
      ],
      dropFinalRecovery: true,
    },
    cooldown: null,
  }),
  preset('repeats-mile-x4', '4 × 1 mile, 3 min recovery', {
    warmup: null,
    main: {
      kind: 'repeat',
      rounds: 4,
      steps: [
        { name: 'Mile', kind: 'work', end: dist(MILE) },
        { name: 'Recovery', kind: 'recovery', end: time(180) },
      ],
      dropFinalRecovery: true,
    },
    cooldown: null,
  }),
  preset('tempo-2-3-1', 'Tempo 2 / 3 / 1', {
    warmup: { name: 'Warmup', kind: 'warmup', end: dist(2 * MILE) },
    main: { kind: 'steady', segment: { name: 'Tempo', kind: 'work', end: dist(3 * MILE) } },
    cooldown: { name: 'Cooldown', kind: 'cooldown', end: dist(MILE) },
  }),
  // The rungs vary, so this is a ladder: one set whose work step carries a
  // distance per round, with a recovery that mirrors whatever rung it follows.
  // It compiles to the same nine segments it always did.
  preset('ladder-400-1200-400', 'Ladder 400 / 800 / 1200 / 800 / 400', {
    warmup: null,
    main: {
      kind: 'repeat',
      rounds: 5,
      steps: [
        {
          // Left at its default, so each rung takes its own distance as a name.
          name: KIND_DEFAULT_NAME.work,
          kind: 'work',
          end: dist(400),
          perRound: [dist(400), dist(800), dist(1200), dist(800), dist(400)],
        },
        { name: 'Recovery', kind: 'recovery', end: dist(400), matchPrevious: true },
      ],
      dropFinalRecovery: true,
    },
    cooldown: null,
  }),
];

/**
 * Merge adjacent `repeat: 1` blocks into one.
 *
 * The builder shows repeat-1 blocks as plain rows with no chrome, so two
 * consecutive steps look like one list — but if they sit in separate blocks the
 * reorder arrows can't move a step across a boundary the user can no longer
 * see, and the button just appears broken. Run this after every structural
 * edit. Repeat sets are never merged: their grouping is the whole point.
 *
 * This is presentation housekeeping only. `resolveWorkout` produces byte-for-
 * byte the same flat list before and after, which the tests assert.
 */
export function coalesceBlocks(blocks: WorkoutBlock[]): WorkoutBlock[] {
  const out: WorkoutBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    // A block that drops its final step must stand alone. Merging segments in
    // after it would leave the flag deleting a step that belongs to whatever
    // followed, which is not the step anybody asked to drop.
    if (
      prev &&
      prev.repeat === 1 &&
      b.repeat === 1 &&
      !prev.dropFinalStep &&
      !b.dropFinalStep
    ) {
      out[out.length - 1] = { ...prev, segments: [...prev.segments, ...b.segments] };
    } else {
      out.push(b);
    }
  }
  // A block emptied by deleting its last segment carries no meaning.
  return out.filter((b) => b.segments.length > 0);
}

/**
 * A sensible starting point for a brand new workout: a warmup, a set of reps
 * and a cooldown, all of them editable and any of them removable. Starting
 * from the shape rather than from an empty list is the point — the structure
 * is what the builder is for.
 */
export function blankPlan(): WorkoutPlan {
  return {
    warmup: { name: 'Warmup', kind: 'warmup', end: time(600) },
    main: {
      kind: 'repeat',
      rounds: 4,
      steps: [
        { name: 'On', kind: 'work', end: time(120) },
        { name: 'Rest', kind: 'recovery', end: time(30) },
      ],
      dropFinalRecovery: true,
    },
    cooldown: { name: 'Cooldown', kind: 'cooldown', end: time(300) },
  };
}

export function blankWorkout(): WorkoutDef {
  return workoutFromPlan(blankPlan(), 'New workout');
}

/** Deep copy under a new id, for "duplicate" and for editing a preset. */
export function copyWorkout(w: WorkoutDef, name = `${w.name} copy`): WorkoutDef {
  const copy: WorkoutDef = {
    id: newId('w'),
    name,
    builtIn: false,
    blocks: w.blocks.map((b) => ({
      ...b,
      id: newId('b'),
      segments: b.segments.map(cloneSegment),
    })),
  };
  // The plan travels with the copy, or customizing a preset would drop it
  // straight into the advanced editor.
  if (w.plan) copy.plan = clonePlan(w.plan);
  return copy;
}

/** Deep copy of a plan, so an edit to one draft can't reach into another. */
export function clonePlan(plan: WorkoutPlan): WorkoutPlan {
  return {
    warmup: plan.warmup ? cloneSegment(plan.warmup) : null,
    cooldown: plan.cooldown ? cloneSegment(plan.cooldown) : null,
    main:
      plan.main.kind === 'steady'
        ? { kind: 'steady', segment: cloneSegment(plan.main.segment) }
        : {
            kind: 'repeat',
            rounds: plan.main.rounds,
            dropFinalRecovery: plan.main.dropFinalRecovery,
            steps: plan.main.steps.map((s) => ({
              ...cloneSegment(s),
              ...(s.perRound ? { perRound: s.perRound.map((e) => ({ ...e })) } : {}),
              ...(s.matchPrevious ? { matchPrevious: true } : {}),
            })),
          },
  };
}
