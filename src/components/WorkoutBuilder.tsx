import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../lib/units';
import {
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
  const [secText, setSecText] = useState(() => String(seconds % 60));
  // The last value this field sent up. Anything else arriving in `seconds` came
  // from outside, and only then may we overwrite what is being typed.
  const emitted = useRef(seconds);

  useEffect(() => {
    if (seconds === emitted.current) return;
    emitted.current = seconds;
    setMinText(String(Math.floor(seconds / 60)));
    setSecText(String(seconds % 60));
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
  function normalise() {
    const total = commit(minText, secText);
    setMinText(String(Math.floor(total / 60)));
    setSecText(String(total % 60));
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
        onBlur={normalise}
        onChange={(e) => {
          setMinText(e.target.value);
          commit(e.target.value, secText);
        }}
        className={field}
      />
      <span className="font-bold text-muted">:</span>
      {/* No padStart here: a padded "030" is exactly what turned typing 45
          into 3045. Zero padding belongs on read-only clocks, not inputs. */}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={secText}
        aria-label="seconds"
        onFocus={(e) => e.target.select()}
        onBlur={normalise}
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

  function normalise() {
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

  /** The dropdown re-expresses the same distance. The stored metres never move. */
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
        onBlur={normalise}
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

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => onChange({ ...seg, kind: k })}
            className={`rounded px-2 py-1 text-[11px] font-black tracking-widest uppercase ${
              seg.kind === k ? KIND_CHIP[k] : 'border border-line text-muted'
            }`}
          >
            {k}
          </button>
        ))}
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
  onSave,
  onDelete,
  onCancel,
}: {
  initial: WorkoutDef;
  onSave: (w: WorkoutDef) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<WorkoutDef>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolved = resolveWorkout(draft);
  const secs = plannedSeconds(resolved.segments);
  const meters = plannedMeters(resolved.segments);

  function editBlock(id: string, fn: (b: WorkoutBlock) => WorkoutBlock) {
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? fn(b) : b)) }));
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
      <header className="flex items-center gap-2 border-b border-line px-3 py-3">
        <button
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-2 text-sm font-bold"
        >
          Cancel
        </button>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Workout name"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-base font-black"
        />
        <button
          onClick={() => onSave(draft)}
          disabled={resolved.segments.length === 0 || !draft.name.trim()}
          className="rounded-lg bg-go px-4 py-2 text-sm font-black text-go-ink disabled:opacity-40"
        >
          Save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-8">
        <p className="py-2 text-sm text-muted">
          {resolved.segments.length} segments
          {secs != null && ` · ${formatClock(secs * 1000)}`}
          {meters > 0 && ` · ${(meters / MILE).toFixed(2)} mi`}
        </p>

        {draft.blocks.map((b, bi) => (
          <div key={b.id} className="mb-3 rounded-2xl bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-black tracking-widest text-muted uppercase">
                repeat
              </span>
              <SmallButton
                onClick={() => editBlock(b.id, (x) => ({ ...x, repeat: Math.max(1, x.repeat - 1) }))}
              >
                −
              </SmallButton>
              <span className="w-10 text-center text-xl font-black">{b.repeat}×</span>
              <SmallButton
                onClick={() => editBlock(b.id, (x) => ({ ...x, repeat: x.repeat + 1 }))}
              >
                +
              </SmallButton>
              <span className="flex-1" />
              <SmallButton
                onClick={() => setDraft((d) => ({ ...d, blocks: moveInArray(d.blocks, bi, -1) }))}
                disabled={bi === 0}
              >
                ↑
              </SmallButton>
              <SmallButton
                onClick={() => setDraft((d) => ({ ...d, blocks: moveInArray(d.blocks, bi, 1) }))}
                disabled={bi === draft.blocks.length - 1}
              >
                ↓
              </SmallButton>
              <SmallButton
                onClick={() =>
                  setDraft((d) => ({ ...d, blocks: d.blocks.filter((x) => x.id !== b.id) }))
                }
                tone="danger"
                disabled={draft.blocks.length === 1}
              >
                ✕
              </SmallButton>
            </div>

            {b.segments.map((s, si) => (
              <SegmentRow
                key={si}
                seg={s}
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
            ))}

            <SmallButton
              onClick={() =>
                editBlock(b.id, (x) => ({
                  ...x,
                  segments: [
                    ...x.segments,
                    { name: 'Segment', kind: 'work', end: { type: 'time', seconds: 60 } },
                  ],
                }))
              }
            >
              + Segment
            </SmallButton>
          </div>
        ))}

        <button
          onClick={() =>
            setDraft((d) => ({
              ...d,
              blocks: [
                ...d.blocks,
                {
                  id: newId('b'),
                  repeat: 1,
                  segments: [
                    { name: 'Segment', kind: 'work', end: { type: 'time', seconds: 60 } },
                  ],
                },
              ],
            }))
          }
          className="w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-bold text-muted"
        >
          + Repeat group
        </button>

        <div className="mt-4 rounded-2xl bg-card p-3">
          <h3 className="mb-2 text-xs font-black tracking-widest text-muted uppercase">
            Flattened order
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
