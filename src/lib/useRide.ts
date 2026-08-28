import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendFixes,
  dbUnavailable,
  deleteWorkout as dbDeleteWorkout,
  findUnfinishedSession,
  forgetLiveSession,
  getFixes,
  pruneOldFixes,
  rememberLiveSession,
  listWorkouts,
  putSession,
  putWorkout,
} from './db';
import {
  ACCURACY_GATE_M,
  DEFAULT_SMOOTHING_MS,
  DROPOUT_MS,
  GpsEngine,
  type GpsSnapshot,
} from './gpsEngine';
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
  type CueName,
} from './audio';
import {
  completedSegments,
  computeAutoAdvance,
  currentIndex,
  currentSegment,
} from './segments';
import { elapsedMs, wallClockAfter, type RawFix, type SessionRecord } from './types';
import { metersToMiles, sanePaceSecPerMile } from './units';

/** Pace to speak, or nothing — the same gate the display and the CSV use. */
function spokenPaceFor(meters: number, ms: number): string | null {
  return speakablePace(sanePaceSecPerMile(meters, ms));
}
import { PRESET_WORKOUTS, resolveWorkout, type WorkoutDef } from './workouts';
import { loadMode, saveMode, type RideMode } from './mode';
import { applyTheme, loadTheme, type Theme } from './theme';
import {
  boundaryPhrases,
  DEFAULT_SPEECH,
  speakablePace,
  SpeechEngine,
  spokenSegmentName,
  type SpeechSettings,
} from './speech';
import { WakeLockManager, type WakeLockState } from './wakeLock';
import {
  DEFAULT_TOLERANCE_SEC,
  deviation,
  OffTargetWatcher,
  type OffTargetDirection,
} from './offTarget';

export type SourceKind = 'geo' | 'sim' | 'replay';

// Fast enough that a second flips within a tenth of when it truly does, so the
// countdown and the stopwatch visibly change on the same beat.
const TICK_MS = 100;

/**
 * The count-in before a session starts. Three seconds is the length of the
 * beeps already used at every segment boundary, so the start sounds like the
 * rest of the app rather than like a new thing to learn.
 */
export const COUNTDOWN_MS = 3000;

/**
 * How late the count-in may fire and still start the session. The tick runs at
 * 100ms with the screen awake, so this only trips if the phone suspended JS
 * mid-count — and starting a session whose clock began minutes ago, with
 * nobody running, would be worse than making him tap again.
 */
const COUNTDOWN_STALE_MS = 2000;
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
  const [speech, setSpeech] = useState<SpeechSettings>(DEFAULT_SPEECH);
  const [toleranceSec, setToleranceSec] = useState(DEFAULT_TOLERANCE_SEC);
  /** Bumped to force cues to be re-scheduled after a suspend or interruption. */
  const [cueEpoch, setCueEpoch] = useState(0);
  const [customWorkouts, setCustomWorkouts] = useState<WorkoutDef[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  /** Outdoor or treadmill. Remembered, because it rarely changes day to day. */
  const [mode, setModeState] = useState<RideMode>(() => loadMode());
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true);
  const [wakeLockState, setWakeLockState] = useState<WakeLockState>('released');
  /** An unfinished session found in storage on load, awaiting resume/discard. */
  const [resumable, setResumable] = useState<SessionRecord | null>(null);
  /**
   * The instant the count-in ends, which is also the instant the session
   * begins. A stored instant rather than a counter: the beeps, the number on
   * screen and `startedAt` all derive from this one moment, so they cannot
   * drift apart, and a phone that slept through the count is detectable.
   */
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);

  // Refs mirror state for the callbacks that live outside React's render cycle
  // (the position source, the tick loop, the persistence loop).
  const sessionRef = useRef<SessionRecord | null>(null);
  const simConfigRef = useRef(simConfig);
  const suspendedRef = useRef(false);
  const memLog = useRef<RawFix[]>([]);
  const fixBuffer = useRef<RawFix[]>([]);
  /** Late-bound so the tick loop and the fix handler can both drive it. */
  const advanceRef = useRef<() => void>(() => {});
  /** Late-bound: the visibility handler may need to restart a dead watch. */
  const startSourceRef = useRef<() => void>(() => {});
  /** Late-bound so the tick can drive the off-target check. */
  const offTargetRef = useRef<(now: number) => void>(() => {});
  const beeps = useRef(new BeepEngine()).current;
  const voice = useRef(new SpeechEngine()).current;
  const offTarget = useRef(new OffTargetWatcher()).current;
  /** Whole miles already announced this session, so each is called once. */
  const milesCalled = useRef(0);
  const wakeLock = useRef(new WakeLockManager()).current;
  /** Fixes captured while warming up, before a session exists. */
  const warmupLog = useRef<RawFix[]>([]);
  /** Mirrors countdownEndsAt for the tick loop, which lives outside render. */
  const countdownRef = useRef<number | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const gpsRef = useRef(gps);
  gpsRef.current = gps;
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

  const applySpeech = useCallback(
    (next: SpeechSettings) => {
      voice.settings = next;
      setSpeech(next);
    },
    [voice],
  );

  const previewSpeech = useCallback(
    (text: string) => {
      voice.warm();
      voice.say(text);
    },
    [voice],
  );

  const previewCue = useCallback(
    (cue: CueName) => beeps.preview(cue),
    [beeps],
  );

  useEffect(() => {
    wakeLock.onChange = () => setWakeLockState(wakeLock.state);
    setWakeLockState(wakeLock.supported ? wakeLock.state : 'unsupported');
    return () => {
      wakeLock.onChange = null;
    };
  }, [wakeLock]);

  // Hold the lock exactly while a session is live; drop it the moment it isn't,
  // so a finished workout can't keep the screen burning in a pocket.
  const sessionLive = !!session && session.status !== 'finished';
  useEffect(() => {
    if (sessionLive && wakeLockEnabled) void wakeLock.acquire();
    else void wakeLock.release();
  }, [sessionLive, wakeLockEnabled, wakeLock]);

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
      // Mile splits, free runs only — a workout announces its own segments.
      if (rec?.status === 'running' && !rec.workout) {
        const whole = Math.floor(metersToMiles(engine.distanceMeters));
        if (whole > milesCalled.current) {
          milesCalled.current = whole;
          beeps.play('mile');
          const pace = spokenPaceFor(engine.distanceMeters, elapsedMs(rec, receivedAt));
          window.setTimeout(
            () => voice.say(`Mile ${whole}${pace ? `, ${pace}` : ''}`),
            400,
          );
        }
      }
      setError(null);
      setGps(engine.snapshot(receivedAt));
      // A distance segment can only end on a fix, so check here as well as on
      // the tick — otherwise the boundary waits up to 250ms for no reason.
      advanceRef.current();
    },
    [engine, beeps, voice],
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
    // Indoors there is nothing to watch. Refusing here rather than at each call
    // site is what keeps a treadmill session from ever prompting for location:
    // the visibility handler and the resume path both come through this.
    if (modeRef.current === 'indoor') {
      shouldRun.current = false;
      return;
    }
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

  startSourceRef.current = startSource;

  /**
   * Switching to indoor stops the watch there and then: the point of the mode
   * is that the treadmill session never touches the GPS, and leaving a live
   * watch running would keep draining the battery for readings nobody shows.
   * It can only be changed between sessions, so no live session is disturbed.
   */
  const setMode = useCallback(
    (next: RideMode) => {
      modeRef.current = next;
      setModeState(next);
      saveMode(next);
      if (next === 'indoor') {
        stopSource();
        engine.resetForSession();
        setGps(engine.snapshot(Date.now()));
        setError(null);
      }
    },
    [engine, stopSource],
  );

  /**
   * Picking a source is itself a user gesture, so it both swaps and starts the
   * watch — which is also the moment iOS will accept a permission request.
   */
  const setSourceKind = useCallback(
    (kind: SourceKind) => {
      // Asking for a source — real, simulated or replayed — is asking to
      // measure, which indoor mode is the refusal of. The dev panel would
      // otherwise pick a simulator that silently never starts.
      setMode('outdoor');
      engine.dropAnchor();
      shouldRun.current = true;
      setSourceKindState(kind);
    },
    [engine, setMode],
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
      settleRef.current(t);
      advanceRef.current();
      offTargetRef.current(t);
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
      voice.recover();
      setCueEpoch((e) => e + 1);
      // iOS also releases the wake lock on background and never returns it.
      void wakeLock.reacquire();
      // And it may have quietly killed watchPosition. If no fix has arrived for
      // well past the dropout window, assume the watch is dead and restart it.
      const last = engine.snapshot(t).lastFixAt;
      if (shouldRun.current && last != null && t - last > DROPOUT_MS * 2) {
        startSourceRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [engine, beeps, voice, wakeLock]);

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
        lastSeenAt: Date.now(),
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
    const sessionId = session.id;
    const metaId = setInterval(() => persistNow(), PERSIST_MS);
    const fixId = setInterval(() => {
      const batch = fixBuffer.current;
      if (batch.length === 0) return;
      fixBuffer.current = [];
      void appendFixes(sessionId, batch);
    }, FIX_FLUSH_MS);
    return () => {
      clearInterval(metaId);
      clearInterval(fixId);
    };
    // Keyed on identity and status only: depending on the whole record tore
    // down and rebuilt both intervals on every segment boundary.
  }, [session?.id, session?.status, persistNow]);

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

  /**
   * Begin the session for real. `at` is the instant it started, which is the
   * end of the count-in rather than "now" — a stored instant, so the clock is
   * right even if the tick that noticed was a fraction late.
   */
  const startAt = useCallback(
    (at: number) => {
      engine.resetForSession();
      offTarget.resetAll();
      milesCalled.current = 0;
      // Carry the warm-up fixes in so the log covers the standstill too.
      memLog.current = [...warmupLog.current];
      fixBuffer.current = [...warmupLog.current];
      warmupLog.current = [];
      const rec: SessionRecord = {
        id: makeId(at),
        createdAt: at,
        startedAt: at,
        pauses: [],
        finishedAt: null,
        status: 'running',
        distanceMeters: 0,
        fixCount: 0,
        source: sourceKind,
        mode,
        // Flattened here, once, so the engine only ever walks a flat array.
        workout: selectedWorkout ? resolveWorkout(selectedWorkout) : null,
        boundaries: [{ at, distanceMeters: 0 }],
        lastSeenAt: at,
      };
      sessionRef.current = rec;
      setSession(rec);
      rememberLiveSession(rec.id);
      void putSession(rec);
      if (!sourceRef.current) startSource();
    },
    [engine, offTarget, sourceKind, startSource, selectedWorkout, mode],
  );

  /**
   * The count-in: three beeps and then the long boundary tone. Tones only —
   * the beeps already say "three, two, one, go" in the app's own vocabulary,
   * and a spoken word on top of the start tone is one thing too many at the
   * moment he is clipping in and looking up.
   *
   * Two things are unlocked here rather than at the start proper, both because
   * iOS grants them only inside the tap itself: the audio pipeline, and
   * location. Asking for the fix now also means it is settling during the
   * count-in instead of the session starting cold.
   */
  const beginCountdown = useCallback(() => {
    if (sessionRef.current || countdownRef.current != null) return;
    beeps.init();
    voice.warm();
    // No-op indoors, and harmless if the watch is already running.
    if (!sourceRef.current) startSource();
    const endsAt = Date.now() + COUNTDOWN_MS;
    countdownRef.current = endsAt;
    setCountdownEndsAt(endsAt);
    // "3" is now, so it plays rather than schedules — a cue whose moment has
    // already arrived is skipped by the scheduler, by design.
    beeps.play('countdown');
    beeps.scheduleAt('countdown', endsAt - 2000);
    beeps.scheduleAt('countdown', endsAt - 1000);
    beeps.scheduleAt('boundary', endsAt);
  }, [beeps, voice, startSource]);

  /** Back out of a count-in. A mis-tapped START must not cost a session. */
  const cancelCountdown = useCallback(() => {
    if (countdownRef.current == null) return;
    countdownRef.current = null;
    setCountdownEndsAt(null);
    beeps.cancelPending();
  }, [beeps]);

  /**
   * Driven from the tick, so the count-in ends on wall-clock time like every
   * other deadline in the app.
   */
  const settleCountdown = useCallback(
    (now: number) => {
      const endsAt = countdownRef.current;
      if (endsAt == null || now < endsAt) return;
      countdownRef.current = null;
      setCountdownEndsAt(null);
      if (now - endsAt > COUNTDOWN_STALE_MS) {
        // The phone slept through the count. Starting now would date the
        // session to a moment nobody was running; make him tap again instead.
        beeps.cancelPending();
        return;
      }
      startAt(endsAt);
    },
    [startAt, beeps],
  );
  const settleRef = useRef(settleCountdown);
  settleRef.current = settleCountdown;

  const pause = useCallback(() => {
    // Drop the anchor so the stopped stretch never gets bridged into distance.
    engine.dropAnchor();
    offTarget.reset();
    update((rec) =>
      rec.status !== 'running'
        ? rec
        : { ...rec, status: 'paused', pauses: [...rec.pauses, { start: Date.now(), end: null }] },
    );
  }, [engine, update, offTarget]);

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
    forgetLiveSession();
    stopSource();
  }, [update, stopSource, beeps]);

  /**
   * Records the boundary the schedule says we've already crossed. Timed
   * segments are placed at their exact instant, so a phone that slept through
   * a rest lands on the correct segment rather than one behind.
   */
  /**
   * Say what just finished and what has begun.
   *
   * Delayed past the 1.5s boundary tone so the two don't talk over each other,
   * on a plain timeout — speech can't be scheduled on the audio clock, and if
   * a backgrounded tab drops it, the beeps already carried the message.
   */
  const announceBoundary = useCallback(
    (rec: SessionRecord, closedIndex: number) => {
      if (!voice.settings.enabled || !audioRef.current.enabled) return;
      const rows = completedSegments(rec, Date.now(), engine.distanceMeters);
      const closed = rows[closedIndex];
      const closedSeg = rec.workout?.segments[closedIndex] ?? null;
      const nextSeg = rec.workout?.segments[closedIndex + 1] ?? null;
      const phrases = boundaryPhrases(
        closed
          ? {
              durationMs: closed.durationMs,
              paceSecPerMile: sanePaceSecPerMile(closed.distanceMeters, closed.durationMs),
              // A rep inside a set is not reported; only what comes next is.
              inRepeat: closedSeg?.repeatIndex != null,
            }
          : null,
        nextSeg ? spokenSegmentName(nextSeg) : null,
      );
      if (phrases.length === 0) return;
      window.setTimeout(() => {
        for (const phrase of phrases) voice.say(phrase);
      }, 1700);
    },
    [engine, voice],
  );

  const maybeAdvance = useCallback(() => {
    const rec = sessionRef.current;
    if (!rec || rec.status !== 'running' || !rec.workout) return;
    const add = computeAutoAdvance(rec, Date.now(), engine.distanceMeters);
    if (add.length === 0) return;
    // A timed segment's boundary beep was scheduled in advance. A distance
    // segment has no knowable end time, so it can only be sounded on arrival.
    if (currentSegment(rec)?.end.type === 'distance') beeps.play('boundary');
    const closedIndex = currentIndex(rec);
    offTarget.reset();
    update((r) => ({ ...r, boundaries: [...r.boundaries, ...add] }));
    announceBoundary(rec, closedIndex);
  }, [engine, update, beeps, announceBoundary, offTarget]);

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
    const closedIndex = currentIndex(rec);
    update((r) => ({
      ...r,
      boundaries: [...r.boundaries, { at: Date.now(), distanceMeters: engine.distanceMeters }],
    }));
    announceBoundary(rec, closedIndex);
  }, [engine, update, beeps, announceBoundary]);

  /**
   * On load, look for a session that never reached `finished`. The record
   * carries its own timestamps, so elapsed time survives the reload exactly;
   * distance and fix count come back off the persisted record, and the raw log
   * is re-read from IndexedDB so an export still covers the whole session.
   */
  useEffect(() => {
    void findUnfinishedSession().then((rec) => {
      if (rec && !sessionRef.current) setResumable(rec);
      // Only once the resume question is settled, and never with a session
      // live: pruning mid-ride is exactly the risk it exists to avoid.
      if (!rec) void pruneOldFixes();
    });
  }, []);

  const resumeSession = useCallback(async () => {
    const rec = resumable;
    if (!rec) return;
    setResumable(null);
    engine.resetForSession(rec.distanceMeters);
    memLog.current = await getFixes(rec.id);
    fixBuffer.current = [];
    warmupLog.current = [];
    // Come back paused, and treat everything since the last heartbeat as
    // paused too: the app was dead for that stretch, so it is not workout time.
    const t = Date.now();
    const pauses =
      rec.status === 'paused'
        ? rec.pauses
        : [...rec.pauses, { start: Math.min(rec.lastSeenAt, t), end: null }];
    const revived: SessionRecord = { ...rec, status: 'paused', pauses, lastSeenAt: t };
    sessionRef.current = revived;
    setSession(revived);
    rememberLiveSession(revived.id);
    void putSession(revived);
    beeps.init();
    // The record decides, not the current toggle: resuming a treadmill session
    // must not start a watch, and resuming an outdoor one must.
    if (rec.mode) setMode(rec.mode);
    if (!sourceRef.current) startSourceRef.current();
  }, [resumable, engine, beeps, setMode]);

  const discardResumable = useCallback(async () => {
    const rec = resumable;
    setResumable(null);
    forgetLiveSession();
    if (!rec) return;
    // Mark it finished rather than deleting: the ride happened, and its raw
    // log is still worth having.
    await putSession({ ...rec, status: 'finished', finishedAt: rec.finishedAt ?? Date.now() });
    void pruneOldFixes();
  }, [resumable]);

  /**
   * Swap the workout of a session that is already underway.
   *
   * Only while paused — never mid-rep — because the boundary list is replaced
   * wholesale with a single boundary at this instant, so the new workout starts
   * clean. Elapsed time, distance and the raw log are untouched: they belong to
   * the session, not to the workout. Picking the wrong workout in the dark
   * otherwise costs the whole session.
   */
  const swapWorkout = useCallback(
    (w: WorkoutDef | null) => {
      const rec = sessionRef.current;
      if (!rec || rec.status !== 'paused') return;
      beeps.cancelPending();
      update((r) => ({
        ...r,
        workout: w ? resolveWorkout(w) : null,
        boundaries: [{ at: Date.now(), distanceMeters: engine.distanceMeters }],
      }));
    },
    [engine, update, beeps],
  );

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

  /**
   * The current segment's goal pace, and which side of the band we're on right
   * now. The band verdict is instantaneous — it drives colour and wording, and
   * needs no hold; only the *warning* waits five seconds.
   */
  const targetPaceSec = session ? (currentSegment(session)?.targetPaceSecPerMile ?? null) : null;
  const paceDeviation: OffTargetDirection | null = deviation(
    gps.paceSecPerMile,
    targetPaceSec,
    toleranceSec,
  );

  /**
   * A fix arrived recently and was accurate enough to move the odometer. START
   * asks for confirmation without one, because a distance segment started cold
   * measures from a position that isn't known yet.
   */
  const hasUsableFix =
    mode === 'indoor' ||
    (!gps.stale && gps.accuracy != null && gps.accuracy <= ACCURACY_GATE_M);

  /**
   * Off-target warning: a distinct falling beep, then a word. Only while
   * actually running, and only for a segment that has a target at all.
   */
  const checkOffTarget = useCallback(
    (now: number) => {
      const rec = sessionRef.current;
      if (!rec || rec.status !== 'running') return;
      const target = currentSegment(rec)?.targetPaceSecPerMile;
      const fired = offTarget.update(now, gpsRef.current.paceSecPerMile, target, toleranceSec);
      if (!fired) return;
      beeps.play('offTarget');
      // "ease up" for too fast, "pick it up" for too slow — the beep says
      // adjust, the word says which way.
      window.setTimeout(() => voice.say(fired === 'fast' ? 'Ease up' : 'Pick it up'), 500);
    },
    [offTarget, beeps, voice, toleranceSec],
  );
  offTargetRef.current = checkOffTarget;

  const elapsed = useMemo(
    () => (session ? elapsedMs(session, now) : 0),
    [session, now],
  );

  return {
    now,
    gps,
    session,
    elapsed,
    hasUsableFix,
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
    swapWorkout,
    customWorkouts,
    presetWorkouts: PRESET_WORKOUTS,
    saveWorkout,
    removeWorkout,
    theme,
    toggleTheme,
    mode,
    setMode,
    indoor: mode === 'indoor',
    wakeLockEnabled,
    setWakeLockEnabled,
    wakeLockState,
    wakeLockSupported: wakeLock.supported,
    resumable,
    resumeSession,
    discardResumable,
    audio,
    applyAudio,
    speech,
    applySpeech,
    toleranceSec,
    setToleranceSec,
    targetPaceSec,
    paceDeviation,
    previewSpeech,
    speechSupported: voice.supported,
    previewCue,
    audioReady: beeps.ready,
    audioState: beeps.state,
    start: beginCountdown,
    cancelCountdown,
    countdownEndsAt,
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
