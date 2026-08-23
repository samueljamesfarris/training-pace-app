# Working on this repo

A phone-only GPS pacing app. Sam rides a bike alongside his son's running
workouts with the phone on the handlebars, often before sunrise; sometimes he
runs carrying it instead. The phone is the entire system — no watch, no sensors.
Full requirements are in `pace-app-spec.md`, which is the source of truth for
scope. `README.md` tracks what is actually built.

Active work plan: see PATCH-PLAN.md in the repo root.

**Reliability beats features.** A lost session, a stopwatch that drifts after a
notification, or a screen that sleeps mid-workout makes the app useless. Prefer
being correct and dull over clever.

## Invariants — do not break these

1. **All elapsed times derive from wall-clock timestamps, never from counted
   ticks.** iOS suspends JavaScript whenever the app backgrounds, so any timer
   built by accumulating intervals silently loses time. `elapsedMs()` and
   `segmentElapsedMs()` recompute from stored instants on every render. The
   render tick decides *when* to repaint, never *what* the numbers are.
2. **Segment boundaries are stored instants too.** `computeAutoAdvance` places a
   boundary at the exact moment it was due and can catch up several at once, so
   a phone that slept through a rest lands on the right segment.
3. **Never fabricate a reading.** On a GPS dropout the display freezes with a
   stale badge; distance does not bridge the gap. If a value can't be measured
   honestly, show `--:--`.
4. **Audio never takes the session down.** Same for IndexedDB — persistence
   failures surface as a banner and the workout continues.
5. **The service worker never calls `skipWaiting()` on its own.** Swapping
   bundles mid-workout is the one thing this app must not do.

## Architecture

- `src/lib/gpsEngine.ts` — the heart. Speed derivation, smoothing, spike gate,
  accuracy gate, dropout handling, movement detection, odometer, and all
  display stabilisation. Pure: no React, no formatting, no session concepts.
  Test this hardest.
- `src/lib/segments.ts` — the interval engine over a flat segment array.
- `src/lib/workouts.ts` — workouts in two forms: authored (repeat groups, what
  the builder edits) and flat (what the engine walks). `resolveWorkout`
  flattens once, at session start.
- `src/lib/audio.ts` — beeps scheduled on `AudioContext.currentTime`, derived
  from the same boundary instant the countdown displays.
- `src/lib/speech.ts` — spoken cues layered on the beeps. Best-effort by
  design: iOS drops speech silently, so nothing may depend on it.
- `src/lib/history.ts` — session summaries, CSV and text export. Pure, so the
  export formats are testable without a DOM.
- `src/lib/offTarget.ts` — pace against a segment's goal. Pure and stateful:
  five continuous seconds outside the band before it speaks, twenty between
  warnings, and a direction change restarts the hold.
- `src/lib/sources.ts` — real GPS, synthetic simulator, and recorded-log replay,
  all emitting the identical fix shape so simulation exercises real code.
- `src/lib/useRide.ts` — session state machine, persistence, tick, cue
  scheduling, wake lock, resume.
- `src/lib/db.ts` — IndexedDB. Every call is best-effort and never throws.

## Hard-won details

These were each found by a bug on a real ride. Don't undo them casually.

- **Pace is far twitchier than speed.** A 0.5 mph wobble at 7 mph moves pace by
  ~35 s/mile. Hence the 5s window, the spike gate, the pace hysteresis, and the
  3 s/mile deadband. Tune against real logs, not intuition.
- **A parked phone's wander is bounded; real movement isn't.** That asymmetry
  is what the odometer's noise floor relies on. Confirming movement needs
  ~2 mph, releasing it needs under 1 mph — noise can't start it, and a slow jog
  can't stop it.
- **iOS reports `coords.speed` as null whenever it can't determine one**, which
  in practice is most of the time the phone is still. The Haversine fallback
  measures over the longest baseline available and only believes a displacement
  larger than the fixes' own accuracy.
- **A cue that has already started is never canceled.** Segments reschedule the
  instant they advance, which is the same instant the boundary tone begins.
- **A fresh `AudioContext` has `currentTime === 0`**, so envelope maths must not
  compute negative times.
- **`sanePaceSecPerMile` is the one definition of a pace worth stating.** If
  the hero shows `--:--`, no split table, CSV column, goal delta or spoken cue
  may state one either — a segment reading `--:--` once grew a delta of
  +17269s beside it.
- **Countdowns round up, stopwatches truncate**, or the two clocks read a second
  apart. Spoken splits truncate too, or the voice says "29 seconds" beside a
  pill reading 0:28.
- **Resume excludes the dead gap** using the `lastSeenAt` heartbeat, so a crash
  doesn't inflate the workout.

## Conventions

- **Colors come from tokens** in `src/index.css` (`bg-surface`, `text-ink`,
  `bg-go`, …). Never name a raw Tailwind palette color in a component, or the
  night and day themes drift apart.
- **No TypeScript parameter properties** (`constructor(private x)`). The tests
  run under Node's strip-only type stripping, which rejects them.
- Comments explain *why*, especially where a defensive check encodes a real
  failure seen on a ride.

## Testing

No test framework. Suites are plain TypeScript run by Node's type stripping,
with a tiny loader that resolves extensionless imports.

```bash
npm test                     # engine, segments, audio — all synthetic
npm run build                # tsc + vite; a type error fails the deploy
```

Replaying a real exported GPS log is the highest-value check:

```bash
npm run test:replay -- tests/logs/<file>.json
```

**Real GPS logs are location data about a child's running routes, and this repo
is public — `tests/logs/` is gitignored. Keep it that way.** Ask before
committing any log or screenshot containing coordinates.

Every ride exports a raw log from the finish screen. Those logs are the
regression suite: three real bugs were found by replaying them.

## Deploy

Push to `main`; GitHub Actions builds and publishes to
https://samueljamesfarris.github.io/training-pace-app/ . The build runs `tsc`
first, so a type error fails the deploy rather than shipping a broken app.

The app is installed to Sam's home screen, so a bad deploy reaches a real phone.

## Where things stand

Built: steps 1–6 of the spec's build order, plus beeps. Verified against two
real rides.

Open, roughly in priority order:
- Kilometers — all pace maths and displays currently assume miles
- A real settings screen; audio and wake-lock toggles currently live in the dev
  panel and are not persisted across launches
- Before sharing widely: hide the DEV button, add onboarding, workout share-links
