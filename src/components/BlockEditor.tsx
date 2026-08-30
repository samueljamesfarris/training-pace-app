import {
  coalesceBlocks,
  KIND_LABEL,
  MILE,
  newId,
  plannedMeters,
  plannedSeconds,
  resolveWorkout,
  type SegmentDef,
  type WorkoutBlock,
} from '../lib/workouts';
import { formatClock } from '../lib/units';
import { EndInput, KindChips, newSegment, SmallButton, TargetField } from './SegmentInputs';

/**
 * The free-form editor: a list of blocks, each repeated some number of times.
 *
 * This is the escape hatch behind the structured builder, and the editor every
 * workout used before the structure existed. Anything the warmup / main /
 * cooldown shape can't say — two different sets, a warmup with strides in it —
 * is said here. Nothing about it changed when the structure arrived, on
 * purpose: it already worked.
 */

function SegmentRow({
  seg,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  seg: SegmentDef;
  onChange: (s: SegmentDef) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div className="mb-2 rounded-xl border border-line p-2">
      <div className="flex items-center gap-2">
        <input
          value={seg.name}
          onChange={(e) => onChange({ ...seg, name: e.target.value })}
          placeholder="Segment name"
          aria-label="Segment name"
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-base font-bold"
        />
        <SmallButton onClick={() => onMove(-1)} disabled={!canMoveUp} label="Move up">
          ↑
        </SmallButton>
        <SmallButton onClick={() => onMove(1)} disabled={!canMoveDown} label="Move down">
          ↓
        </SmallButton>
        <SmallButton onClick={onRemove} tone="danger" label="Remove segment">
          ✕
        </SmallButton>
      </div>

      {/* The advanced editor keeps all four kinds: a hand-built list is where
          a warmup or a cooldown lives when it isn't its own section. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <KindChips seg={seg} onChange={onChange} />
        <TargetField seg={seg} onChange={onChange} />
      </div>

      <div className="mt-2">
        <EndInput end={seg.end} onChange={(end) => onChange({ ...seg, end })} />
      </div>
    </div>
  );
}

function moveInArray<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: WorkoutBlock[];
  onChange: (blocks: WorkoutBlock[]) => void;
}) {
  const resolved = resolveWorkout({ id: 'draft', name: 'draft', blocks }).segments;

  /** Every structural edit goes through here, so coalescing can't be forgotten. */
  function editBlocks(fn: (blocks: WorkoutBlock[]) => WorkoutBlock[]) {
    onChange(coalesceBlocks(fn(blocks)));
  }

  function editBlock(id: string, fn: (b: WorkoutBlock) => WorkoutBlock) {
    editBlocks((list) => list.map((b) => (b.id === id ? fn(b) : b)));
  }

  return (
    <>
      {blocks.map((b, bi) => {
        // A repeat-1 block is not a group, it is just steps. Rendering it with
        // a card and a "repeat 1×" header is what made adding a warmup feel
        // like creating a repeat group of one — and made "+ Segment" silently
        // drop a step inside the 4× set next to it.
        const isSet = b.repeat > 1;
        const blockSegments = resolveWorkout({ id: 'x', name: 'x', blocks: [b] }).segments;
        const blockSecs = plannedSeconds(b.segments);
        const blockMeters = plannedMeters(b.segments);
        const summary = [
          blockSecs != null && blockSecs > 0 ? formatClock(blockSecs * 1000) : null,
          blockMeters > 0
            ? blockMeters >= MILE
              ? `${(blockMeters / MILE).toFixed(2)} mi`
              : `${Math.round(blockMeters)} m`
            : null,
        ]
          .filter(Boolean)
          .join(' + ');

        const controls = (
          <>
            <SmallButton
              onClick={() => editBlocks((list) => moveInArray(list, bi, -1))}
              disabled={bi === 0}
              label="Move block up"
            >
              ↑
            </SmallButton>
            <SmallButton
              onClick={() => editBlocks((list) => moveInArray(list, bi, 1))}
              disabled={bi === blocks.length - 1}
              label="Move block down"
            >
              ↓
            </SmallButton>
            <SmallButton
              onClick={() => editBlocks((list) => list.filter((x) => x.id !== b.id))}
              tone="danger"
              // Blocks coalesce, so counting them is meaningless; what must not
              // reach zero is the number of segments in the workout.
              disabled={resolved.length - blockSegments.length <= 0}
              label="Remove block"
            >
              ✕
            </SmallButton>
          </>
        );

        const rows = b.segments.map((seg, si) => (
          <SegmentRow
            key={si}
            seg={seg}
            canMoveUp={si > 0}
            canMoveDown={si < b.segments.length - 1}
            onMove={(dir) =>
              editBlock(b.id, (x) => ({ ...x, segments: moveInArray(x.segments, si, dir) }))
            }
            onChange={(next) =>
              editBlock(b.id, (x) => ({
                ...x,
                segments: x.segments.map((o, i) => (i === si ? next : o)),
              }))
            }
            onRemove={() =>
              editBlock(b.id, (x) => ({
                ...x,
                segments: x.segments.filter((_, i) => i !== si),
              }))
            }
          />
        ));

        const addSegment = (
          <SmallButton
            onClick={() =>
              editBlock(b.id, (x) => ({ ...x, segments: [...x.segments, newSegment()] }))
            }
          >
            {isSet ? '+ Segment to this set' : '+ Segment'}
          </SmallButton>
        );

        if (!isSet) {
          return (
            <div key={b.id} className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-black tracking-widest text-muted uppercase">
                  {b.segments.length === 1 ? 'step' : 'steps'}
                </span>
                <span className="flex-1" />
                {/* Quiet: turning steps into a set is deliberate, not a thing
                    to trip over while editing one. */}
                <SmallButton onClick={() => editBlock(b.id, (x) => ({ ...x, repeat: 2 }))}>
                  Repeat
                </SmallButton>
                {controls}
              </div>
              {rows}
              {addSegment}
            </div>
          );
        }

        return (
          <div key={b.id} className="mb-3 rounded-2xl border-2 border-line bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <SmallButton
                onClick={() =>
                  editBlock(b.id, (x) => ({ ...x, repeat: Math.max(1, x.repeat - 1) }))
                }
                label="One fewer round"
              >
                −
              </SmallButton>
              <span className="text-xl font-black">{b.repeat}×</span>
              <SmallButton
                onClick={() => editBlock(b.id, (x) => ({ ...x, repeat: x.repeat + 1 }))}
                label="One more round"
              >
                +
              </SmallButton>
              {summary && (
                <span className="min-w-0 truncate text-xs font-bold text-muted">· {summary}</span>
              )}
              <span className="flex-1" />
              {controls}
            </div>
            {/* The indent and border are the only things saying "these
                repeat", so they have to read at a glance. */}
            <div className="border-l-2 border-line pl-3">{rows}</div>
            {b.segments.length > 1 && (
              <label className="mt-1 flex items-center gap-2 pl-3 text-sm font-bold text-muted">
                <input
                  type="checkbox"
                  checked={b.dropFinalStep === true}
                  onChange={(e) =>
                    editBlock(b.id, (x) => {
                      const { dropFinalStep: _drop, ...rest } = x;
                      return e.target.checked ? { ...rest, dropFinalStep: true } : rest;
                    })
                  }
                  className="size-4"
                />
                End on {b.segments[0]?.name || KIND_LABEL[b.segments[0]!.kind]}, skipping the last{' '}
                {b.segments[b.segments.length - 1]?.name || 'step'}
              </label>
            )}
            <div className="mt-1 pl-3">{addSegment}</div>
          </div>
        );
      })}

      <div className="flex gap-2">
        <button
          onClick={() =>
            editBlocks((list) => [
              ...list,
              { id: newId('b'), repeat: 1, segments: [newSegment()] },
            ])
          }
          className="flex-1 rounded-xl border-2 border-dashed border-line py-3 text-sm font-bold text-muted"
        >
          + Step
        </button>
        <button
          onClick={() =>
            editBlocks((list) => [
              ...list,
              {
                id: newId('b'),
                repeat: 2,
                segments: [newSegment('work'), newSegment('recovery')],
              },
            ])
          }
          className="flex-1 rounded-xl border-2 border-dashed border-line py-3 text-sm font-bold text-muted"
        >
          + Repeat set
        </button>
      </div>
    </>
  );
}
