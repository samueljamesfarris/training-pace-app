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
stored in IndexedDB. Presets are read-only — "Customize" is how you make one
yours.

### The shape of a workout

Every workout is a warm up, one main section and a cool down. The warmup and
the cooldown are optional; the main section is the workout, and it is one of
two things: a steady piece measured in time or distance, or a set of repeats.

The builder is those three cards. Repeats add what a flat list of steps could
never say: a step can **vary by round**, which turns its single field into one
per round and makes the set a ladder, and a recovery can **match the step
above**, so a ladder's jog mirrors whatever rung it followed. A checkbox ends
the set on the rep rather than on a closing recovery — six 800s used to finish
with a 400m jog to nowhere.

Anything the shape can't describe — two different sets, a warmup with strides
in it — opens in **Advanced**, which is the same list-of-blocks editor the app
always had. Coming back re-reads the steps as a structure, and keeps the
structure it left with if nothing was edited.

The picker shows all of this without expanding anything:

```
Tempo 2 / 3 / 1                      PRESET
WARM UP    Warmup 2 mi
MAIN       Tempo 3 mi
COOL DOWN  Cooldown 1 mi
3 segments · 6.00 mi
```

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
installed app offline. An ordinary workout comes to about 160 characters and
the longest preset to about 700, so either sends in a text message. Sharing goes through the platform share sheet where
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

A link carries the workout's structure only when the blocks can't imply it —
a ladder, in practice — since `inferPlan` recovers the rest on arrival, and
every byte of a plan lands in somebody's text message. It rides as an extra key
inside the same payload rather than a new format version, so an app built
before the structure existed ignores it and still runs the workout correctly.

A link is untrusted input that the app then runs, so `src/lib/share.ts`
validates it against explicit limits rather than trusting it, and rejects
anything out of range instead of clamping — importing a workout that differs
from the one that was sent would be worse than importing none. The structure is
held to a stricter test still: it is kept only if it compiles to exactly the
workout that came with it, so a link cannot ship innocuous steps beside a plan
that would rewrite them on the first save. Anything malformed there drops the
structure and imports the workout anyway — the blocks are what runs, the plan
only decides which editor opens.

### Dev tools

DEV → Screen reports the running bundle: the commit it was built from and when.
The app is installed to a home screen and takes updates only when allowed to,
so "which version is on the phone" has a non-obvious answer — and the string is
compiled into the same file the browser is running, so it cannot report a build
the phone isn't using. A local build says `dev`; the deployed ones carry the
short SHA.

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

1. Segment countdown, labeled with the phase and its position (`WORK · On 2 · 3/8`).
   A distance segment counts in the unit its own length calls for — meters for
   an 800, miles for a two-mile warmup — and keeps it for the whole segment.
   Double-tap the number to count in the other unit; that choice then holds
   for every distance segment until it is changed again, and is remembered
   between launches. Nothing switches units on its own mid-countdown.
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
- `src/lib/workouts.ts` — workouts in three forms. `WorkoutPlan` is the
  structure the builder edits — warm up, one main section, cool down —
  `WorkoutBlock[]` is what is stored and shared, and `resolveWorkout` flattens
  blocks into the segment array the engine walks, once, when a session starts.
  `planToBlocks` compiles a plan down on every save, `inferPlan` reads plain
  blocks back as a structure (strictly: a null answer means the advanced
  editor), and `describePlan` writes the three lines a picker card shows. The
  plan is optional on a workout, so nothing stored before it existed needed a
  migration.
- `src/lib/useRide.ts` — session state machine, persistence, the render tick.

## Beep vocabulary

Cues are scheduled against `AudioContext.currentTime`, from the same wall-clock
boundary instant the countdown displays, so they fire on time even when iOS
throttles the JS timer loop.

| When | Sound |
| --- | --- |
| count-in, 3-2-1 | one short beep each, 1046 Hz |
| the session starting | one long 1.5 s beep, 1568 Hz |
| 10 s before a timed segment ends | two short beeps, 784 Hz |
| 100–400 m before a distance segment ends | two short beeps, 784 Hz |
| 3, 2, 1 s | one short beep each, 1046 Hz |
| segment boundary / next segment | one long 1.5 s beep, 1568 Hz |
| the workout completing | one long 1.5 s beep, 1568 Hz |
| manual lap (free run) | one short chirp, 1318 Hz |
| mile split (free run) | two quick chirps, 1318 Hz |
| off target | a falling pair, 1174 → 880 Hz |

Frequencies sit in the 750–1600 Hz band, where a phone speaker is loudest and
wind noise is weakest.

START counts in for three seconds before anything begins: three beeps, then
the long tone. Tones only — they already say "three, two, one, go" in the app's
own vocabulary, and a spoken word on top of the start tone is one thing too
many at the moment you are clipping in and looking up. The session's clock
starts at the *end* of the count, from the same stored instant the beeps were scheduled against, so
the count-in is never counted as workout time and the first rep is a full rep.
A second tap during the count backs out of it, because a mis-tapped START
should not cost a session.

The tap is also where location is asked for, if the watch isn't already
running from WARM UP GPS. iOS grants it only inside a gesture, and asking there
means the fix is settling through the count-in rather than the session starting
cold. It is the *first* tap that asks — which may be the one that arms
"NO GPS — START?", since that is exactly the case where there is no fix yet. If the phone suspends JS through the count — which
the tick makes near-impossible with the screen awake — the session is not
started retroactively; it simply asks to be tapped again.

Only timed segments can be *scheduled* ahead, because only they have a knowable
end instant. A distance segment sounds its boundary on arrival, with no
countdown — there is no honest way to know when a distance will be reached.

Its heads-up, though, is knowable, because the remaining distance is: a
distance segment gets the same two-beep warning when it comes within 100 m
(reps under 600 m), 200 m (under a mile) or 400 m (anything longer) of its end,
played on arrival at that mark rather than scheduled. Before this an 800 m rep
made no sound at all between its start and its finish.

The end of the workout sounds too. The last segment never auto-advances — it
runs into overtime until FINISH is tapped — so nothing else would have marked
it, and a distance-ended workout finished in complete silence.

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

What the voice is *for* is running the workout for someone with no coach and no
reason to look at the phone: what is starting, how long it lasts, what to aim
for, and a heads-up before each of those changes.

| When | Said |
| --- | --- |
| the session starting | the first instruction — "Warmup, 2 miles, target 8 30" |
| 10 s / 200 m before a segment ends | what comes after it — "10 seconds, then Rest number 2" |
| the same, on the last segment | "Last 10 seconds" |
| boundary, inside a repeat set | what is starting — "Rest number 2, 30 seconds" |
| boundary, a standalone step | the split that closed, then what is starting — "3 minutes, 7 30 pace" / "Tempo, 3 miles, target 7 30" |
| boundary, into the last rep of a set | "Last one", then the instruction |
| boundary, into the last segment | "Last segment", then the instruction |
| halfway through a long segment | "Halfway, 7 30 pace" |
| off target | "Ease up, target 7 30" / "Pick it up, target 7 30" |
| pause and resume | "Paused" / "Resuming, On number 3" |
| the workout completing | "Workout complete", the total, "Tap finish" |
| manual lap | the lap's split and pace |
| mile split, free runs | "Mile 1, 7 40" |

Everything is budgeted against the seconds actually available. A rep inside a
repeat set gets no report of the rep just finished: on a 60-second rep that
callout is still talking when the next rep has started, and by then the useful
thing is what to do now. A standalone step is the opposite case — there the
split *is* the point, so it keeps its time and pace. Either way, a segment
under two seconds is a mis-tap and gets nothing.

The goal pace is stated when it *changes*, not on every rep: on a set of eight
the target is the same eight times, and by the third the voice is only using up
the seconds after the tone. A segment whose name already carries its length —
"800m", "Mile" — does not have it read back ("800 meters number 2, 800 meters"
is one fact twice), and a name like `800m` is read as "800 meters" rather than
"eight hundred em".

"Last one" and "Last segment" lead and stand alone, because they change how the
next few minutes are run and they survive being cut off by whatever comes next.

The heads-up and the halfway call are driven off the render tick rather than
scheduled, since neither is knowable in advance, and both are *spent* the
moment their mark is crossed whether or not they were spoken. If the phone
slept through the last ten seconds of a rest, "10 seconds, then On number 3"
arriving two seconds late is worse than silence — the beeps were on the audio
clock and already told the truth. A segment shorter than twice its own lead
gets no heads-up at all: announcing the end of a fifteen-second rest is talking
through the rest. The halfway call needs four minutes or 1200 m, since a
two-minute rep is over before wondering about it is useful.

All of that guiding layer is one dev-panel toggle, COACHING. Off leaves the
bare report — the split that just closed, and the name of what is next — which
is all this app used to say. How much talking helps outdoors is a question only
a real rep answers.

Reps are also spoken as a coach counts them — "Rest number 2", not "Rest 2",
which read aloud is ambiguous with a segment actually named that. The screen
still shows "Rest 2"; `resolveWorkout` carries the base name and the round
index alongside the display name for the voice to use.

Numbers are spoken the way a person says them: 8:04 becomes "8 oh 4", not
"eight colon zero four". Splits truncate to match the clock on screen, and a
pace outside the sane range is left unsaid rather than announced as nonsense.
