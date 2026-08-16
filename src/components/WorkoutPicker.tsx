import { useState } from 'react';
import type { Ride } from '../lib/useRide';
import { formatClock } from '../lib/units';
import {
  blankWorkout,
  copyWorkout,
  MILE,
  plannedMeters,
  plannedSeconds,
  resolveWorkout,
  type SegmentDef,
  type WorkoutDef,
} from '../lib/workouts';
import { WorkoutBuilder } from './WorkoutBuilder';

export function segmentChipLabel(s: SegmentDef): string {
  return s.end.type === 'time'
    ? formatClock(s.end.seconds * 1000)
    : s.end.meters >= MILE
      ? `${(s.end.meters / MILE).toFixed(2)} mi`
      : `${Math.round(s.end.meters)} m`;
}

function WorkoutCard({
  w,
  selected,
  onChoose,
  onEdit,
  onDuplicate,
}: {
  w: WorkoutDef;
  selected: boolean;
  onChoose: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
}) {
  const resolved = resolveWorkout(w);
  const secs = plannedSeconds(resolved.segments);
  const meters = plannedMeters(resolved.segments);

  return (
    <div
      className={`mb-2 rounded-xl border-2 ${selected ? 'border-go bg-card' : 'border-line'}`}
    >
      <button onClick={onChoose} className="w-full p-4 text-left">
        <div className="text-lg font-black">{w.name}</div>
        <div className="text-sm text-muted">
          {resolved.segments.length} segments
          {secs != null && ` · ${formatClock(secs * 1000)}`}
          {meters > 0 && ` · ${(meters / MILE).toFixed(2)} mi`}
          {w.builtIn ? ' · preset' : ''}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {resolved.segments.slice(0, 8).map((s, i) => (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                s.kind === 'work'
                  ? 'bg-work text-work-ink'
                  : s.kind === 'recovery'
                    ? 'bg-recovery text-recovery-ink'
                    : 'bg-neutral-kind text-neutral-kind-ink'
              }`}
            >
              {s.name} {segmentChipLabel(s)}
            </span>
          ))}
          {resolved.segments.length > 8 && (
            <span className="px-1 text-[11px] font-bold text-muted">
              +{resolved.segments.length - 8} more
            </span>
          )}
        </div>
      </button>
      <div className="flex gap-2 border-t border-line px-3 py-2">
        {onEdit && (
          <button onClick={onEdit} className="text-sm font-bold text-muted">
            Edit
          </button>
        )}
        <button onClick={onDuplicate} className="text-sm font-bold text-muted">
          Duplicate
        </button>
      </div>
    </div>
  );
}

export function WorkoutPicker({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const selected = ride.selectedWorkout;
  const [editing, setEditing] = useState<WorkoutDef | null>(null);
  const [isNew, setIsNew] = useState(false);

  function choose(w: WorkoutDef | null) {
    ride.setSelectedWorkout(w);
    onClose();
  }

  if (editing) {
    return (
      <WorkoutBuilder
        initial={editing}
        onCancel={() => setEditing(null)}
        onDelete={
          isNew
            ? undefined
            : () => {
                void ride.removeWorkout(editing.id);
                setEditing(null);
              }
        }
        onSave={(w) => {
          void ride.saveWorkout(w).then((saved) => ride.setSelectedWorkout(saved));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-lg font-black">Workout</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setIsNew(true);
              setEditing(blankWorkout());
            }}
            className="rounded-lg bg-go px-3 py-2 text-sm font-black text-go-ink"
          >
            + New
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-next px-4 py-2 text-sm font-bold text-next-ink"
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <button
          onClick={() => choose(null)}
          className={`mb-3 w-full rounded-xl border-2 p-4 text-left ${
            selected === null ? 'border-go bg-card' : 'border-line'
          }`}
        >
          <div className="text-lg font-black">Free run</div>
          <div className="text-sm text-muted">
            Stopwatch and manual laps. Pace stays the hero number.
          </div>
        </button>

        {ride.customWorkouts.length > 0 && (
          <h3 className="mt-1 mb-2 text-xs font-black tracking-widest text-muted uppercase">
            Mine
          </h3>
        )}
        {ride.customWorkouts.map((w) => (
          <WorkoutCard
            key={w.id}
            w={w}
            selected={selected?.id === w.id}
            onChoose={() => choose(w)}
            onEdit={() => {
              setIsNew(false);
              setEditing(w);
            }}
            onDuplicate={() => {
              setIsNew(true);
              setEditing(copyWorkout(w));
            }}
          />
        ))}

        <h3 className="mt-3 mb-2 text-xs font-black tracking-widest text-muted uppercase">
          Presets
        </h3>
        {ride.presetWorkouts.map((w) => (
          <WorkoutCard
            key={w.id}
            w={w}
            selected={selected?.id === w.id}
            onChoose={() => choose(w)}
            // Presets stay pristine; "Duplicate" is how you make one yours.
            onDuplicate={() => {
              setIsNew(true);
              setEditing(copyWorkout(w));
            }}
          />
        ))}

        <p className="py-3 text-sm text-muted">
          Segments auto-advance when their end condition is met; NEXT always overrides. Target
          paces and tolerance bands come with the audio step.
        </p>
      </div>
    </div>
  );
}
