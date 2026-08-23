import { useEffect, useRef, useState } from 'react';
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
import { DEV_REVEAL_TAPS, DEV_REVEAL_WINDOW_MS } from '../lib/devMode';
import { isIndoor } from '../lib/types';
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
 * The ride controls are a fixed three-up row, so each label has a third of the
 * width whatever the state. min-w-0 lets a button shrink rather than push its
 * neighbours out, and the column layout gives a two-line label somewhere to go.
 */
const CONTROL =
  'flex h-[76px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 text-center leading-none';

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

/**
 * Indoors there is no accuracy, no staleness and no dropout to report — the
 * chip says so plainly rather than showing a dead GPS readout all session.
 */
function IndoorChip() {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span className="rounded bg-info px-1.5 py-0.5 text-xs font-bold text-info-ink">
        INDOOR
      </span>
      <span className="text-muted">no GPS</span>
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
  devEnabled,
  onToggleDev,
  onOpenDev,
  onOpenPicker,
  onOpenHistory,
  onOpenGuide,
}: {
  ride: Ride;
  /** Whether the dev button is on offer at all. */
  devEnabled: boolean;
  /** The hidden gesture fired: reveal the button, or hide it again. */
  onToggleDev: () => void;
  onOpenDev: () => void;
  onOpenPicker: () => void;
  onOpenHistory: () => void;
  onOpenGuide: () => void;
}) {
  const { gps, session, elapsed } = ride;
  const [finishArmed, setFinishArmed] = useState(false);
  const [armSecondsLeft, setArmSecondsLeft] = useState(0);
  const [startArmed, setStartArmed] = useState(false);
  /*
   * The way back to the dev tools once the button is hidden. The status chip
   * is the right place for it: it is the one thing in the header that does
   * nothing when tapped, so a stray thumb costs nothing and a deliberate five
   * taps can't be mistaken for anything else.
   */
  const devTaps = useRef<number[]>([]);
  function countDevTap() {
    const t = Date.now();
    devTaps.current = [...devTaps.current.filter((x) => t - x < DEV_REVEAL_WINDOW_MS), t];
    if (devTaps.current.length >= DEV_REVEAL_TAPS) {
      devTaps.current = [];
      onToggleDev();
    }
  }

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
  // A live session's own mode wins over the toggle, which is only ever changed
  // between sessions — a resumed treadmill ride stays a treadmill ride.
  const indoor = session ? isIndoor(session) : ride.indoor;
  // Nothing is stale when nothing is being measured.
  const dim = gps.stale && !indoor ? 'opacity-40' : '';
  const paceTone =
    ride.paceDeviation === 'fast'
      ? 'text-too-fast'
      : ride.paceDeviation === 'slow'
        ? 'text-too-slow'
        : '';
  const workout = session?.workout ?? null;
  const sessionLive = !!session && session.status !== 'finished';
  // The most recently *closed* lap; the open one is still running.
  const closedLaps =
    session && !workout
      ? completedSegments(session, ride.now, gps.distanceMeters).filter((l) => !l.open)
      : [];
  const lastLap = closedLaps.at(-1);
  const atLastSegment =
    !!workout && !!session && currentIndex(session) >= workout.segments.length - 1;

  return (
    <div className="relative flex h-full flex-col bg-surface text-ink">
      <header className="flex items-center justify-between px-4 py-2">
        <div onClick={countDevTap}>
          {indoor ? <IndoorChip /> : <GpsChip ride={ride} />}
        </div>
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
          {devEnabled && !sessionLive && (
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
            stale={!indoor && gps.stale}
            acquiring={gps.acquiring}
            measuring={!indoor}
            /* Indoors the goal pace is a stat of its own below, and the
               verdict beside it could only ever read NO PACE. */
            band={indoor ? undefined : <TargetBand ride={ride} />}
          />
        ) : indoor ? (
          /* A free run on a treadmill has one honest big number: the clock. */
          <section className="flex flex-col items-center justify-center">
            <div className="text-[clamp(4.5rem,29vw,15rem)] leading-[0.9] font-black tracking-tight">
              {formatClock(elapsed)}
            </div>
            <div className="text-sm font-bold tracking-widest text-muted uppercase">
              elapsed
            </div>
            {session && (
              <div className="mt-2 rounded-full bg-raised px-4 py-1 text-sm font-bold">
                {lastLap ? (
                  <>
                    <span className="text-muted">LAP {lastLap.index + 1}</span>{' '}
                    {formatClock(lastLap.durationMs)}
                  </>
                ) : (
                  <span className="text-muted">0 LAPS</span>
                )}
              </div>
            )}
          </section>
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
          {/* Indoors every GPS-derived number is absent, not zero: no speed, no
              distance, no pace. What is left is what the treadmill can't tell
              him — the goal to dial in, and the clocks. */}
          {indoor ? (
            <div className="grid grid-cols-2 gap-2">
              {workout ? (
                <>
                  <Stat
                    label="target / mile"
                    value={formatPaceSeconds(ride.targetPaceSec)}
                    size="lg"
                  />
                  <Stat label="total time" value={formatClock(elapsed)} size="lg" />
                </>
              ) : (
                <>
                  <Stat label="laps" value={String(closedLaps.length)} size="lg" />
                  <Stat
                    label="last lap"
                    value={lastLap ? formatClock(lastLap.durationMs) : '--:--'}
                    size="lg"
                  />
                </>
              )}
            </div>
          ) : (
            <>
              {/* With a workout loaded the countdown owns the hero, so pace moves
                  here — still the largest thing after the segment clock. */}
              <div className="grid grid-cols-2 gap-2">
                {workout ? (
                  <>
                    <div className={`${dim} ${paceTone}`}>
                      <Stat
                        label="min / mile"
                        value={formatPaceSeconds(gps.paceSecPerMile)}
                        size="lg"
                      />
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
            </>
          )}
        </section>
      </main>

      <footer className="p-3">
        {!session && (
          <>
            <div className="mb-2 flex justify-end gap-1">
              <button
                onClick={onOpenGuide}
                className="rounded-lg px-3 py-2 text-sm font-bold text-muted"
              >
                How it works
              </button>
              <button
                onClick={onOpenHistory}
                className="rounded-lg px-3 py-2 text-sm font-bold text-muted underline-offset-4"
              >
                History
              </button>
            </div>
            <div className="mb-2 flex gap-2">
              {/* Where the session happens decides whether the phone measures
                  anything at all, so it is chosen here, before START, and not
                  buried in the dev panel. */}
              {(['outdoor', 'indoor'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => ride.setMode(m)}
                  aria-pressed={ride.mode === m}
                  className={`h-[48px] flex-1 rounded-xl border-2 text-sm font-black tracking-widest uppercase ${
                    ride.mode === m
                      ? 'border-next bg-next text-next-ink'
                      : 'border-line text-muted active:bg-raised'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {indoor && (
              <div className="mb-2 rounded-xl bg-raised px-3 py-2 text-xs font-semibold text-muted">
                Treadmill: no GPS, no distance and no measured pace. Segment
                timing, goal paces and the cues all still run.
              </div>
            )}
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
              {/* Nothing to warm up indoors. */}
              {!indoor && (
                <button
                  onClick={ride.gpsActive ? ride.stopSource : ride.startSource}
                  className="h-[76px] flex-1 rounded-2xl border-2 border-line text-base font-bold text-ink active:bg-raised"
                >
                  {ride.gpsActive ? 'GPS ON' : 'WARM UP GPS'}
                </button>
              )}
            </div>
          </>
        )}

        {session && session.status !== 'finished' && (
          <>
            {/* Sat at the vertical center of the screen, where it covered
                whichever number was underneath it. It belongs with the button
                that clears it. */}
            {paused && (
              <div className="mb-2 flex justify-center">
                <span className="rounded-full bg-hold px-4 py-1 text-sm font-black tracking-widest text-hold-ink uppercase">
                  paused
                </span>
              </div>
            )}
            {/* Changing the workout is not one of the ride controls, and made
                the row below a four-up: at that width every label wrapped
                inside its own button — "CONFIRM 4" split across two lines. */}
            {paused && (
              <button
                onClick={onOpenPicker}
                className="mb-2 h-[56px] w-full rounded-2xl border-2 border-line text-base font-bold text-ink active:bg-raised"
              >
                CHANGE WORKOUT
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={running ? ride.pause : ride.resume}
                className={`${CONTROL} text-xl font-black tracking-wide ${
                  running ? 'bg-hold text-hold-ink' : 'bg-go text-go-ink'
                }`}
              >
                {running ? 'PAUSE' : 'RESUME'}
              </button>
              <button
                onClick={ride.nextSegment}
                disabled={atLastSegment}
                className={`${CONTROL} bg-next text-xl font-black tracking-wide text-next-ink active:opacity-80 disabled:opacity-30`}
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
                className={`${CONTROL} text-base font-black ${
                  finishArmed
                    ? 'bg-stop text-stop-ink'
                    : 'border-2 border-line text-ink active:bg-raised'
                }`}
              >
                {finishArmed ? (
                  <>
                    <span>CONFIRM</span>
                    {/* On its own line: beside the word it pushed the label
                        into a wrap on a narrow phone. */}
                    <span className="mt-1 text-xs font-bold">{armSecondsLeft}s</span>
                  </>
                ) : (
                  'FINISH'
                )}
              </button>
            </div>
          </>
        )}

      </footer>

    </div>
  );
}
