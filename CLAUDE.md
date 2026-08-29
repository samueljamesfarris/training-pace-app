# Working on this repo

A phone-only GPS pacing app. Sam rides a bike alongside his son's running
workouts with the phone on the handlebars, often before sunrise; sometimes he
runs carrying it instead. The phone is the entire system — no watch, no sensors.
Full requirements are in `pace-app-spec.md`, which is the source of truth for
scope. `README.md` tracks what is actually built.

PATCH-PLAN.md in the repo root is **complete** — all four steps done and
ticked. It is kept as a record, not as a queue. Nothing is waiting in it.

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
   honestly, show `--:--`. Indoor sessions are the same rule taken to its end:
   nothing was measured, so miles, pace and speed are absent everywhere —
   screen, finish card, history, CSV — rather than reported as zero.
4. **Audio never takes the session down.** Same for IndexedDB — persistence
   failures surface as a banner and the workout continues.
5. **The service worker never calls `skipWaiting()` on its own.** Swapping
   bundles mid-workout is the one thing this app must not do. It also only
   reloads on `controllerchange` when a controller was already there: a first
   install claims a page that is *already* running the newest code, and
   reloading it threw away the workout link that page had just opened.

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
- `src/lib/speech.ts` — spoken cues layered on the beeps, and the whole
  vocabulary of the coaching layer: what is starting, how long, what to aim
  for. Pure phrasing; nothing here knows about a session. Best-effort by
  design: iOS drops speech silently, so nothing may depend on it.
- `src/lib/coach.ts` — *when* the cues that fall inside a segment fire: the
  heads-up before it ends and the one progress call on a long one. Pure and
  stateful like `offTarget.ts`. A cue is spent when its mark is crossed,
  spoken or not, so a phone that slept through one stays quiet about it.
- `src/lib/history.ts` — session summaries, CSV and text export. Pure, so the
  export formats are testable without a DOM.
- `src/lib/offTarget.ts` — pace against a segment's goal. Pure and stateful:
  five continuous seconds outside the band before it speaks, twenty between
  warnings, and a direction change restarts the hold.
- `src/lib/sources.ts` — real GPS, synthetic simulator, and recorded-log replay,
  all emitting the identical fix shape so simulation exercises real code.
- `src/lib/useRide.ts` — session state machine, persistence, tick, cue
  scheduling, wake lock, resume.
- `src/lib/mode.ts` — indoor or outdoor, remembered between launches. Indoor is
  the treadmill: no position source is ever started, and nothing derived from
  distance is displayed or exported. `isIndoor` in `types.ts` is the one test.
- `src/lib/share.ts` — workouts as links. The whole workout rides in the URL
  fragment, so there is no server and no account; the decoder treats a link as
  untrusted input and validates it against `LIMITS` rather than trusting it.
- `src/lib/devMode.ts` — whether the DEV button is on offer. Hidden by default,
  revealed by five taps on the status chip or `?dev=1`, and remembered.
- `src/lib/onboarding.ts` — whether the guide has been read, stored as the
  version it was read at so a rewrite can show itself again.
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
- **A countdown's unit is fixed by the segment's length, never by what's
  left.** Switching on the remainder turned a two-mile warmup into meters at
  the halfway mark, mid-stride. Short reps still count in meters because the
  *rep* is short. A double-tap on the number overrides it, and that choice
  sticks.
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
- **US spelling**, in code, comments, docs and anything on screen. A sub-mile
  countdown once shipped reading "metres to go".

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

**A workout link has to be tested on a browser that has never opened the app.**
The first visit is the one that installs the service worker, and it behaves
differently from every subsequent one — that difference silently ate the whole
import for exactly the people a link is sent to. A warm reload proves nothing
here; use a fresh browser profile whose *first* navigation is the link.

A shared link is untrusted input that the app then runs, so `tests/share.test.ts`
is adversarial on purpose: malformed payloads, out-of-range values, and the
repeat-count expansion that a size cap alone would not catch. Keep it that way.

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

The spec's build order is complete: GPS and the ride screen, wake lock and
offline install, laps and segments, beeps and spoken cues, preset workouts with
targets and tolerance bands, the workout builder, and history with CSV export.

### Not yet verified on a phone

Everything below is desk-verified only. It is the first thing to ask Sam about,
and the reason to be careful before piling more on top.

- **Rotation.** Portrait to landscape and back. This was got wrong twice; the
  shell is now `position: fixed; inset: 0` and a desktop check is not proof.
- **The DEV → Screen readout.** What iOS actually reports for safe-area insets,
  and whether it says *installed* or *browser tab*. If the top inset reads 0 in
  the installed app, the 6px of breathing room above it is masking a different
  cause.
- **The stale-GPS badge** under real tree cover. It cannot be triggered at a
  desk any more, because hiding DEV mid-session removed the way to inject a
  dropout.
- **Spoken cues.** iOS speech differs from desktop — it goes quiet after
  interruptions, and voice, rate and timing may all feel wrong outdoors.
- **How much the coaching layer should say.** The voice now runs the workout —
  first instruction, a heads-up before every transition, length and goal of
  what is starting, "last one", halfway pace, completion. It is budgeted to
  finish before the next thing happens, but only a real set of 30-second rests
  proves that. The COACHING toggle in the dev panel turns it back down to the
  bare split-and-name behavior; whether the middle ground is wanted is the
  question to ask after a run.
- **Targets.** Whether ±5 s/mile is the right band, and whether a warning every
  twenty seconds helps or nags, is a question only a real rep answers.

### Still open

- Indoor mode is desk-verified only, in a browser at phone size. What a real
  treadmill session wants on screen — whether the goal pace and the clocks are
  the right two numbers, and whether tapping NEXT through a distance workout is
  bearable — is a question only a treadmill answers.
- Kilometers — all pace math and displays assume miles. **Explicitly deferred**;
  Sam does not want it yet. Keep it as a future option.
- A real settings screen. Audio, speech, tolerance and wake-lock toggles live in
  the dev panel and are not persisted across launches.
- The three things that gated sharing it — the DEV button, onboarding and
  workout share-links — are built, and none of them has been used by anyone
  but us. What a first-time user actually does with the guide, and whether a
  link survives the trip through Messages on a real phone, are the open
  questions.

## Picking this up in a fresh session

The repo carries everything: this file loads automatically, the commit messages
carry the reasoning behind each decision, and `npm test` covers the engine,
segments, workouts, speech, cue timing, off-target and history.

What the repo cannot carry is the GPS logs — they are location data about a
child's routes and stay gitignored. Sam exports them from a ride's detail
screen in History; drop one into `tests/logs/` and replay it with
`npm run test:replay -- tests/logs/<file>.json`.

Start by asking how the last ride went, and check the unverified list above
before building anything new.
