import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../lib/units';
import {
  coalesceBlocks,
  KIND_LABEL,
  KINDS,
  MILE,
  newId,
  plannedMeters,
  plannedSeconds,
  resolveWorkout,
  type SegmentDef,
  type SegmentKind,
  type WorkoutBlock,
  type WorkoutDef,
} from '../lib/workouts';

/**
 * A new segment is named after its kind rather than the word "Segment", which
 * only duplicated the chip below it. `KIND_LABEL` is the one place these names
 * are spelled, so the chips, the preview and the defaults cannot drift.
 */
function newSegment(kind: SegmentKind = 'work'): SegmentDef {
  return kind === 'work'
    ? { name: KIND_LABEL[kind], kind, end: { type: 'time', seconds: 60 } }
    : { name: KIND_LABEL[kind], kind, end: { type: 'time', seconds: 30 } };
}

/** True when a name is still the untouched default for some kind. */
function isDefaultName(name: string) {
  return KINDS.some((k) => KIND_LABEL[k] === name);
}

const KIND_CHIP: Record<SegmentKind, string> = {
  work: 'bg-work text-work-ink',
  recovery: 'bg-recovery text-recovery-ink',
  warmup: 'bg-neutral-kind text-neutral-kind-ink',
  cooldown: 'bg-neutral-kind text-neutral-kind-ink',
};

function SmallButton({
  children,
  onClick,
  disabled,
  tone = 'plain',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1.5 text-sm font-bold disabled:opacity-30 ${
        tone === 'danger' ? 'border-stop text-stop' : 'border-line text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** Seconds read as a clock, so 5 shows as 05 — but only at rest, never mid-edit. */
function padSeconds(s: number) {
  return String(s).padStart(2, '0');
}

/**
 * Minutes + seconds, because a single field invites 90 meaning 1:30 or 0:90.
 *
 * The text is held locally so an empty box is legal while typing — coercing
 * every keystroke through `Number(x) || 0` made blank unreachable, since
 * backspacing to empty immediately rendered "0" back into the field. The parent
 * still gets a number on every keystroke, so the preview stays live.
 */
function TimeInput({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (s: number) => void;
}) {
  const [minText, setMinText] = useState(() => String(Math.floor(seconds / 60)));
  const [secText, setSecText] = useState(() => padSeconds(seconds % 60));
  // The last value this field sent up. Anything else arriving in `seconds` came
  // from outside, and only then may we overwrite what is being typed.
  const emitted = useRef(seconds);

  useEffect(() => {
    if (seconds === emitted.current) return;
    emitted.current = seconds;
    setMinText(String(Math.floor(seconds / 60)));
    setSecText(padSeconds(seconds % 60));
  }, [seconds]);

  function commit(mRaw: string, sRaw: string) {
    const m = Math.max(0, Math.floor(Number(mRaw) || 0));
    const s = Math.min(59, Math.max(0, Math.floor(Number(sRaw) || 0)));
    const total = m * 60 + s;
    emitted.current = total;
    onChange(total);
    return total;
  }

  /** On blur, empty commits 0 and seconds settle inside 0-59. */
  function normalize() {
    const total = commit(minText, secText);
    setMinText(String(Math.floor(total / 60)));
    setSecText(padSeconds(total % 60));
  }

  const field =
    'w-14 rounded-lg border border-line px-2 py-1.5 text-center text-base font-bold';
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={minText}
        aria-label="minutes"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setMinText(e.target.value);
          commit(e.target.value, secText);
        }}
        className={field}
      />
      <span className="font-bold text-muted">:</span>
      {/* Padding is applied when the field is at rest, never to what is being
          typed — a padded "030" mid-edit is what turned typing 45 into 3045.
          Local text plus select-on-focus is what makes this safe now. */}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={secText}
        aria-label="seconds"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setSecText(e.target.value);
          commit(minText, e.target.value);
        }}
        className={field}
      />
    </span>
  );
}

type DistanceUnit = 'm' | 'mi';

function showDistance(meters: number, unit: DistanceUnit) {
  return unit === 'mi' ? String(+(meters / MILE).toFixed(2)) : String(Math.round(meters));
}

function DistanceInput({
  meters,
  onChange,
}: {
  meters: number;
  onChange: (m: number) => void;
}) {
  // Which unit is *displayed*. Seeded from magnitude once and then owned by the
  // user: deriving it from the value on every render meant picking "mi" on a
  // 400 m segment stored 400 miles, and typing 0.5 mi flipped back to 804 m
  // mid-keystroke.
  const [unit, setUnit] = useState<DistanceUnit>(() => (meters >= MILE ? 'mi' : 'm'));
  const [text, setText] = useState(() =>
    showDistance(meters, meters >= MILE ? 'mi' : 'm'),
  );
  const emitted = useRef(meters);

  useEffect(() => {
    if (meters === emitted.current) return;
    emitted.current = meters;
    setText(showDistance(meters, unit));
  }, [meters, unit]);

  function commit(raw: string, u: DistanceUnit) {
    const n = Math.max(0, Number(raw) || 0);
    const m = u === 'mi' ? n * MILE : n;
    emitted.current = m;
    onChange(m);
    return m;
  }

  function normalize() {
    const n = Math.max(0, Number(text) || 0);
    const m = unit === 'mi' ? n * MILE : n;
    // Compare what is *shown*, so tabbing through a field displaying 805 m
    // can't quietly round the stored 804.672 m that a 0.5 mi entry produced.
    if (showDistance(m, unit) !== showDistance(meters, unit)) {
      emitted.current = m;
      onChange(m);
      setText(showDistance(m, unit));
    } else {
      setText(showDistance(meters, unit));
    }
  }

  /** The dropdown re-expresses the same distance. The stored meters never move. */
  function changeUnit(next: DistanceUnit) {
    setUnit(next);
    setText(showDistance(meters, next));
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={unit === 'mi' ? 0.05 : 50}
        value={text}
        aria-label="distance"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value, unit);
        }}
        className="w-20 rounded-lg border border-line px-2 py-1.5 text-center text-base font-bold"
      />
      <select
        value={unit}
        aria-label="distance unit"
        onChange={(e) => changeUnit(e.target.value as DistanceUnit)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm font-bold"
      >
        <option value="m">m</option>
        <option value="mi">mi</option>
      </select>
    </span>
  );
}

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
  // What each mode last held, so flipping Time/Distance to look at the other
  // one doesn't throw away what was already entered. The defaults are only
  // ever used the first time a mode is opened for this segment.
  const [lastSeconds, setLastSeconds] = useState(
    seg.end.type === 'time' ? seg.end.seconds : 120,
  );
  const [lastMeters, setLastMeters] = useState(
    seg.end.type === 'distance' ? seg.end.meters : 400,
  );
  useEffect(() => {
    if (seg.end.type === 'time') setLastSeconds(seg.end.seconds);
    else setLastMeters(seg.end.meters);
  }, [seg.end]);

  return (
    <div className="mb-2 rounded-xl border border-line p-2">
      <div className="flex items-center gap-2">
        <input
          value={seg.name}
          onChange={(e) => onChange({ ...seg, name: e.target.value })}
          placeholder="Segment name"
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-base font-bold"
        />
        <SmallButton onClick={() => onMove(-1)} disabled={!canMoveUp}>
          ↑
        </SmallButton>
        <SmallButton onClick={() => onMove(1)} disabled={!canMoveDown}>
          ↓
        </SmallButton>
        <SmallButton onClick={onRemove} tone="danger">
          ✕
        </SmallButton>
      </div>

      <div className="mt-2">
        <div className="mb-1 text-[11px] font-semibold tracking-widest text-muted uppercase">
          type
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() =>
                onChange({
                  ...seg,
                  kind: k,
                  // Follow the kind only while the name is still a default.
                  // A name he typed is his, and changing the type must not
                  // quietly overwrite it.
                  name: isDefaultName(seg.name) ? KIND_LABEL[k] : seg.name,
                })
              }
              className={`rounded px-2 py-1 text-[11px] font-black tracking-widest ${
                seg.kind === k ? KIND_CHIP[k] : 'border border-line text-muted'
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button
            onClick={() =>
              onChange({ ...seg, end: { type: 'time', seconds: lastSeconds } })
            }
            className={`rounded-lg px-2.5 py-1.5 text-sm font-bold ${
              seg.end.type === 'time'
                ? 'bg-next text-next-ink'
                : 'border border-line text-muted'
            }`}
          >
            Time
          </button>
          <button
            onClick={() =>
              onChange({ ...seg, end: { type: 'distance', meters: lastMeters } })
            }
            className={`rounded-lg px-2.5 py-1.5 text-sm font-bold ${
              seg.end.type === 'distance'
                ? 'bg-next text-next-ink'
                : 'border border-line text-muted'
            }`}
          >
            Distance
          </button>
        </div>
        {seg.end.type === 'time' ? (
          <TimeInput
            seconds={seg.end.seconds}
            onChange={(s) => onChange({ ...seg, end: { type: 'time', seconds: s } })}
          />
        ) : (
          <DistanceInput
            meters={seg.end.meters}
            onChange={(m) => onChange({ ...seg, end: { type: 'distance', meters: m } })}
          />
        )}
      </div>
    </div>
  );
}

export function WorkoutBuilder({
  initial,
  isNew,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: WorkoutDef;
  isNew: boolean;
  onSave: (w: WorkoutDef) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  // Coalesce on load too, not only on edit: the ladder preset is five separate
  // repeat-1 blocks, which would otherwise render as five step groups whose
  // arrows can't cross the boundaries between them.
  const [draft, setDraft] = useState<WorkoutDef>(() => ({
    ...initial,
    blocks: coalesceBlocks(initial.blocks),
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Cancel used to throw the draft away without asking. Only worth asking when
  // there is something to lose, and it reuses Delete's two-tap pattern.
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify({ ...initial, blocks: coalesceBlocks(initial.blocks) });

  const resolved = resolveWorkout(draft);
  const blockedReason = !draft.name.trim()
    ? 'Name the workout to save it'
    : resolved.segments.length === 0
      ? 'Add a segment to save it'
      : null;
  const secs = plannedSeconds(resolved.segments);
  const meters = plannedMeters(resolved.segments);

  /** Every structural edit goes through here, so coalescing can't be forgotten. */
  function editBlocks(fn: (blocks: WorkoutBlock[]) => WorkoutBlock[]) {
    setDraft((d) => ({ ...d, blocks: coalesceBlocks(fn(d.blocks)) }));
  }

  function editBlock(id: string, fn: (b: WorkoutBlock) => WorkoutBlock) {
    editBlocks((blocks) => blocks.map((b) => (b.id === id ? fn(b) : b)));
  }

  function moveInArray<T>(arr: T[], i: number, dir: -1 | 1): T[] {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const out = arr.slice();
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface text-ink">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => (dirty && !confirmCancel ? setConfirmCancel(true) : onCancel())}
            className={`rounded-lg border px-3 py-2 text-sm font-bold ${
              confirmCancel ? 'border-stop text-stop' : 'border-line'
            }`}
          >
            {confirmCancel ? 'Discard?' : 'Cancel'}
          </button>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Workout name"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-base font-black"
          />
          <button
            onClick={() => onSave(draft)}
            disabled={!!blockedReason}
            className="rounded-lg bg-go px-4 py-2 text-sm font-black text-go-ink disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <div className="mt-1 text-xs font-bold text-muted">
          {/* A disabled button with no explanation is a dead end. */}
          {blockedReason ?? (isNew ? 'New workout' : 'Editing')}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-8">
        <p className="py-2 text-sm text-muted">
          {resolved.segments.length} segments
          {secs != null && ` · ${formatClock(secs * 1000)}`}
          {meters > 0 && ` · ${(meters / MILE).toFixed(2)} mi`}
        </p>

        {draft.blocks.map((b, bi) => {
          // A repeat-1 block is not a group, it is just steps. Rendering it
          // with a card and a "repeat 1×" header is what made adding a warmup
          // feel like creating a repeat group of one — and made "+ Segment"
          // silently drop a step inside the 4× set next to it.
          const isSet = b.repeat > 1;
          const blockSegments = resolveWorkout({ ...draft, blocks: [b] }).segments;
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
                onClick={() => editBlocks((blocks) => moveInArray(blocks, bi, -1))}
                disabled={bi === 0}
              >
                ↑
              </SmallButton>
              <SmallButton
                onClick={() => editBlocks((blocks) => moveInArray(blocks, bi, 1))}
                disabled={bi === draft.blocks.length - 1}
              >
                ↓
              </SmallButton>
              <SmallButton
                onClick={() => editBlocks((blocks) => blocks.filter((x) => x.id !== b.id))}
                tone="danger"
                // Blocks coalesce, so counting them is meaningless; what must
                // not reach zero is the number of segments in the workout.
                disabled={resolved.segments.length - blockSegments.length <= 0}
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
                <SmallButton
                  onClick={() =>
                    editBlock(b.id, (x) => ({ ...x, segments: [...x.segments, newSegment()] }))
                  }
                >
                  + Segment
                </SmallButton>
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
                >
                  −
                </SmallButton>
                <span className="text-xl font-black">{b.repeat}×</span>
                <SmallButton onClick={() => editBlock(b.id, (x) => ({ ...x, repeat: x.repeat + 1 }))}>
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
              <div className="mt-1 pl-3">
                <SmallButton
                  onClick={() =>
                    editBlock(b.id, (x) => ({ ...x, segments: [...x.segments, newSegment()] }))
                  }
                >
                  + Segment to this set
                </SmallButton>
              </div>
            </div>
          );
        })}

        <div className="flex gap-2">
          <button
            onClick={() =>
              editBlocks((blocks) => [
                ...blocks,
                { id: newId('b'), repeat: 1, segments: [newSegment()] },
              ])
            }
            className="flex-1 rounded-xl border-2 border-dashed border-line py-3 text-sm font-bold text-muted"
          >
            + Step
          </button>
          <button
            onClick={() =>
              editBlocks((blocks) => [
                ...blocks,
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

        <div className="mt-4 rounded-2xl bg-card p-3">
          <h3 className="mb-2 text-xs font-black tracking-widest text-muted uppercase">
            Preview
          </h3>
          <div className="flex flex-wrap gap-1">
            {resolved.segments.map((s, i) => (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${KIND_CHIP[s.kind]}`}
              >
                {s.name}{' '}
                {s.end.type === 'time'
                  ? formatClock(s.end.seconds * 1000)
                  : s.end.meters >= MILE
                    ? `${(s.end.meters / MILE).toFixed(2)} mi`
                    : `${Math.round(s.end.meters)} m`}
              </span>
            ))}
          </div>
        </div>

        {onDelete && (
          <button
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className={`mt-4 w-full rounded-xl py-3 text-sm font-black ${
              confirmDelete ? 'bg-stop text-stop-ink' : 'border-2 border-stop text-stop'
            }`}
          >
            {confirmDelete ? 'Tap again to delete' : 'Delete workout'}
          </button>
        )}
      </div>
    </div>
  );
}
