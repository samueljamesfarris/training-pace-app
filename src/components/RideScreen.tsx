import { useEffect, useState } from 'react';
import { ACCURACY_GATE_M } from '../lib/gpsEngine';
import { currentIndex } from '../lib/segments';
import { SegmentHero } from './SegmentHero';
import {
  averageMph,
  formatClock,
  formatMiles,
  formatPace,
  formatSpeed,
  mpsToMph,
} from '../lib/units';
import type { Ride } from '../lib/useRide';

function Stat({
  label,
  value,
  unit,
  size = 'md',
}: {
  label: string;
  value: string;
  unit?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className={
          size === 'lg'
            ? 'text-[clamp(2.5rem,12vw,5rem)] leading-none font-bold'
            : 'text-[clamp(1.75rem,8vw,3rem)] leading-none font-bold'
        }
      >
        {value}
        {unit && <span className="ml-1 text-[0.4em] font-semibold text-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-[11px] font-semibold tracking-widest text-muted uppercase">
        {label}
      </div>
    </div>
  );
}

function GpsChip({ ride }: { ride: Ride }) {
  const { gps, gpsActive, sourceKind, now } = ride;
  const acc = gps.accuracy;
  const dot =
    !gpsActive || acc == null
      ? 'bg-muted'
      : acc <= 10
        ? 'bg-good'
        : acc <= ACCURACY_GATE_M
          ? 'bg-warn'
          : 'bg-bad';
  const ageSec = gps.lastFixAt ? Math.floor((now - gps.lastFixAt) / 1000) : null;

  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span className={`h-3 w-3 rounded-full ${dot}`} />
      <span>
        {acc == null ? 'GPS --' : `±${Math.round(acc)} m`}
      </span>
      {gps.stale && gpsActive && (
        <span className="rounded bg-bad px-1.5 py-0.5 text-xs font-bold text-bad-ink">
          GPS {ageSec != null ? `${ageSec}s` : ''}
        </span>
      )}
      {sourceKind !== 'geo' && (
        <span className="rounded bg-info px-1.5 py-0.5 text-xs font-bold text-info-ink">
          {sourceKind === 'sim' ? 'SIM' : 'REPLAY'}
        </span>
      )}
    </div>
  );
}

export function RideScreen({
  ride,
  onOpenDev,
  onOpenPicker,
}: {
  ride: Ride;
  onOpenDev: () => void;
  onOpenPicker: () => void;
}) {
  const { gps, session, elapsed } = ride;
  const [finishArmed, setFinishArmed] = useState(false);

  // A mis-tap must not end the session, so Finish arms for four seconds.
  useEffect(() => {
    if (!finishArmed) return;
    const id = setTimeout(() => setFinishArmed(false), 4000);
    return () => clearTimeout(id);
  }, [finishArmed]);

  const mph = gps.displayMps != null ? mpsToMph(gps.displayMps) : null;
  const avgMph = averageMph(gps.distanceMeters, elapsed);
  const running = session?.status === 'running';
  const paused = session?.status === 'paused';
  const dim = gps.stale ? 'opacity-40' : '';
  const workout = session?.workout ?? null;
  const atLastSegment =
    !!workout && !!session && currentIndex(session) >= workout.segments.length - 1;

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <header className="flex items-center justify-between px-4 py-2">
        <GpsChip ride={ride} />
        <div className="flex items-center gap-3">
          {session && (
            <span className="text-xs font-bold tracking-widest text-muted uppercase">
              {session.status}
            </span>
          )}
          <button
            onClick={ride.toggleTheme}
            aria-label="Toggle night mode"
            className="rounded-md border border-line px-2 py-1 text-xs font-bold text-muted"
          >
            {ride.theme === 'dark' ? 'NIGHT' : 'DAY'}
          </button>
          <button
            onClick={onOpenDev}
            className="rounded-md border border-line px-2 py-1 text-xs font-bold text-muted"
          >
            DEV
          </button>
        </div>
      </header>

      {ride.error && (
        <div className="mx-3 mb-1 rounded-md bg-bad px-3 py-2 text-sm font-semibold text-bad-ink">
          {ride.error}
        </div>
      )}
      {ride.persistError && (
        <div className="mx-3 mb-1 rounded-md bg-hold px-3 py-2 text-sm font-semibold text-hold-ink">
          Not saving to storage: {ride.persistError}
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 content-center gap-2 px-3 landscape:grid-cols-2 landscape:items-center">
        {workout && session ? (
          <SegmentHero session={session} now={ride.now} distanceMeters={gps.distanceMeters} />
        ) : (
          <section className="flex flex-col items-center justify-center">
            <div
              className={`text-[clamp(4.5rem,29vw,15rem)] leading-[0.9] font-black tracking-tight ${dim}`}
            >
              {formatPace(mph)}
            </div>
            <div className="text-sm font-bold tracking-widest text-muted uppercase">
              min / mile
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          {/* With a workout loaded the countdown owns the hero, so pace moves
              here — still the largest thing after the segment clock. */}
          <div className="grid grid-cols-2 gap-2">
            {workout ? (
              <>
                <div className={dim}>
                  <Stat label="min / mile" value={formatPace(mph)} size="lg" />
                </div>
                <Stat label="total time" value={formatClock(elapsed)} size="lg" />
              </>
            ) : (
              <>
                <div className={dim}>
                  <Stat label="speed" value={formatSpeed(mph)} unit="mph" size="lg" />
                </div>
                <Stat label="elapsed" value={formatClock(elapsed)} size="lg" />
              </>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-3">
            {workout ? (
              <div className={dim}>
                <Stat label="mph" value={formatSpeed(mph)} />
              </div>
            ) : (
              <Stat label="avg mph" value={formatSpeed(avgMph)} />
            )}
            <Stat label="avg pace" value={formatPace(avgMph)} />
            <Stat label="distance" value={formatMiles(gps.distanceMeters)} unit="mi" />
          </div>
        </section>
      </main>

      <footer className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {!session && (
          <>
            <button
              onClick={onOpenPicker}
              className="mb-2 flex w-full items-center justify-between rounded-xl border-2 border-line px-4 py-3 text-left active:bg-raised"
            >
              <span>
                <span className="block text-[11px] font-bold tracking-widest text-muted uppercase">
                  workout
                </span>
                <span className="text-lg font-black">
                  {ride.selectedWorkout?.name ?? 'Free run'}
                </span>
              </span>
              <span className="text-sm font-bold text-muted">CHANGE</span>
            </button>
            <div className="flex gap-2">
              <button
                onClick={ride.start}
                className="h-[76px] flex-[2] rounded-2xl bg-go text-2xl font-black tracking-wide text-go-ink active:opacity-80"
              >
                START
              </button>
              <button
                onClick={ride.gpsActive ? ride.stopSource : ride.startSource}
                className="h-[76px] flex-1 rounded-2xl border-2 border-line text-base font-bold text-ink active:bg-raised"
              >
                {ride.gpsActive ? 'GPS ON' : 'WARM UP GPS'}
              </button>
            </div>
          </>
        )}

        {session && session.status !== 'finished' && (
          <div className="flex gap-2">
            <button
              onClick={running ? ride.pause : ride.resume}
              className={`h-[76px] flex-1 rounded-2xl text-xl font-black tracking-wide ${
                running ? 'bg-hold text-hold-ink' : 'bg-go text-go-ink'
              }`}
            >
              {running ? 'PAUSE' : 'RESUME'}
            </button>
            <button
              onClick={ride.nextSegment}
              disabled={atLastSegment}
              className="h-[76px] flex-1 rounded-2xl bg-next text-xl font-black tracking-wide text-next-ink active:opacity-80 disabled:opacity-30"
            >
              {workout ? 'NEXT' : 'LAP'}
            </button>
            <button
              onClick={() => {
                if (finishArmed) {
                  setFinishArmed(false);
                  ride.finish();
                } else {
                  setFinishArmed(true);
                }
              }}
              className={`h-[76px] flex-1 rounded-2xl text-base font-black ${
                finishArmed
                  ? 'bg-stop text-stop-ink'
                  : 'border-2 border-line text-ink active:bg-raised'
              }`}
            >
              {finishArmed ? 'CONFIRM' : 'FINISH'}
            </button>
          </div>
        )}
      </footer>

      {paused && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
          <span className="rounded-full bg-hold px-4 py-1 text-sm font-black tracking-widest text-hold-ink uppercase">
            paused
          </span>
        </div>
      )}
    </div>
  );
}
