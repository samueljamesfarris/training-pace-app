# training-pace-app

Phone web app to use during runs on my bike while training with my son.

The phone is the entire system: every measurement comes from its own GPS and
clock, so it works identically mounted on handlebars or carried in hand. Full
requirements are in [`pace-app-spec.md`](pace-app-spec.md); this README tracks
what's actually built.

## What's built

Step 1 — GPS plumbing and the ride screen: live pace, speed, distance,
stopwatch on the timestamp-based timing model, raw fix logging to IndexedDB,
and a simulation mode so the whole pipeline can be exercised at a desk.

Plus the interval engine, pulled forward from steps 3 and 5: preset workouts,
a flat segment list walked from wall-clock timestamps, auto-advance, the manual
next-segment override, free-run laps, and a segment table on finish.

Plus the workout builder (step 6): create, edit, duplicate and delete workouts,
stored in IndexedDB. Presets are read-only — "Duplicate" is how you make one
yours.

### Theme

Night is the default, since most sessions start before sunrise: near-black
ground, light type, and bright button fills with dark ink. The NIGHT/DAY button
in the header switches to the daylight palette for sunlit runs, and the choice
persists. Colours come from tokens defined in `src/index.css`; components never
name a raw palette colour, so both themes stay consistent by construction.

### Ride screen hierarchy

With a workout loaded, the segment countdown is the hero — that is the number
driving the session, and where the audio cues will attach:

1. Segment countdown, labelled with the phase and its position (`WORK · On 2 · 3/8`)
2. On deck: the next segment and its length
3. Pace in min/mile, and total elapsed
4. Speed, average pace, distance

A free run has no segment to count down, so pace stays the hero and the middle
button records a lap instead of advancing.

Not yet built (later steps): wake lock, service worker / home-screen install,
reload-resume prompt, audio cues, target paces and tolerance bands, history and
CSV export.

## Run locally

```bash
npm run dev
```

Geolocation needs HTTPS, so `localhost` on the Mac works but the LAN address on
a phone does not. For phone testing, push to `main` and use the deployed URL.

## Deploy

Live at **https://samueljamesfarris.github.io/training-pace-app/**

Every push to `main` builds and publishes automatically via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). `npm run build`
runs `tsc` first, so a type error fails the deploy rather than shipping a broken
app to the phone.

Vite builds with a relative `base`, which is what lets the same bundle work from
the `/training-pace-app/` subpath without configuration.

To build the static bundle by hand — it works from any HTTPS host:

```bash
npm run build
```

## Architecture notes

- `src/lib/gpsEngine.ts` — the whole GPS story: speed derivation, smoothing,
  the accuracy gate, dropout handling, and the odometer. No React, no clock
  formatting, no session concepts. This is the part worth testing hardest.
- `src/lib/types.ts` — `elapsedMs()` derives every displayed time from stored
  timestamps. Nothing in the app accumulates ticks.
- `src/lib/sources.ts` — `GeoSource` (real `watchPosition`), `SimSource`
  (synthetic track), `ReplaySource` (a recorded raw log). All three emit the
  identical fix shape, so simulated runs exercise the real code path.
- `src/lib/segments.ts` — the interval engine. Segment boundaries are stored as
  timestamps, so `computeAutoAdvance` can place a boundary at the exact instant
  it was due even if the phone slept through it, and can catch up several at
  once. Nothing here counts intervals either.
- `src/lib/workouts.ts` — workouts in two forms: the authored form (repeat
  groups, what the builder edits) and the flat form the engine walks.
  `resolveWorkout` flattens one into the other, once, when a session starts.
- `src/lib/useRide.ts` — session state machine, persistence, the render tick.

## Beep vocabulary

Not implemented until step 4; documented there.
