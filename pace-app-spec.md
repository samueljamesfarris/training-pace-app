# Build a run pacing app (bike-mounted or in hand)

## Context

I pace my son through his running workouts on roads and trails. Usually I ride a bike alongside him with my phone mounted on the handlebars. Sometimes I run with him instead, phone in hand or in an armband.

**The phone is the entire system.** The bike has no sensors, no computer, no electronics of any kind. Every measurement (speed, GPS position, distance, timing) and every sound comes from the phone itself. Since the phone travels at my son's pace either way, nothing about the app changes between bike mode and running mode. There is no mode switch. The app must simply work identically in both situations.

What I need: the phone's GPS speed converted to running pace, plus a stopwatch, segment splits, and audio cues so I'm not staring at the screen while moving.

Build this as a progressive web app: React + Vite + TypeScript, Tailwind for styling, deployed to any static HTTPS host. I add it to my iPhone home screen. No App Store, no Xcode.

## Hard constraints

- Phone-only. No pairing with watches, bike sensors, heart rate straps, or any external hardware. All data comes from the phone's own GPS and clock.
- Usable both mounted on handlebars and carried while running. The big-numbers, big-buttons design serves both: readable on a bouncing mount, and tappable mid-stride with sweaty thumbs.
- Screen must stay on for the whole workout via the Screen Wake Lock API, with a graceful fallback if it's unavailable. Re-acquire the wake lock on every `visibilitychange` back to visible, since iOS releases it when the app backgrounds.
- All positioning through `navigator.geolocation.watchPosition`. No third-party location services.
- Works fully offline after first load. Service worker caches the shell. Zero network calls during a ride.
- Session state persists to IndexedDB on every tick. If the tab backgrounds, the browser reloads, or the phone hiccups, I lose nothing.
- Requires HTTPS and a user gesture before requesting geolocation and before initializing audio (iOS Safari rules).

## Timing model (critical)

iOS suspends JavaScript when the app backgrounds, even briefly (a notification, a phone call, an accidental swipe). Any timer built by accumulating ticks will silently lose time. Therefore:

- All elapsed times (stopwatch, segment time, timed-segment countdowns) are **derived from wall-clock timestamps**, never from counted intervals. Store the session start timestamp, pause intervals, and segment boundary timestamps; compute elapsed on every render.
- On `visibilitychange` back to visible: reconcile all displayed times from timestamps, re-acquire the wake lock, restart `watchPosition` if it went stale, and re-warm the audio pipeline.
- On page reload with an unfinished session in IndexedDB: show a resume prompt with the session's elapsed time and distance. Resume continues from persisted state; discard requires confirmation.
- Countdown beeps are scheduled against the Web Audio clock (`AudioContext.currentTime`), not `setInterval`, so they fire on time even when the JS timer loop is throttled.

## Core math

- Running pace in minutes per mile = 60 / speed_mph
- Display pace as `m:ss`, rounded to the nearest second
- Display speed to one decimal, 0.1 mph resolution
- Working range is 6.7 to 15.0 mph, which is 9:00 down to 4:00 per mile
- Below 3 mph or above 25 mph, show `--:--` rather than a nonsense number

## GPS handling

This is the whole app. Get it right before anything else.

- `watchPosition` with `{ enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }`
- Prefer `position.coords.speed` (meters/second) when it's non-null. Fall back to Haversine distance between consecutive fixes divided by the timestamp delta.
- Raw GPS speed is jittery. Smooth it with a rolling window (3 seconds default, configurable) for the displayed "now" pace.
- Reject fixes with accuracy worse than 25 meters for distance accumulation, but still use them for display if nothing better is available.
- Only accumulate distance when speed exceeds roughly 1 mph, so the odometer doesn't drift while stopped at a light.
- Show a small GPS quality indicator: current accuracy in meters, color coded.

### Dropout behavior (defined, not accidental)

When no acceptable fix arrives for more than 5 seconds (tree cover, underpass):

- Freeze the displayed pace and speed with a clear stale indicator (dim the numbers, show a "GPS" badge). Never show a fabricated pace.
- Do not accumulate distance across the gap. When fixes resume, do not draw a straight-line Haversine jump across the dropout; resume accumulation from the first new good fix.
- Timed segments and the stopwatch never depend on GPS. They run from wall-clock timestamps regardless of fix quality.
- Distance-based segments simply pause their progress during a dropout. The manual "next segment" override covers the rare case where a dropout eats a boundary.

### Raw GPS logging

Record every raw fix (timestamp, lat, lon, speed, accuracy) to the session record in IndexedDB, before any smoothing or filtering. Exportable as JSON from the session summary. This turns every real ride into test data: recorded logs replay through simulation mode so smoothing and filtering get tuned against reality, not guesses.

## Screens

### 1. Ride screen (primary)

Big, glanceable, high contrast, readable in direct morning sunlight on a bouncing handlebar mount. Portrait first, handle landscape too.

Visual hierarchy, largest to smallest:

1. Current running pace, `m:ss` per mile. Hero number, as large as the screen allows.
2. Current speed in mph, one decimal
3. Total elapsed time (stopwatch)
4. Current segment time, and target pace for that segment if a workout is loaded
5. Session average pace and average speed
6. Total distance in miles

Controls: three tap targets, minimum 72px tall, hittable with a thumb without looking.

- Start / Pause (primary)
- Lap (records a manual split, always available even mid-workout)
- Finish (confirm required, so a mis-tap doesn't end the session)

### 2. Segments screen (secondary)

One swipe or one tab away from the ride screen. Running list of completed segments:

- Segment number or name
- Duration
- Distance
- Average pace
- Target pace and delta from target where applicable

Auto-scrolls to the newest entry. Lap and Pause stay reachable from here.

### 3. Workout picker

Shown before a session starts. Two paths:

- **Free run**: no structure, just stopwatch and manual laps
- **Preset workout**: a structured segment list

### 4. Workout builder

Create and save workouts locally. A workout is an ordered list of segments. Each segment has:

- Name, e.g. "800 repeat", "recovery jog", "warmup"
- Type: work or recovery
- End condition: by distance (miles or meters) or by time
- Target pace in min/mile with a tolerance band, optional
- Repeat groups, e.g. 6 x (800m @ 5:45 + 400m easy)

Repeat groups are authored as groups but **flattened into a linear segment list when the workout loads**, so the session engine only ever walks a flat array. Keeps auto-advance, resume-after-reload, and the segments screen simple.

Ship with these presets:

- Easy run (free run)
- 6 x 800m at target, 400m recovery
- 4 x 1 mile at target, 3 minute recovery
- Tempo: 2 mile warmup, 3 miles at target, 1 mile cooldown
- Ladder: 400 / 800 / 1200 / 800 / 400 with equal recovery

Segments auto-advance when the end condition is met. A manual "next segment" override is always available, because he won't hit the distance exactly.

### 5. Summary and history

On finish: total time, distance, average pace, full segment table. Saved locally. A history list of past sessions. Export a session as CSV, as a plain text summary to the clipboard, and raw GPS log as JSON.

## Audio cues

Cues play through the phone speaker outdoors, so everything must be loud, short, and distinct. Initialize the AudioContext on the first user tap so iOS allows it.

**Reliability rule: beeps are the primary channel, speech is the enhancement.** `speechSynthesis` on iOS fails silently after interruptions and loads voices asynchronously. Every critical cue (segment boundaries, countdown, off-target) must have a distinct beep pattern that fires whether or not speech works. Speech adds detail on top.

- Pre-warm the speech engine at session start (speak a zero-volume or empty utterance on the start tap).
- Re-warm speech and resume the AudioContext on every `visibilitychange` back to visible and after any audio interruption.
- Keep spoken phrases short: "Segment 3. Target 5:45." Not sentences.
- Distinct beep vocabulary: one pattern for segment start, one for segment end, one for off-target, an accelerating triple for countdown, a single chirp for manual lap. Document the mapping in settings.

Each cue individually toggleable in settings:

- **Segment start**: beep pattern, then speak the segment name and target pace
- **Segment end**: beep pattern, then speak the split time and that segment's average pace
- **Off-target warning**: if smoothed pace sits outside the tolerance band for more than 5 continuous seconds, distinct beep plus "ease up" or "pick it up". Rate limit to once every 20 seconds so it isn't nagging.
- **Countdown**: beeps in the last 3 seconds of a timed segment, scheduled on the audio clock
- **Mile splits**: announced automatically during free runs
- **Manual lap**: beep plus spoken split

Voice rate and volume adjustable.

## Settings

- Units: miles default, kilometers option (all pace math and displays follow the unit)
- Pace tolerance band, default plus or minus 5 seconds per mile
- Which audio cues are enabled
- Smoothing window length
- Wake lock toggle
- Large and extra-large text modes
- Light / dark / auto theme

## Visual design

- Dark text on a light background by default for sunlight legibility, with a proper night mode
- Tabular or monospaced numerals so digits don't jump around as they change
- No thin weights, no low-contrast gray for anything that matters
- Color code pace against target: neutral when on pace, distinct colors for too fast and too slow, always paired with a word or arrow so it never relies on color alone

## Build order

Ship each step as something I can actually test before moving to the next.

1. GPS plumbing and the ride screen: live pace, speed, distance, stopwatch on the timestamp-based timing model, raw fix logging. Nail the smoothing.
2. Wake lock, visibility/resume reconciliation, PWA manifest, service worker, home screen install, reload-resume prompt.
3. Manual laps and the segments screen.
4. Audio cues, beeps first, then speech.
5. Preset workouts, auto-advance, target pace logic.
6. Workout builder.
7. History, summary, CSV and JSON export.

After each step, tell me exactly what to test outdoors and what to watch for.

## Testing

I can't test GPS at a desk. Build in a simulation mode that replays a synthetic or recorded GPS track at configurable speed so the UI and audio can be exercised indoors. It must accept the raw GPS logs exported from real sessions. Add a dev panel that injects a speed value directly, and a way to simulate a backgrounding event (fire visibilitychange, suspend the clock) so the resume path gets exercised without leaving the desk.

## Priorities

Reliability over features. If the app loses my session, loses time after a notification, or the screen sleeps mid-workout, it's useless to me. Build the foundation solid before adding the workout builder.

Ask me anything you need before you start writing code.
