import { useState } from 'react';
import { MILE, newId, plannedMeters, plannedSeconds, resolveWorkout, type WorkoutDef } from '../lib/workouts';
import { isInstalledApp, isIOS, workoutLink } from '../lib/share';
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
  const [copied, setCopied] = useState(false);
  /*
   * A link tapped in a message lands in a browser, whichever one is default.
   * On iOS the home-screen app keeps storage separate from every browser on
   * the device, so a workout added here is simply not the one they will have
   * at the track — and the only way across is to carry the link over by hand.
   *
   * So the page says so, with the steps and the link ready to copy, rather
   * than sending them back to the message to hunt for it. Elsewhere the two
   * share storage and the import just works, so it is a soft aside instead of
   * a warning.
   */
  const inBrowser = !isInstalledApp();
  const separateStorage = inBrowser && isIOS();

  async function copyForApp() {
    const url = workoutLink(workout, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard refused: fall back to the share sheet, then give up quietly
      // — the workout can still be added here.
      try {
        await navigator.share?.({ title: workout.name, url });
      } catch {
        /* nothing else to offer */
      }
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center">
          <div className="text-center text-xs font-bold tracking-widest text-muted uppercase">
            shared workout
          </div>
          <h2 className="mt-1 text-center text-3xl font-black">{workout.name}</h2>

          {inBrowser && (
            <div className="mt-4 rounded-2xl bg-raised p-4">
              <p className="text-base font-black text-ink">
                {separateStorage
                  ? 'Using Pace from your home screen? Add it there instead.'
                  : 'Using Pace from your home screen?'}
              </p>
              <p className="mt-1 text-sm text-muted">
                {separateStorage
                  ? 'This is the browser, and on iPhone the installed app keeps its own workouts — adding it here won’t put it there.'
                  : 'You can add it here, or carry it across with the same three steps.'}
              </p>

              <ol className="mt-3 flex flex-col gap-2">
                <li className="flex items-center gap-3">
                  <Step n={1} done={copied} />
                  <button
                    onClick={() => void copyForApp()}
                    className={`h-[48px] flex-1 rounded-xl text-sm font-black ${
                      copied
                        ? 'border-2 border-line text-muted'
                        : 'bg-next text-next-ink'
                    }`}
                  >
                    {copied ? 'Link copied' : 'Copy this link'}
                  </button>
                </li>
                <li className="flex items-center gap-3">
                  <Step n={2} done={false} />
                  <span className="flex-1 text-sm font-bold text-ink">
                    Open Pace from your home screen
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <Step n={3} done={false} />
                  <span className="flex-1 text-sm font-bold text-ink">
                    Tap CHANGE under Workout, then “Paste a workout link”
                  </span>
                </li>
              </ol>

              {/* Nobody has to go back to the message and fish the link out:
                  it is on the clipboard from step one. */}
              {copied && (
                <p className="mt-3 text-sm font-semibold text-ink">
                  Copied. Open Pace and paste it — no need to go back to the message.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 rounded-2xl bg-card p-4">
            <div className="text-sm font-bold text-muted">
              {resolved.segments.length} segments
              {secs != null && ` · ${formatClock(secs * 1000)}`}
              {meters > 0 && ` · ${(meters / MILE).toFixed(2)} mi`}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {/* A 16-rep workout is 34 chips, which buries everything below
                  it — including the warning about which app this lands in. */}
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

function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
        done ? 'bg-go text-go-ink' : 'bg-card text-muted'
      }`}
    >
      {done ? '✓' : n}
    </span>
  );
}

/** A fresh identity for an imported workout, so it never collides with one of his. */
export function adoptWorkout(w: WorkoutDef): WorkoutDef {
  return {
    ...w,
    id: newId('w'),
    // A decoded workout's blocks carry no ids — the decoder has no business
    // minting them — but the builder uses them to key rows and to find the
    // block an edit belongs to, so two empty ids would edit each other.
    blocks: w.blocks.map((b) => ({ ...b, id: newId('b') })),
    builtIn: false,
    updatedAt: Date.now(),
  };
}
