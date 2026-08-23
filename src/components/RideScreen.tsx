import { useEffect, useState } from 'react';
import { ACCURACY_GATE_M } from '../lib/gpsEngine';
import { completedSegments, currentIndex } from '../lib/segments';
import { formatPaceSeconds as fmtPace } from '../lib/units';
import { SegmentHero } from './SegmentHero';
import {
  averageMph,
  formatClock,
  formatMiles,
  formatPace,
  formatPaceSeconds,
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

/**
 * Header controls sit in the strip nearest the island and were ~24px tall,
 * under the 44px iOS minimum. The hit area is padded rather than the label
 * inflated, so the row still reads as small print.
 */
const HEADER_BUTTON =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-2 text-xs font-bold';

/**
 * The verdict on pace, in words. Color is carried alongside, never alone —
 * in direct sun on a bouncing mount, a color difference is not a signal.
 */
function TargetBand({ ride }: { ride: Ride }) {
  const { targetPaceSec, paceDeviation } = ride;
  if (targetPaceSec == null) return null;
  // No pace reading is not the same as being on pace. Claiming "ON PACE" with
  // nothing measured is exactly the fabricated reading the app must never show.
  const known = ride.gps.paceSecPerMile != null;
  const word = !known
    ? 'NO PACE'
    : paceDeviation === 'fast'
      ? 'EASE UP'
      : paceDeviation === 'slow'
        ? 'PICK IT UP'
        : 'ON PACE';
  const tone = !known
    ? 'bg-raised text-muted opacity-60'
    : paceDeviation === 'fast'
      ? 'bg-too-fast text-surface'
      : paceDeviation === 'slow'
        ? 'bg-too-slow text-surface'
        : 'bg-raised text-muted';
  return (
    <div className="mt-1 flex items-center justify-center gap-2">
      <span className="rounded bg-raised px-2 py-0.5 text-xs font-bold text-muted">
        TARGET {fmtPace(targetPaceSec)}
      </span>
      <span className={`rounded px-2 py-0.5 text-xs font-black tracking-widest ${tone}`}>
        {word}
      </span>
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
      {gpsActive && gps.stale && gps.acquiring && (
        <span className="rounded bg-raised px-1.5 py-0.5 text-xs font-bold text-muted">
          ACQUIRING
        </span>
      )}
      {gpsActive && gps.stale && !gps.acquiring && (
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
  onOpenHistory,
}: {
  ride: Ride;
  onOpenDev: () => void;
  onOpenPicker: () => void;
  onOpenHistory: () => void;
}) {
  const { gps, session, elapsed } = ride;
  const [finishArmed, setFinishArmed] = useState(false);
  const [armSecondsLeft, setArmSecondsLeft] = useState(0);
  const [startArmed, setStartArmed] = useState(false);

  // Without a usable fix the first segment's distance starts from a position
  // that isn't known yet, so START asks once. With a fix it stays one tap, and
  // it never hard-blocks: starting cold on a treadmill is legitimate.
  useEffect(() => {
    if (!startArmed) return;
    const id = setTimeout(() => setStartArmed(false), 4000);
    return () => clearTimeout(id);
  }, [startArmed]);

  // A mis-tap must not end the session, so Finish arms for four seconds. The
  // window is shown, because a silent disarm turns a late second tap into a
  // re-arm and it looks like the button simply didn't work.
  useEffect(() => {
    if (!finishArmed) return;
    setArmSecondsLeft(4);
    const tick = setInterval(() => setArmSecondsLeft((n) => Math.max(0, n - 1)), 1000);
    const id = setTimeout(() => setFinishArmed(false), 4000);
    return () => {
      clearTimeout(id);
      clearInterval(tick);
    };
  }, [finishArmed]);

  const mph = gps.displayMps != null ? mpsToMph(gps.displayMps) : null;
  const avgMph = averageMph(gps.distanceMeters, elapsed);
  const running = session?.status === 'running';
  const paused = session?.status === 'paused';
  const dim = gps.stale ? 'opacity-40' : '';
  const paceTone =
    ride.paceDeviation === 'fast'
      ? 'text-too-fast'
      : ride.paceDeviation === 'slow'
        ? 'text-too-slow'
        : '';
  const workout = session?.workout ?? null;
  const sessionLive = !!session && session.status !== 'finished';
  // The most recently *closed* lap; the open one is still running.
  const lastLap =
    session && !workout
      ? completedSegments(session, ride.now, gps.distanceMeters)
          .filter((l) => !l.open)
          .at(-1)
      : undefined;
  const atLastSegment =
    !!workout && !!session && currentIndex(session) >= workout.segments.length - 1;

  return (
    <div className="relative flex h-full flex-col bg-surface text-ink">
      <header className="flex items-center justify-between px-4 py-2">
        <GpsChip ride={ride} />
        <div className="flex items-center gap-3">
          {session && (
            <span className="text-xs font-bold tracking-widest text-muted uppercase">
              {session.status}
            </span>
          )}
          <button
            onClick={() => ride.applyAudio({ ...ride.audio, enabled: !ride.audio.enabled })}
            aria-label="Toggle audio cues"
            className={`${HEADER_BUTTON} ${
              ride.audio.enabled ? 'border-line text-muted' : 'border-stop text-stop'
            }`}
          >
            {ride.audio.enabled ? 'SOUND' : 'MUTED'}
          </button>
          <button
            onClick={ride.toggleTheme}
            aria-label="Toggle night mode"
            className={`${HEADER_BUTTON} border-line text-muted`}
          >
            {ride.theme === 'dark' ? 'NIGHT' : 'DAY'}
          </button>
          {!sessionLive && (
            <button onClick={onOpenDev} className={`${HEADER_BUTTON} border-line text-muted`}>
              DEV
            </button>
          )}
        </div>
      </header>

      {ride.error && (
        <div className="mx-3 mb-1 rounded-md bg-bad px-3 py-2 text-sm font-semibold text-bad-ink">
          {ride.error}
        </div>
      )}
      {session && session.status !== 'finished' &&
        ride.wakeLockEnabled &&
        ride.wakeLockState !== 'held' && (
          <div className="mx-3 mb-1 rounded-md bg-hold px-3 py-2 text-sm font-semibold text-hold-ink">
            {ride.wakeLockState === 'unsupported'
              ? 'This browser will not keep the screen on. Set auto-lock to Never.'
              : 'Screen lock is not held — the display may sleep.'}
          </div>
        )}
      {ride.persistError && (
        <div className="mx-3 mb-1 rounded-md bg-hold px-3 py-2 text-sm font-semibold text-hold-ink">
          Not saving to storage: {ride.persistError}
        </div>
      )}

      {/* min-h-0 lets this shrink inside the flex column, and the overflow is
          its own — so in landscape the numbers scroll here while the header
          and the controls stay put and reachable. */}
      <main className="grid min-h-0 flex-1 grid-cols-1 content-center gap-2 overflow-y-auto px-3 landscape:grid-cols-2 landscape:items-center">
        {workout && session ? (
          <SegmentHero
            session={session}
            now={ride.now}
            distanceMeters={gps.distanceMeters}
            stale={gps.stale}
            acquiring={gps.acquiring}
            band={<TargetBand ride={ride} />}
          />
        ) : (
          <section className="flex flex-col items-center justify-center">
            <div
              className={`text-[clamp(4.5rem,29vw,15rem)] leading-[0.9] font-black tracking-tight ${dim}`}
            >
              {formatPaceSeconds(gps.paceSecPerMile)}
            </div>
            <div className="text-sm font-bold tracking-widest text-muted uppercase">
              min / mile
            </div>
            {session && (
              <div className="mt-2 rounded-full bg-raised px-4 py-1 text-sm font-bold">
                {lastLap ? (
                  <>
                    <span className="text-muted">LAP {lastLap.index + 1}</span>{' '}
                    {formatClock(lastLap.durationMs)} · {formatMiles(lastLap.distanceMeters)} mi
                  </>
                ) : (
                  <span className="text-muted">0 LAPS</span>
                )}
              </div>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          {/* With a workout loaded the countdown owns the hero, so pace moves
              here — still the largest thing after the segment clock. */}
          <div className="grid grid-cols-2 gap-2">
            {workout ? (
              <>
                <div className={`${dim} ${paceTone}`}>
                  <Stat label="min / mile" value={formatPaceSeconds(gps.paceSecPerMile)} size="lg" />
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

      <footer className="p-3">
        {!session && (
          <>
            <div className="mb-2 flex justify-end">
              <button
                onClick={onOpenHistory}
                className="rounded-lg px-3 py-2 text-sm font-bold text-muted underline-offset-4"
              >
                History
              </button>
            </div>
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
                onClick={() => {
                  if (ride.hasUsableFix || startArmed) {
                    setStartArmed(false);
                    ride.start();
                  } else {
                    setStartArmed(true);
                  }
                }}
                className={`h-[76px] flex-[2] rounded-2xl text-2xl font-black tracking-wide active:opacity-80 ${
                  startArmed ? 'bg-hold text-hold-ink' : 'bg-go text-go-ink'
                }`}
              >
                {startArmed ? 'NO GPS — START?' : 'START'}
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
            {paused && (
              <button
                onClick={onOpenPicker}
                className="h-[76px] flex-1 rounded-2xl border-2 border-line text-base font-bold text-ink active:bg-raised"
              >
                WORKOUT
              </button>
            )}
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
              {finishArmed ? `CONFIRM ${armSecondsLeft}` : 'FINISH'}
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
