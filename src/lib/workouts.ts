export type SegmentKind = 'work' | 'recovery' | 'warmup' | 'cooldown';

export type EndCondition =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number };

export interface SegmentDef {
  name: string;
  kind: SegmentKind;
  end: EndCondition;
}

/**
 * A block is one repeat group: `repeat` × the segments inside it. Authoring
 * happens in blocks; the session engine never sees them.
 */
export interface WorkoutBlock {
  id: string;
  repeat: number;
  segments: SegmentDef[];
}

/** The editable, stored form of a workout. */
export interface WorkoutDef {
  id: string;
  name: string;
  blocks: WorkoutBlock[];
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
      for (const s of b.segments) {
        segments.push({ ...s, name: times > 1 ? `${s.name} ${i}` : s.name });
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

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function block(repeat: number, segments: SegmentDef[]): WorkoutBlock {
  return { id: newId('b'), repeat, segments };
}

export const PRESET_WORKOUTS: WorkoutDef[] = [
  {
    id: 'on-off-2min-30s-x4',
    name: '4 × (2 min on / 30 s rest)',
    builtIn: true,
    blocks: [
      block(4, [
        { name: 'On', kind: 'work', end: { type: 'time', seconds: 120 } },
        { name: 'Rest', kind: 'recovery', end: { type: 'time', seconds: 30 } },
      ]),
    ],
  },
  {
    id: 'repeats-800-x6',
    name: '6 × 800m, 400m recovery',
    builtIn: true,
    blocks: [
      block(6, [
        { name: '800m', kind: 'work', end: { type: 'distance', meters: 800 } },
        { name: 'Recovery', kind: 'recovery', end: { type: 'distance', meters: 400 } },
      ]),
    ],
  },
  {
    id: 'repeats-mile-x4',
    name: '4 × 1 mile, 3 min recovery',
    builtIn: true,
    blocks: [
      block(4, [
        { name: 'Mile', kind: 'work', end: { type: 'distance', meters: MILE } },
        { name: 'Recovery', kind: 'recovery', end: { type: 'time', seconds: 180 } },
      ]),
    ],
  },
  {
    id: 'tempo-2-3-1',
    name: 'Tempo 2 / 3 / 1',
    builtIn: true,
    blocks: [
      block(1, [
        { name: 'Warmup', kind: 'warmup', end: { type: 'distance', meters: 2 * MILE } },
        { name: 'Tempo', kind: 'work', end: { type: 'distance', meters: 3 * MILE } },
        { name: 'Cooldown', kind: 'cooldown', end: { type: 'distance', meters: MILE } },
      ]),
    ],
  },
  {
    id: 'ladder-400-1200-400',
    name: 'Ladder 400 / 800 / 1200 / 800 / 400',
    builtIn: true,
    blocks: [400, 800, 1200, 800, 400].map((m, i, all) =>
      block(1, [
        { name: `${m}m`, kind: 'work', end: { type: 'distance', meters: m } },
        ...(i < all.length - 1
          ? [
              {
                name: 'Recovery',
                kind: 'recovery' as const,
                end: { type: 'distance' as const, meters: m },
              },
            ]
          : []),
      ]),
    ),
  },
];

/** A sensible starting point for a brand new workout. */
export function blankWorkout(): WorkoutDef {
  return {
    id: newId('w'),
    name: 'New workout',
    blocks: [
      {
        id: newId('b'),
        repeat: 4,
        segments: [
          { name: 'On', kind: 'work', end: { type: 'time', seconds: 120 } },
          { name: 'Rest', kind: 'recovery', end: { type: 'time', seconds: 30 } },
        ],
      },
    ],
  };
}

/** Deep copy under a new id, for "duplicate" and for editing a preset. */
export function copyWorkout(w: WorkoutDef, name = `${w.name} copy`): WorkoutDef {
  return {
    id: newId('w'),
    name,
    builtIn: false,
    blocks: w.blocks.map((b) => ({
      id: newId('b'),
      repeat: b.repeat,
      segments: b.segments.map((s) => ({ ...s, end: { ...s.end } })),
    })),
  };
}
