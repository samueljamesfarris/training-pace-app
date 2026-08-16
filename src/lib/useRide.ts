import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendFixes,
  dbUnavailable,
  deleteWorkout as dbDeleteWorkout,
  getFixes,
  listWorkouts,
  putSession,
  putWorkout,
} from './db';
import { DEFAULT_SMOOTHING_MS, GpsEngine, type GpsSnapshot } from './gpsEngine';
import {
  DEFAULT_SIM,
  GeoSource,
  ReplaySource,
  SimSource,
  type PositionSource,
  type SimConfig,
} from './sources';
import {
  BeepEngine,
  COUNTDOWN_AT_SEC,
  DEFAULT_AUDIO,
  WARNING_AT_SEC,
  type AudioSettings,
} from './audio';
import { computeAutoAdvance, currentIndex, currentSegment } from './segments';
import { elapsedMs, wallClockAfter, type RawFix, type SessionRecord } from './types';
import { PRESET_WORKOUTS, resolveWorkout, type WorkoutDef } from './workouts';
import { applyTheme, loadTheme, type Theme } from './theme';

export type SourceKind = 'geo' | 'sim' | 'replay';

// Fast enough that a second flips within a tenth of when it truly does, so the
// countdown and the stopwatch visibly change on the same beat.
const TICK_MS = 100;
const PERSIST_MS = 1000;
const FIX_FLUSH_MS = 2000;

function makeId(t: number) {
  return `${new Date(t).toISOString().replace(/[:.]/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function useRide() {
  const engine = useRef(new GpsEngine()).current;
  const sourceRef = useRef<PositionSource | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [gps, setGps] = useState<GpsSnapshot>(() => engine.snapshot(Date.now()));
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  const [sourceKind, setSourceKindState] = useState<SourceKind>('geo');
  const [simConfig, setSimConfig] = useState<SimConfig>(DEFAULT_SIM);
  const [replayFixes, setReplayFixes] = useState<RawFix[]>([]);
  const [replayRate, setReplayRate] = useState(1);
  const [smoothingMs, setSmoothingMsState] = useState(DEFAULT_SMOOTHING_MS);
  const [suspended, setSuspended] = useState(false);
  /** Chosen before the session starts; flattened into the record on start. */
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutDef | null>(null);
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO);
  /** Bumped to force cues to be re-scheduled after a suspend or interruption. */
  const [cueEpoch, setCueEpoch] = useState(0);
  const [customWorkouts, setCustomWorkouts] = useState<WorkoutDef[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());

  // Refs mirror state for the callbacks that live outside React's render cycle
  // (the position source, the tick loop, the persistence loop).
  const sessionRef = useRef<SessionRecord | null>(null);
  const simConfigRef = useRef(simConfig);
  const suspendedRef = useRef(false);
  const memLog = useRef<RawFix[]>([]);
  const fixBuffer = useRef<RawFix[]>([]);
  /** Late-bound so the tick loop and the fix handler can both drive it. */
  const advanceRef = useRef<() => void>(() => {});
  const beeps = useRef(new BeepEngine()).current;
  /** Fixes captured while warming up, before a session exists. */
  const warmupLog = useRef<RawFix[]>([]);

  sessionRef.current = session;
  simConfigRef.current = simConfig;
  suspendedRef.current = suspended;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const applyAudio = useCallback(
    (next: AudioSettings) => {
      beeps.settings = next;
      beeps.setVolume(next.volume);
      setAudio(next);
      setCueEpoch((e) => e + 1);
    },
    [beeps],
  );

  const previewCue = useCallback(
    (cue: 'warning' | 'countdown' | 'boundary' | 'lap') => beeps.preview(cue),
    [beeps],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    void listWorkouts().then((ws) =>
      setCustomWorkouts(ws.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))),
    );
  }, []);

  const saveWorkout = useCallback(async (w: WorkoutDef) => {
    const stamped = { ...w, builtIn: false, updatedAt: Date.now() };
    await putWorkout(stamped);
    setCustomWorkouts((list) => {
      const rest = list.filter((x) => x.id !== stamped.id);
      return [stamped, ...rest];
    });
    return stamped;
  }, []);

  const removeWorkout = useCallback(async (id: string) => {
    await dbDeleteWorkout(id);
    setCustomWorkouts((list) => list.filter((x) => x.id !== id));
    setSelectedWorkout((w) => (w?.id === id ? null : w));
  }, []);

  const setSmoothingMs = useCallback(
    (ms: number) => {
      engine.setSmoothingMs(ms);
      setSmoothingMsState(ms);
    },
    [engine],
  );

  const handleFix = useCallback(
    (fix: RawFix) => {
      const receivedAt = Date.now();
      // While the simulated suspension is on, pretend JS isn't running at all.
      if (suspendedRef.current) return;
      const rec = sessionRef.current;
      engine.accumulating = rec?.status === 'running';
      engine.ingest(fix, receivedAt);
      if (rec && rec.status !== 'finished') {
        memLog.current.push(fix);
        fixBuffer.current.push(fix);
      } else if (!rec) {
        // Warm-up fixes matter: standing still is exactly the case worth
        // studying, and it happens before the session starts. Keep a bounded
        // buffer and fold it into the session on start.
        warmupLog.current.push(fix);
        if (warmupLog.current.length > 1200) warmupLog.current.shift();
      }
      setError(null);
      setGps(engine.snapshot(receivedAt));
      // A distance segment can only end on a fix, so check here as well as on
      // the tick — otherwise the boundary waits up to 250ms for no reason.
      advanceRef.current();
    },
    [engine],
  );

  // Whether a watch *should* be running. Kept in a ref so the restart effect
  // can consult it without re-running on every state change.
  const shouldRun = useRef(false);

  const stopSource = useCallback(() => {
    shouldRun.current = false;
    sourceRef.current?.stop();
    sourceRef.current = null;
    setGpsActive(false);
  }, []);

  const startSource = useCallback(() => {
    shouldRun.current = true;
    sourceRef.current?.stop();
    let src: PositionSource;
    if (sourceKind === 'geo') src = new GeoSource();
    else if (sourceKind === 'sim') src = new SimSource(() => simConfigRef.current);
    else src = new ReplaySource(replayFixes, replayRate, () => setError('Replay finished.'));
    sourceRef.current = src;
    src.start(handleFix, (msg) => setError(msg));
    setGpsActive(true);
  }, [sourceKind, replayFixes, replayRate, handleFix]);

  /**
   * Picking a source is itself a user gesture, so it both swaps and starts the
   * watch — which is also the moment iOS will accept a permission request.
   */
  const setSourceKind = useCallback(
    (kind: SourceKind) => {
      engine.dropAnchor();
      shouldRun.current = true;
      setSourceKindState(kind);
    },
    [engine],
  );

  // Restart whenever the source's identity changes (kind, replay log, rate),
  // but never start one unbidden — that would prompt for location without a tap.
  useEffect(() => {
    if (shouldRun.current) startSource();
  }, [startSource]);

  useEffect(() => () => sourceRef.current?.stop(), []);

  // Render tick. Every displayed time is recomputed from timestamps here; this
  // interval only decides *when* we repaint, never what the numbers are.
  useEffect(() => {
    const id = setInterval(() => {
      if (suspendedRef.current) return;
      const t = Date.now();
      setNow(t);
      setGps(engine.snapshot(t));
      advanceRef.current();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [engine]);

  // Coming back to the foreground: repaint immediately from wall-clock time.
  // (Full reconciliation — wake lock, watch restart, audio re-warm — is step 2.)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const t = Date.now();
      setNow(t);
      setGps(engine.snapshot(t));
      // iOS suspends the AudioContext in the background, which silently drops
      // anything already scheduled. Resume it and lay the cues down again.
      void beeps.resume();
      setCueEpoch((e) => e + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [engine, beeps]);

  const persistNow = useCallback(
    (override?: Partial<SessionRecord>) => {
      const rec = sessionRef.current;
      if (!rec) return;
      // The engine is the authority on distance and fix count; `override`
      // carries status and pause edits. Engine values go last so a status
      // change can never write a stale odometer over the real one.
      const merged: SessionRecord = {
        ...rec,
        ...override,
        distanceMeters: engine.distanceMeters,
        fixCount: engine.fixCount,
      };
      void putSession(merged).then(() => {
        if (dbUnavailable) setPersistError(dbUnavailable);
      });
    },
    [engine],
  );

  // Persist session meta every second and flush buffered raw fixes every two.
  useEffect(() => {
    if (!session || session.status === 'finished') return;
    const metaId = setInterval(() => persistNow(), PERSIST_MS);
    const fixId = setInterval(() => {
      const batch = fixBuffer.current;
      if (batch.length === 0) return;
      fixBuffer.current = [];
      void appendFixes(session.id, batch);
    }, FIX_FLUSH_MS);
    return () => {
      clearInterval(metaId);
      clearInterval(fixId);
    };
  }, [session, persistNow]);

  const update = useCallback(
    (fn: (rec: SessionRecord) => SessionRecord) => {
      const rec = sessionRef.current;
      if (!rec) return;
      const next = fn(rec);
      sessionRef.current = next;
      setSession(next);
      persistNow(next);
    },
    [persistNow],
  );

  const start = useCallback(() => {
    engine.resetForSession();
    beeps.init();
    // Carry the warm-up fixes in so the log covers the standstill too.
    memLog.current = [...warmupLog.current];
    fixBuffer.current = [...warmupLog.current];
    warmupLog.current = [];
    const t = Date.now();
    const rec: SessionRecord = {
      id: makeId(t),
      createdAt: t,
      startedAt: t,
      pauses: [],
      finishedAt: null,
      status: 'running',
      distanceMeters: 0,
      fixCount: 0,
      source: sourceKind === 'geo' ? 'geo' : 'sim',
      // Flattened here, once, so the engine only ever walks a flat array.
      workout: selectedWorkout ? resolveWorkout(selectedWorkout) : null,
      boundaries: [{ at: t, distanceMeters: 0 }],
    };
    sessionRef.current = rec;
    setSession(rec);
    void putSession(rec);
    if (!sourceRef.current) startSource();
  }, [engine, beeps, sourceKind, startSource, selectedWorkout]);

  const pause = useCallback(() => {
    // Drop the anchor so the stopped stretch never gets bridged into distance.
    engine.dropAnchor();
    update((rec) =>
      rec.status !== 'running'
        ? rec
        : { ...rec, status: 'paused', pauses: [...rec.pauses, { start: Date.now(), end: null }] },
    );
  }, [engine, update]);

  const resume = useCallback(() => {
    engine.dropAnchor();
    update((rec) => {
      if (rec.status !== 'paused') return rec;
      const pauses = rec.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last.end == null) pauses[pauses.length - 1] = { ...last, end: Date.now() };
      return { ...rec, status: 'running', pauses };
    });
  }, [engine, update]);

  const finish = useCallback(() => {
    const t = Date.now();
    update((rec) => {
      const pauses = rec.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last.end == null) pauses[pauses.length - 1] = { ...last, end: t };
      return { ...rec, status: 'finished', finishedAt: t, pauses };
    });
    const batch = fixBuffer.current;
    fixBuffer.current = [];
    if (sessionRef.current) void appendFixes(sessionRef.current.id, batch);
    beeps.cancelPending();
    stopSource();
  }, [update, stopSource, beeps]);

  /**
   * Records the boundary the schedule says we've already crossed. Timed
   * segments are placed at their exact instant, so a phone that slept through
   * a rest lands on the correct segment rather than one behind.
   */
  const maybeAdvance = useCallback(() => {
    const rec = sessionRef.current;
    if (!rec || rec.status !== 'running' || !rec.workout) return;
    const add = computeAutoAdvance(rec, Date.now(), engine.distanceMeters);
    if (add.length === 0) return;
    // A timed segment's boundary beep was scheduled in advance. A distance
    // segment has no knowable end time, so it can only be sounded on arrival.
    if (currentSegment(rec)?.end.type === 'distance') beeps.play('boundary');
    update((r) => ({ ...r, boundaries: [...r.boundaries, ...add] }));
  }, [engine, update, beeps]);

  advanceRef.current = maybeAdvance;

  /**
   * Manual override: next segment in a workout, or a lap in a free run. Always
   * available, because he won't hit the distance exactly.
   */
  const nextSegment = useCallback(() => {
    const rec = sessionRef.current;
    if (!rec || rec.status === 'finished') return;
    if (rec.workout && currentIndex(rec) >= rec.workout.segments.length - 1) return;
    beeps.play(rec.workout ? 'boundary' : 'lap');
    update((r) => ({
      ...r,
      boundaries: [...r.boundaries, { at: Date.now(), distanceMeters: engine.distanceMeters }],
    }));
  }, [engine, update, beeps]);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    engine.resetForSession();
    memLog.current = [];
    setGps(engine.snapshot(Date.now()));
  }, [engine]);

  /** Freeze the JS loop for N seconds, then reconcile — the desk-side test of
   *  the timestamp timing model without backgrounding the browser. */
  const simulateBackground = useCallback(
    (seconds: number) => {
      setSuspended(true);
      window.setTimeout(() => {
        setSuspended(false);
        const t = Date.now();
        setNow(t);
        setGps(engine.snapshot(t));
        document.dispatchEvent(new Event('visibilitychange'));
      }, seconds * 1000);
    },
    [engine],
  );

  /** Raw fixes for this session — memory first, IndexedDB as the backstop. */
  const exportFixes = useCallback(async (): Promise<RawFix[]> => {
    if (memLog.current.length) return memLog.current;
    const rec = sessionRef.current;
    return rec ? await getFixes(rec.id) : [];
  }, []);

  /**
   * Lay down every cue for the current segment against the audio clock.
   *
   * Only timed segments can be scheduled ahead, because only they have a
   * knowable end instant — and that instant comes from the same wall-clock
   * arithmetic the display uses, so the beeps and the countdown can't disagree.
   * Distance segments sound their boundary on arrival instead.
   *
   * Re-runs whenever the segment, the run/pause state, or the audio settings
   * change, and whenever cueEpoch is bumped after a backgrounding.
   */
  useEffect(() => {
    beeps.cancelPending();
    const rec = sessionRef.current;
    if (!rec || rec.status !== 'running' || !rec.workout) return;

    const seg = currentSegment(rec);
    const start = rec.boundaries[currentIndex(rec)];
    if (!seg || !start || seg.end.type !== 'time') return;

    const boundaryAt = wallClockAfter(rec, start.at, seg.end.seconds * 1000);
    if (boundaryAt == null) return;

    if (seg.end.seconds > WARNING_AT_SEC) {
      beeps.scheduleAt('warning', boundaryAt - WARNING_AT_SEC * 1000);
    }
    for (const s of COUNTDOWN_AT_SEC) beeps.scheduleAt('countdown', boundaryAt - s * 1000);
    beeps.scheduleAt('boundary', boundaryAt);
  }, [
    beeps,
    cueEpoch,
    audio,
    session?.id,
    session?.status,
    session?.boundaries.length,
    session?.pauses.length,
  ]);

  const elapsed = useMemo(
    () => (session ? elapsedMs(session, now) : 0),
    [session, now],
  );

  return {
    now,
    gps,
    session,
    elapsed,
    gpsActive,
    error,
    persistError,
    suspended,
    sourceKind,
    setSourceKind,
    simConfig,
    setSimConfig,
    replayFixes,
    setReplayFixes,
    replayRate,
    setReplayRate,
    smoothingMs,
    setSmoothingMs,
    startSource,
    stopSource,
    selectedWorkout,
    setSelectedWorkout,
    customWorkouts,
    presetWorkouts: PRESET_WORKOUTS,
    saveWorkout,
    removeWorkout,
    theme,
    toggleTheme,
    audio,
    applyAudio,
    previewCue,
    audioReady: beeps.ready,
    audioState: beeps.state,
    start,
    pause,
    resume,
    finish,
    nextSegment,
    clearSession,
    simulateBackground,
    exportFixes,
  };
}

export type Ride = ReturnType<typeof useRide>;
