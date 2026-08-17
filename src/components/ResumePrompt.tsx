import { completedSegments } from '../lib/segments';
import { elapsedMs } from '../lib/types';
import { averageMph, formatClock, formatMiles, formatPace } from '../lib/units';
import type { Ride } from '../lib/useRide';

/**
 * Shown when an unfinished session is found in storage after a reload — a
 * crash, an accidental close, or the browser reclaiming memory mid-ride.
 * It states what would be recovered before asking, because "resume?" with no
 * numbers is impossible to answer.
 */
export function ResumePrompt({ ride }: { ride: Ride }) {
  const rec = ride.resumable;
  if (!rec) return null;

  const now = Date.now();
  // Elapsed as of the last heartbeat — the time actually run, not including
  // however long the app was dead.
  const elapsed = elapsedMs(rec, rec.lastSeenAt);
  const segs = completedSegments(rec, rec.lastSeenAt, rec.distanceMeters);
  const awayMs = Math.max(0, now - rec.lastSeenAt);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-center bg-surface px-5 text-ink">
      <h2 className="mb-1 text-center text-3xl font-black">Unfinished session</h2>
      <p className="mb-5 text-center text-sm text-muted">
        Started {new Date(rec.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        {rec.workout ? ` · ${rec.workout.name}` : ' · Free run'}
      </p>

      <div className="grid grid-cols-2 gap-4 rounded-2xl bg-card p-5">
        <div>
          <div className="text-4xl font-black">{formatClock(elapsed)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">elapsed</div>
        </div>
        <div>
          <div className="text-4xl font-black">{formatMiles(rec.distanceMeters)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">miles</div>
        </div>
        <div>
          <div className="text-4xl font-black">
            {formatPace(averageMph(rec.distanceMeters, elapsed))}
          </div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">avg pace</div>
        </div>
        <div>
          <div className="text-4xl font-black">
            {rec.workout ? `${segs.length}/${rec.workout.segments.length}` : segs.length}
          </div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">
            {rec.workout ? 'segments' : 'laps'}
          </div>
        </div>
      </div>

      {awayMs > 15_000 && (
        <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-center text-sm font-semibold">
          Away for {formatClock(awayMs)} — that gap is not counted.
        </p>
      )}

      <p className="mt-3 text-center text-sm text-muted">
        Resuming comes back paused, so nothing spent away from the app is added to your time.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <button
          onClick={() => void ride.resumeSession()}
          className="h-[76px] rounded-2xl bg-go text-xl font-black text-go-ink"
        >
          RESUME
        </button>
        <button
          onClick={() => void ride.discardResumable()}
          className="h-[60px] rounded-2xl border-2 border-line text-base font-bold text-muted"
        >
          Discard and start fresh
        </button>
      </div>
    </div>
  );
}
