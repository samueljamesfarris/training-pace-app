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

### Indoor and outdoor

The home screen picks where the session happens, and the choice is remembered
between launches.

**Outdoor** is the app as built: the GPS is the instrument.

**Indoor** is the treadmill. The phone never starts a position watch — no
permission prompt, no battery spent on a watch whose readings nobody shows —
and every distance-derived number is *absent rather than zero*: no miles, no
measured pace, no speed, on the ride screen, the finish card, the history
detail, the CSV and the text summary alike. A treadmill session that reported
0.00 miles at a pace of nothing would be stating a measurement it never made.

What still runs is everything the treadmill can't do: the session clock,
segment timing, auto-advance on timed segments, the beeps, the spoken cues,
and the goal pace for the current segment shown large so it can be dialed into
the machine. A segment measured in *distance* has no boundary to arrive at
indoors, so it counts its own time up and waits for NEXT — the picker and the
hero both say so.

The mode is recorded on the session, so a resumed treadmill session stays one,
and history knows why a ride has no distance. Choosing a source in the dev
panel switches back to outdoor, since asking for a source is asking to measure.

### First launch, and the guide

A first launch opens a five-page guide: what the app is, why it wants to be
installed to the home screen rather than left in a tab, outdoor versus
treadmill, what the four buttons do, and what `--:--` means. It is skippable,
it only opens itself once, and "How it works" on the home screen brings it
back. The stored flag is the guide's version, so a later rewrite can show
itself again to someone who read the old one.

### Sharing a workout

Every workout card has Share, which builds a link carrying the whole workout
in the URL's fragment — no server, no account, and a link that still opens an
installed app offline. The longest preset comes to under 600 characters, so it
sends in a text message. Sharing goes through the platform share sheet where
there is one, then the clipboard, then the raw link on screen.

Opening a link *offers* the workout rather than installing it, and accepting
assigns a fresh id so an import can never overwrite something already in the
library.

On iOS that offer arrives in a browser, because a link tapped in a message
opens the default browser rather than the home-screen app — and the home-screen
app keeps its own storage, so a workout added in the browser is not the one
they will have at the track. (Which browser is default makes no difference:
they are all WebKit underneath and all separate from the installed app.) So
the page opened from a link spells out the three steps — copy the link, open
Pace from the home screen, paste it under Workout → "Paste a workout link" —
with the link put on the clipboard for them, rather than sending them back to
the message to fish it out. Where storage is shared, which is everywhere else,
the same block appears as a quiet aside instead of a warning.

A link is untrusted input that the app then runs, so `src/lib/share.ts`
validates it against explicit limits rather than trusting it, and rejects
anything out of range instead of clamping — importing a workout that differs
from the one that was sent would be worse than importing none.

### Dev tools

The DEV button is hidden. Five taps on the status chip in the header reveal it
(and five more, or "Hide DEV" in the panel, put it away); `?dev=1` does the
same in a browser tab. The choice is remembered. It is hidden rather than
compiled out because the panel is exactly as useful on the real phone as at
the desk, and a build flag would put it out of reach where the interesting
bugs are.

### Theme

Night is the default, since most sessions start before sunrise: near-black
ground, light type, and bright button fills with dark ink. The NIGHT/DAY button
in the header switches to the daylight palette for sunlit runs, and the choice
persists. Colors come from tokens defined in `src/index.css`; components never
name a raw palette color, so both themes stay consistent by construction.

### Ride screen hierarchy

With a workout loaded, the segment countdown is the hero — that is the number
driving the session, and where the audio cues will attach:

1. Segment countdown, labeled with the phase and its position (`WORK · On 2 · 3/8`)
2. On deck: the next segment and its length
3. Pace in min/mile, and total elapsed
4. Speed, average pace, distance

A free run has no segment to count down, so pace stays the hero and the middle
button records a lap instead of advancing.

Plus step 2: screen wake lock, offline service worker, home-screen install, and
the reload-resume prompt.

### History and export

Every session is kept locally. History lists them newest first; opening one
shows the same summary and split table as the finish screen, with deltas where
the segment had a goal.

Three exports, all from the session detail: the summary as plain text to the
clipboard, the splits as CSV, and the raw GPS log as JSON. CSV and JSON go
through the share sheet where the platform offers it, so they land in Messages
or iCloud rather than in Files.

Raw fix logs are pruned beyond the twenty most recent sessions, so the JSON
button reports the fix count it actually has, or says the log was pruned.
Session records themselves are never pruned.

Nothing is built for kilometers yet; everything assumes miles.
Kilometers remain a future option; everything assumes miles today.

### Reliability behaviors

- **Wake lock** is held only while a session is live, and re-acquired on every
  return to visible — iOS drops it on backgrounding and never gives it back.
  If it can't be held, the ride screen says so rather than failing silently.
- **Offline**: content-hashed bundles are cached permanently; the HTML entry is
  network-first, so you get new builds when online and the last good build when
  not. A cold start in a dead zone works.
- **Updates never apply mid-workout.** A new version waits, and while a session
  is running the banner is a note rather than a button.
- **Resume** carries a heartbeat (`lastSeenAt`). If the app dies, the gap until
  you resume is excluded from the workout, and the session comes back paused.

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

Cues are scheduled against `AudioContext.currentTime`, from the same wall-clock
boundary instant the countdown displays, so they fire on time even when iOS
throttles the JS timer loop.

| When | Sound |
| --- | --- |
| 10 s before a segment ends | two short beeps, 784 Hz |
| 3, 2, 1 s | one short beep each, 1046 Hz |
| segment boundary / next segment | one long 1.5 s beep, 1568 Hz |
| manual lap (free run) | one short chirp, 1318 Hz |
| mile split (free run) | two quick chirps, 1318 Hz |
| off target | a falling pair, 1174 → 880 Hz |

Frequencies sit in the 750–1600 Hz band, where a phone speaker is loudest and
wind noise is weakest.

Only timed segments can be cued ahead, because only they have a knowable end
instant. A distance segment sounds its boundary on arrival, with no countdown —
there is no honest way to know when a distance will be reached.

Toggles, volume, and a test button for each cue live in the dev panel; the
header has a mute.

### Targets and tolerance

A segment can carry an optional goal pace in min/mile, set in the builder. The
tolerance around it is one setting for the whole workout, ±5 s/mile by default.

The ride screen shows the goal and the verdict in words — ON PACE, EASE UP,
PICK IT UP — with color alongside, never carrying the meaning alone. With no
pace reading at all it says NO PACE rather than claiming you're on it.

A warning needs the pace outside the band for five continuous seconds, and
repeats at most every twenty, so drifting over the line and back is silent.
Crossing from too fast to too slow restarts the five seconds rather than
inheriting them. The finish table gains a `vs goal` column, signed in seconds.

Targets are optional on `SegmentDef`, so every workout already in IndexedDB
keeps loading untouched — no migration.

### Spoken cues

Speech rides on top of the beeps and is allowed to fail. `speechSynthesis` on
iOS goes silent after interruptions and loads voices asynchronously, so every
call is best-effort — if speech dies mid-workout the beeps carry on unchanged.
It is primed with a silent utterance on the START tap, and a wedged queue is
cleared on every return to visible.

| When | Said |
| --- | --- |
| segment boundary | the split that closed, then the segment starting — "30 seconds, 7 30 pace" / "On 2" |
| manual lap | the lap's split and pace |
| mile split, free runs | "Mile 1, 7 40" |
| off target | "Ease up" or "Pick it up", after the falling beep |

Numbers are spoken the way a person says them: 8:04 becomes "8 oh 4", not
"eight colon zero four". Splits truncate to match the clock on screen, and a
pace outside the sane range is left unsaid rather than announced as nonsense.
