import { MILE, newId, plannedMeters, plannedSeconds, resolveWorkout, type WorkoutDef } from '../lib/workouts';
import { formatClock } from '../lib/units';
import { segmentChipLabel } from './WorkoutPicker';

/**
 * A workout that arrived in a link, offered rather than installed.
 *
 * It is never saved without a tap: a link is someone else's content, and a
 * workout that appeared in the library on its own would be indistinguishable
 * from one he built. Accepting assigns a fresh id, so an import can't
 * overwrite anything already there.
 */
export function SharedWorkout({
  workout,
  onAdd,
  onDismiss,
}: {
  workout: WorkoutDef;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const resolved = resolveWorkout(workout);
  const secs = plannedSeconds(resolved.segments);
  const meters = plannedMeters(resolved.segments);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
          <div className="text-center text-xs font-bold tracking-widest text-muted uppercase">
            shared workout
          </div>
          <h2 className="mt-1 text-center text-3xl font-black">{workout.name}</h2>

          <div className="mt-4 rounded-2xl bg-card p-4">
            <div className="text-sm font-bold text-muted">
              {resolved.segments.length} segments
              {secs != null && ` · ${formatClock(secs * 1000)}`}
              {meters > 0 && ` · ${(meters / MILE).toFixed(2)} mi`}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {resolved.segments.map((s, i) => (
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
            </div>
          </div>

          <p className="mt-3 text-center text-sm text-muted">
            Nothing is saved until you add it, and you can edit or delete it afterwards.
          </p>
        </div>
      </div>

      <div className="shrink-0 px-5 pt-2 pb-3">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <button
            onClick={onAdd}
            className="h-[64px] rounded-2xl bg-go text-xl font-black text-go-ink"
          >
            Add to my workouts
          </button>
          <button
            onClick={onDismiss}
            className="h-[52px] rounded-2xl border-2 border-line text-base font-bold text-ink"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

/** A fresh identity for an imported workout, so it never collides with one of his. */
export function adoptWorkout(w: WorkoutDef): WorkoutDef {
  return { ...w, id: newId('w'), builtIn: false, updatedAt: Date.now() };
}
