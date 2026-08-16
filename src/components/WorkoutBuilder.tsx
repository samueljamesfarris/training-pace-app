import { useState } from 'react';
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

/** Minutes + seconds, because a single field invites 90 meaning 1:30 or 0:90. */
function TimeInput({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (s: number) => void;
}) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const field =
    'w-14 rounded-lg border border-line px-2 py-1.5 text-center text-base font-bold';
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={m}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + s)}
        className={field}
      />
      <span className="font-bold text-muted">:</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={String(s).padStart(2, '0')}
        onChange={(e) =>
          onChange(m * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))
        }
        className={field}
      />
    </span>
  );
}

function DistanceInput({
  meters,
  onChange,
}: {
  meters: number;
  onChange: (m: number) => void;
}) {
  // Miles for anything at or beyond a mile, meters for track reps.
  const useMiles = meters >= MILE;
  const value = useMiles ? +(meters / MILE).toFixed(2) : Math.round(meters);
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={useMiles ? 0.05 : 50}
        value={value}
        onChange={(e) => {
          const v = Math.max(0, Number(e.target.value) || 0);
          onChange(useMiles ? v * MILE : v);
        }}
        className="w-20 rounded-lg border border-line px-2 py-1.5 text-center text-base font-bold"
      />
      <select
        value={useMiles ? 'mi' : 'm'}
        onChange={(e) => onChange(e.target.value === 'mi' ? value * MILE : value)}
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
              onChange({ ...seg, end: { type: 'time', seconds: 120 } })
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
              onChange({ ...seg, end: { type: 'distance', meters: 400 } })
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
