import { useState } from 'react';
import { completedSegments } from '../lib/segments';
import { elapsedMs } from '../lib/types';
import { averageMph, formatClock, formatMiles, formatPace, formatSpeed } from '../lib/units';
import type { Ride } from '../lib/useRide';

/**
 * Minimal end-of-session card. The real summary, history and CSV export land in
 * step 7; what matters now is getting the raw log off the phone so real rides
 * can be replayed against the smoothing.
 */
export function FinishCard({ ride }: { ride: Ride }) {
  const { session } = ride;
  const [note, setNote] = useState<string | null>(null);
  if (!session || session.status !== 'finished') return null;

  const total = elapsedMs(session, session.finishedAt ?? Date.now());
  const avg = averageMph(ride.gps.distanceMeters, total);
  const segments = completedSegments(session, ride.now, ride.gps.distanceMeters);
  const targets = session.workout?.segments ?? [];
  const hasTargets = targets.some((t) => t.targetPaceSecPerMile != null);

  /** Seconds per mile off the goal, signed: negative is faster than asked. */
  function deltaFor(row: { index: number; distanceMeters: number; durationMs: number }) {
    const target = targets[row.index]?.targetPaceSecPerMile;
    if (target == null) return '—';
    const mph = averageMph(row.distanceMeters, row.durationMs);
    if (mph == null) return '—';
    const delta = Math.round(3600 / mph - target);
    if (delta === 0) return 'even';
    return `${delta > 0 ? '+' : ''}${delta}s`;
  }

  /**
   * A download on iOS lands in Files and then has to be found again. The share
   * sheet puts the log straight into Messages, Mail or iCloud from the finish
   * screen, which is where it actually needs to go. Falls back to the download
   * wherever sharing a file isn't offered.
   */
  async function exportLog() {
    const fixes = await ride.exportFixes();
    if (fixes.length === 0) {
      setNote('No fixes were logged in that session.');
      return;
    }
    const name = `${session!.id}-fixes.json`;
    const json = JSON.stringify(fixes);
    const file = new File([json], name, { type: 'application/json' });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        setNote(`Shared ${fixes.length} raw fixes.`);
        return;
      } catch (e) {
        // A canceled share is not a failure; anything else falls through to
        // the download rather than leaving him with no way to get the log off.
        if ((e as { name?: string }).name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setNote(`Exported ${fixes.length} raw fixes.`);
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-center bg-surface px-5">
      <h2 className="mb-4 text-center text-3xl font-black">Session complete</h2>
      <div className="grid grid-cols-2 gap-4 rounded-2xl bg-card p-5 shadow-sm">
        <div>
          <div className="text-4xl font-black">{formatClock(total)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">time</div>
        </div>
        <div>
          <div className="text-4xl font-black">{formatMiles(ride.gps.distanceMeters)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">miles</div>
        </div>
        <div>
          <div className="text-4xl font-black">{formatPace(avg)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">
            avg pace
          </div>
        </div>
        <div>
          <div className="text-4xl font-black">{formatSpeed(avg)}</div>
          <div className="text-xs font-bold tracking-widest text-muted uppercase">avg mph</div>
        </div>
      </div>

      {segments.length > 1 && (
        <div className="mt-4 max-h-[30vh] overflow-y-auto rounded-2xl bg-card p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] tracking-widest text-muted uppercase">
                <th className="text-left font-bold">segment</th>
                <th className="text-right font-bold">time</th>
                <th className="text-right font-bold">dist</th>
                <th className="text-right font-bold">pace</th>
                {hasTargets && <th className="text-right font-bold">vs goal</th>}
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.index} className="border-t border-line">
                  <td className="py-1 font-bold">{s.name}</td>
                  <td className="py-1 text-right">{formatClock(s.durationMs)}</td>
                  <td className="py-1 text-right">{formatMiles(s.distanceMeters)}</td>
                  <td className="py-1 text-right font-bold">
                    {formatPace(averageMph(s.distanceMeters, s.durationMs))}
                  </td>
                  {hasTargets && (
                    <td className="py-1 text-right font-bold">{deltaFor(s)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-center text-sm text-muted">
        {ride.gps.fixCount} fixes · {ride.gps.rejectedCount} rejected on accuracy ·{' '}
        {ride.gps.dropoutCount} dropout gaps
      </div>
      {note && <div className="mt-2 text-center text-sm font-semibold">{note}</div>}

      <div className="mt-6 flex flex-col gap-2">
        <button
          onClick={() => void exportLog()}
          className="h-[64px] rounded-2xl bg-next text-lg font-bold text-next-ink"
        >
          Export raw GPS log (JSON)
        </button>
        <button
          onClick={ride.clearSession}
          className="h-[76px] rounded-2xl bg-go text-xl font-black text-go-ink"
        >
          NEW SESSION
        </button>
      </div>
    </div>
  );
}
