import { useState } from 'react';
import type { Ride } from '../lib/useRide';
import { formatClock } from '../lib/units';
import {
  blankWorkout,
  copyWorkout,
  describePlan,
  endLabel,
  inferPlan,
  MILE,
  plannedMeters,
  plannedSeconds,
  resolveWorkout,
  type SegmentDef,
  type WorkoutDef,
} from '../lib/workouts';
import { WorkoutBuilder } from './WorkoutBuilder';
import { DECODE_MESSAGE, decodeWorkout, workoutLink } from '../lib/share';
import { adoptWorkout } from './SharedWorkout';

export function segmentChipLabel(s: SegmentDef): string {
  return endLabel(s.end);
}

/** Total time when everything is timed, plus total distance when any is measured. */
function totals(segments: SegmentDef[]): string {
  const secs = plannedSeconds(segments);
  const meters = plannedMeters(segments);
  return [
    `${segments.length} segment${segments.length === 1 ? '' : 's'}`,
    secs != null && secs > 0 ? formatClock(secs * 1000) : null,
    meters > 0 ? `${(meters / MILE).toFixed(2)} mi` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PartRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      {/* Fixed and non-wrapping: "Cool down" broke onto two lines and pushed
          its own value out of line with the two rows above it. */}
      <span className="w-[5.5rem] shrink-0 pt-0.5 text-[10px] font-black tracking-wider whitespace-nowrap text-muted uppercase">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm font-bold">{text}</span>
    </div>
  );
}

function WorkoutCard({
  w,
  selected,
  onChoose,
  onEdit,
  onDuplicate,
  onShare,
  duplicateLabel,
}: {
  w: WorkoutDef;
  selected: boolean;
  onChoose: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  duplicateLabel: string;
}) {
  const resolved = resolveWorkout(w);
  // A workout without a plan is one the structure can't describe — an old
  // custom one, or a link built in the advanced editor. It still runs; it just
  // gets summarized as the list of steps it actually is.
  const plan = w.plan ?? inferPlan(w.blocks);
  const parts = plan ? describePlan(plan) : null;

  return (
    <div
      className={`mb-2 overflow-hidden rounded-xl border-2 ${
        selected ? 'border-go bg-card' : 'border-line'
      }`}
    >
      <button onClick={onChoose} className="w-full p-4 text-left">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-lg leading-tight font-black">{w.name}</span>
          {selected && (
            <span className="rounded bg-go px-1.5 py-0.5 text-[10px] font-black tracking-widest text-go-ink uppercase">
              Chosen
            </span>
          )}
          {w.builtIn && !selected && (
            <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-black tracking-widest text-muted uppercase">
              Preset
            </span>
          )}
          {!plan && (
            <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-black tracking-widest text-muted uppercase">
              Custom
            </span>
          )}
        </div>

        {parts ? (
          <div className="mt-2 space-y-1">
            {parts.warmup && <PartRow label="Warm up" text={parts.warmup} />}
            <PartRow label="Main" text={parts.main} />
            {parts.cooldown && <PartRow label="Cool down" text={parts.cooldown} />}
          </div>
        ) : (
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
        )}

        <div className="mt-2 text-xs font-bold text-muted">{totals(resolved.segments)}</div>
      </button>

      <div className="flex gap-2 border-t border-line px-3 py-2">
        {onEdit && (
          <button
            onClick={onEdit}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-ink"
          >
            Edit
          </button>
        )}
        <button
          onClick={onDuplicate}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-ink"
        >
          {duplicateLabel}
        </button>
        <button
          onClick={onShare}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-ink"
        >
          Share
        </button>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-3 mb-2 text-xs font-black tracking-widest text-muted uppercase">
      {children}
    </h3>
  );
}

export function WorkoutPicker({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const selected = ride.selectedWorkout;
  const [editing, setEditing] = useState<WorkoutDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The paste box, which is how a link reaches an installed app. */
  const [linkText, setLinkText] = useState<string | null>(null);

  /**
   * Hand the link to the platform. The share sheet is the point — that is what
   * puts it into Messages — with the clipboard as the fallback and the raw
   * link on screen as the last resort, so there is always some way to send it.
   */
  async function share(w: WorkoutDef) {
    const url = workoutLink(w, window.location.href);
    const text = `${w.name} — a workout for the pacing app`;
    try {
      if (navigator.share) {
        await navigator.share({ title: w.name, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote('Link copied.');
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      // Neither worked, so show it and let him copy it by hand.
      setLinkText(url);
    }
  }

  /** Import from a pasted link, the path an installed app has to use. */
  function importPasted(text: string) {
    const result = decodeWorkout(text);
    if (!result.ok) {
      setNote(DECODE_MESSAGE[result.reason]);
      return;
    }
    void ride.saveWorkout(adoptWorkout(result.workout)).then((saved) => {
      ride.setSelectedWorkout(saved);
      setNote(`Added "${saved.name}".`);
    });
    setLinkText(null);
  }

  // Paused mid-session, picking a workout replaces the one in progress rather
  // than arming the next session.
  const swapping = ride.session != null && ride.session.status === 'paused';
  // Indoors nothing measures distance, so a distance-ended segment has no
  // boundary to arrive at — it waits for a tap. Better said here, while he is
  // choosing, than discovered on the treadmill mid-rep.
  const indoor = ride.session ? ride.session.mode === 'indoor' : ride.indoor;

  function choose(w: WorkoutDef | null) {
    ride.setSelectedWorkout(w);
    if (swapping) ride.swapWorkout(w);
    onClose();
  }

  if (editing) {
    return (
      <WorkoutBuilder
        initial={editing}
        isNew={isNew}
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

  const card = (w: WorkoutDef, preset: boolean) => (
    <WorkoutCard
      key={w.id}
      w={w}
      selected={selected?.id === w.id}
      onChoose={() => choose(w)}
      onEdit={
        preset
          ? undefined
          : () => {
              setIsNew(false);
              setEditing(w);
            }
      }
      // Presets stay pristine, so "Customize" opens the builder on a copy —
      // "Duplicate" made it look like the original was about to be wrecked. A
      // copy of something he already owns needs no editing session: save it and
      // let it appear under Mine.
      duplicateLabel={preset ? 'Customize' : 'Duplicate'}
      onDuplicate={() => {
        if (preset) {
          setIsNew(true);
          setEditing(copyWorkout(w));
        } else {
          void ride
            .saveWorkout(copyWorkout(w))
            .then((saved) => setNote(`Copied to "${saved.name}"`));
        }
      }}
      onShare={() => void share(w)}
    />
  );

  // Presets split by what the main section is, which is the only distinction
  // that changes how a session feels. Custom workouts stay in recency order:
  // the one he built last night is the one he wants at 5am.
  const isRepeats = (w: WorkoutDef) => (w.plan ?? inferPlan(w.blocks))?.main.kind === 'repeat';
  const repeatPresets = ride.presetWorkouts.filter(isRepeats);
  const steadyPresets = ride.presetWorkouts.filter((w) => !isRepeats(w));

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-lg font-black">
          {swapping ? 'Change workout' : 'Workout'}
          {swapping && (
            <span className="block text-xs font-bold text-muted">
              Replaces the paused workout. Time and distance are kept.
            </span>
          )}
        </h2>
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
      {indoor && (
        <div className="mx-4 mt-3 rounded-xl bg-raised px-3 py-2 text-xs font-semibold text-muted">
          Indoor: timed segments run themselves. A segment measured in distance
          waits for NEXT — watch the treadmill for the distance.
        </div>
      )}

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

        {/* Tapping a shared link on iOS opens Safari, not the app installed on
            the home screen, and the two do not share storage. Pasting the link
            in here is how a workout actually reaches the installed app. */}
        {linkText == null ? (
          <button
            onClick={() => setLinkText('')}
            className="mb-3 w-full rounded-xl border-2 border-dashed border-line p-3 text-sm font-bold text-muted"
          >
            Paste a workout link
          </button>
        ) : (
          <div className="mb-3 rounded-xl border-2 border-line p-3">
            <textarea
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Paste the link a friend sent you"
              rows={3}
              className="w-full rounded-lg border border-line bg-card p-2 text-sm break-all"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => importPasted(linkText)}
                disabled={linkText.trim() === ''}
                className="flex-1 rounded-lg bg-go py-2 text-sm font-black text-go-ink disabled:opacity-40"
              >
                Add workout
              </button>
              <button
                onClick={() => setLinkText(null)}
                className="rounded-lg border-2 border-line px-4 py-2 text-sm font-bold text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {note && (
          <p className="mb-2 rounded-lg bg-raised px-3 py-2 text-sm font-semibold">{note}</p>
        )}

        {ride.customWorkouts.length > 0 && <Heading>Mine</Heading>}
        {ride.customWorkouts.map((w) => card(w, false))}

        {repeatPresets.length > 0 && <Heading>Repeats</Heading>}
        {repeatPresets.map((w) => card(w, true))}

        {steadyPresets.length > 0 && <Heading>Steady runs</Heading>}
        {steadyPresets.map((w) => card(w, true))}

        <p className="py-3 text-sm text-muted">
          Segments auto-advance when their end condition is met; NEXT always overrides. Goal paces
          and the tolerance band are set per segment in the builder.
        </p>
      </div>
    </div>
  );
}
