# PATCH-PLAN.md

Four steps, in order. Each is one Claude Code session, one phone test, one push.

## Status

- [x] Step 1: Inputs and screen edges
- [x] Step 2: Durability
- [ ] Step 3: Ride screen
- [ ] Step 4: Builder structure and labels

**How to run a step.** Save this file in the repo root, then say:

> Read PATCH-PLAN.md and do the next unchecked step. Follow CLAUDE.md
> conventions. Stop when the step is done.

Then test on the phone using that step's Phone check, and push. Come back and
say the same line for the next one. Do not run two steps in one session.

**Finishing a step means all four of these**: the code changes are made,
`npm test` passes, `npm run build` passes, and the Status box above is ticked
in the same commit. If any part of a step was skipped or deferred, note it
inline under that item rather than ticking the box.

**Rules that apply to every step.** Follow `CLAUDE.md`. Never change
`gpsEngine.ts` smoothing, the timestamp timing model, or the service worker's
update behaviour. Colours come from tokens only. No TypeScript parameter
properties. `npm test` and `npm run build` must pass before the step is done.
Never commit a GPS log or a screenshot with coordinates in it.

---

# Step 1: Inputs and screen edges

The two things that make the app annoying to touch.

### 1a. Numeric fields cannot be cleared

In `WorkoutBuilder.tsx`, `TimeInput` and `DistanceInput` coerce every keystroke
with `Number(e.target.value) || 0`. Backspacing to empty yields 0, which
re-renders as "0", so blank is unreachable. `String(s).padStart(2, '0')` makes
it worse: with 30 in the field, typing 45 gives "3045", clamped to 59.

- Hold each field as local string state so empty is legal while typing.
- Normalise on blur: empty commits 0, seconds clamp to 0-59, display re-syncs
  from the parent value.
- Re-sync local state when the parent value changes from outside.
- Add `onFocus={(e) => e.target.select()}` to every numeric field.
- Drop `padStart` from the editable seconds input.

### 1b. The Time / Distance toggle destroys the value

Tapping Distance hard-resets to 400 m, tapping Time hard-resets to 120 s.
Remember the last value per mode within the row and restore it on toggle. Use
the defaults only the first time a mode is used for that segment.

### 1c. The unit selector converts wrong

`useMiles` is derived from magnitude rather than stored, so choosing "mi" on a
400 m segment produces 400 miles, and entering 0.5 mi flips back to 804 m
mid-typing. Hold the selected unit in local component state, seeded from
magnitude on mount. The dropdown changes the display only; the stored metres
never move.

Do not add a `unit` field to `EndCondition`. Stored workouts live in IndexedDB
and a schema change means a migration. Metres stay the source of truth.

### 1d. Safe-area insets

Only two places handle insets, both bottom-only: `RideScreen`'s footer and the
update banner in `App.tsx`. Nothing handles top, left or right, so the Dynamic
Island covers the headers in `WorkoutPicker`, `WorkoutBuilder` and `DevPanel`,
and the home indicator sits over "Delete workout".

Every overlay is `absolute inset-0` against the `relative h-full` wrapper in
`App.tsx`, so one fix covers all of them. In `src/index.css`, on the existing
`html, body, #root` block:

- Pad `#root` with `env(safe-area-inset-*)` on all four sides.
- Set `body` background to `var(--surface)`, or the inset strip shows bare.

**Then remove the two now-redundant local insets**, or the bottom double-pads:
`RideScreen`'s footer and the `App.tsx` update banner both become plain `pb-3`.

### Phone check

1. Backspace a seconds field to empty, type 45, blur. Reads 45, not 3045.
2. Tap a field with 30 in it. Value is selected, typing replaces it.
3. Enter 2:30, tap Distance, tap Time. The 2:30 is still there.
4. Enter 400, switch to mi and back. Still 400 m.
5. Enter 0.5 with mi selected. It stays 0.5 mi and does not flip to 804 m.
6. No control is under the island or the home bar, portrait and landscape.

> Phone-test follow-ups, all fixed in the Step 1 range:
> - The header sat flush against the island, so #root's top inset now carries
>   6px of breathing room past the bare `env()` value.
> - Rotating to landscape and back left the document scrolled, stranding the
>   header under the island. The app is a screen, not a document: html, body
>   and #root are `overflow: hidden`, and the ride screen's `main` scrolls
>   inside itself instead. That also brought the landscape controls back on
>   screen — they were ~291px below the fold.
> - Seconds showed a bare "0". Padding is back, but applied only at rest, never
>   to what is being typed, which is what made "3045" possible before.
>
> Still open, and Step 3's to fix: the landscape hero is sized in `vw`, so the
> numbers are far larger than the space allows and only fit because `main`
> scrolls. Resizing the hero belongs with the ride screen work.

---

# Step 2: Durability

Protects sessions already recorded and prevents losing one mid-ride.

### 2a. Error boundary

There is none. A render throw white-screens the app mid-workout.

Add a class error boundary wrapping the app's contents in `App.tsx`. The
recovery path already exists: `persistNow` writes every second and
`ResumePrompt` picks up any unfinished session, so the boundary does not need
to preserve state. It needs to fail loudly.

- Plain high-contrast fallback using colour tokens: one line saying the session
  was saved, plus a large Reload button.
- Log the error and component stack. Do not swallow it.
- Keep the fallback dependency-free so it renders even if theme state failed.

Verify by throwing deliberately from `RideScreen` behind a temporary dev flag,
confirming the fallback renders, then reloading and confirming `ResumePrompt`
offers the session back with the correct elapsed time. Remove the flag before
finishing the step.

### 2b. Raw fixes accumulate forever

`appendFixes` writes about one record per second per ride and nothing ever
deletes them. A quota failure would land mid-workout.

In `db.ts`, add pruning that keeps fixes for the 20 most recent sessions and
deletes the rest. Session metadata is tiny and stays; only the `fixes` store is
pruned. Run it once on load after `findUnfinishedSession` resolves, never during
a live session, wrapped in the existing `guard`. Also delete a session's fixes
when its session record is deleted. Log the count pruned.

This is IndexedDB on the phone only. Nothing to do with `tests/logs/`.

### 2c. Full table scan on every launch

`findUnfinishedSession` does `getAll()` over every session and filters in
memory. Write the live session's id to `localStorage` on start, clear it on
finish and discard, and fetch that one record by id on load. Keep the existing
scan as a fallback. Do not bump the IndexedDB version.

### 2d. Small correctness items

- The persistence effect depends on the whole `session` object, so every
  boundary rebuilds both intervals. Depend on `session?.id` and
  `session?.status`.
- The paused pill uses `absolute` but `RideScreen`'s root is not `relative`, so
  it resolves against the wrapper in `App.tsx`. Add `relative` to that root.
- `SourceKind` has three values, `SessionRecord.source` has two, so replay
  sessions persist as `'sim'`. Widen the field to include `'replay'`.
- `resumeSession` calls `setSelectedWorkout(null)`, so the picker reads Free run
  after resuming and finishing. Leave the selection alone.
- `MIN_SANE_MPH = 3` in `units.ts` is walking speed, so a walk-back recovery
  blanks the largest number on screen. Lower it to 2 and comment why the floor
  exists. Leave `MAX_SANE_MPH` alone.

### 2e. Tests for `workouts.ts`

No coverage today, and `resolveWorkout` is the seam Step 4 lands on. Add
`tests/workouts.test.ts` in the shape of the existing suites and wire it into
the `test` script.

Cover: `resolveWorkout` on each preset for count, order, and the index suffix
applied only when `repeat > 1`; `plannedSeconds` returning null when any segment
is distance-driven; `plannedMeters` counting only distance segments;
`copyWorkout` producing a new id, clearing `builtIn`, and deep-copying so
editing a copy cannot mutate the original.

### Phone check

Start a session, force-quit the app mid-workout, reopen. The resume prompt
shows the right elapsed time and excludes the gap.

> Verified at the desk: a deliberate render throw hit the boundary, the
> fallback rendered, and reloading offered the session back at 0:22 with the
> 30s gap excluded. Pruning took 25 seeded sessions from 88 raw fixes to 70,
> leaving exactly 20 sessions with fixes and all 26 session rows intact.
>
> `tests/engine.test.ts` had encoded the old 3 mph pace floor; lowering it to 2
> per 2d made 2.9 mph a real pace, so that assertion now checks the 2 mph
> boundary instead.

---

# Step 3: Ride screen

Things felt on the bike, at arm's length, before sunrise.

### 3a. Distance countdowns are unreadable

`SegmentHero.tsx` always counts down in miles, so an 800 rep reads 0.50, 0.49,
0.48. Each step is 16 metres. The same file's `endLabel` already switches to
metres below a mile.

Apply that threshold to the countdown: under a mile remaining, whole metres and
the unit "metres to go"; at or above, two-decimal miles. Switch on the value
remaining, not the segment total, so a mile rep transitions as it closes.

### 3b. Starting with a cold GPS

START works with no fix at all and the first segment's distance is then junk.
Arm START the way FINISH is armed, but only when there is no usable fix,
meaning one arrived recently within `ACCURACY_GATE_M`. With a usable fix, START
stays one tap. Do not hard-block; starting cold is legitimate on a treadmill.

### 3c. Stale GPS is not legible as a warning

40% opacity in direct sun reads as a rendering fault, and the chip explaining
it is in the corner. Keep the dimming and add a short badge under the hero using
`bg-hold`, shown only when the fix is stale and not merely acquiring. Reuse the
GPS chip's wording so there is one vocabulary.

### 3d. DEV is a mis-tap hazard

One accidental tap covers the countdown with the debug panel. Hide the DEV
button whenever a session exists and is not `finished`.

### 3e. Header controls are too small

SOUND, NIGHT and DEV are about 24px tall, under the 44px iOS minimum, in the
strip nearest the island. Give all three a 44px minimum touch target by padding
the hit area rather than inflating the label. Check this after 1d, since the
two interact.

### 3f. FINISH arms invisibly

It arms for four seconds and disarms silently, so a late second tap re-arms
instead of finishing. Show the remaining seconds in the button while armed.
Keep the duration and the two-tap behaviour.

### 3g. No proof the audio works

The first evidence cues are alive is a beep that either happens or does not.
Play the short lap chirp once on START, right after `beeps.init()`. Respect the
mute toggle.

### 3h. The workout cannot be changed after starting

The picker is only reachable when no session exists. Picking the wrong workout
means tapping FINISH twice and losing the session. That will happen in the dark.

Allow the picker to open while a session is **paused**, never while it is
running. Choosing a different workout while paused replaces the session's
workout and resets the boundary list to a single boundary at the current
instant, so the new workout starts clean from the resume.

This is the only item in the whole plan that touches session state during a
live ride. Keep it narrow. If it starts spreading into `segments.ts`, stop and
flag it rather than pushing through, and leave the rest of Step 3 in place.

### 3i. Free-run laps are invisible until the end

Tapping LAP records a boundary and chirps but shows nothing. Show the previous
lap's time and distance in the on-deck pill area where a workout shows its next
segment. Before the first lap, show a lap count of zero.

### 3j. Getting the log off the phone

Use the Web Share API when available, sharing the JSON as a file. Fall back to
the current download. Keep the filename.

### Phone check

An 800 rep counts down in metres and hits zero at the line. START with GPS off
asks once, then starts. A stale fix is readable without looking at the corner.
DEV is absent during a running session. The chirp fires at START. Pause, change
the workout, resume, and confirm elapsed time is still right.

---

# Step 4: Builder structure and labels

Last, because it changes how every existing workout renders.

### 4a. Steps and repeat sets

Every block renders with the same chrome, including a "repeat 1×" header. So
adding a warmup means creating a repeat group of one, and tapping "+ Segment"
instead puts it inside the 4× set where it silently repeats four times. The
ladder preset shows five identical headers.

**Do not change the data model.** `WorkoutDef`, `WorkoutBlock` and
`resolveWorkout` stay exactly as they are, and stored workouts must keep
loading. This is rendering and interaction only.

- `repeat === 1` renders as bare rows: no card, no border, no repeat header.
- `repeat > 1` renders a clearly bordered card with the counter in the header
  and the segments visibly indented inside. That border is the only thing
  telling the user those segments repeat, so it has to read at a glance.
- Replace "+ Repeat group" with two buttons: "+ Step" appends a `repeat: 1`
  block with one segment, "+ Repeat set" appends a `repeat: 2` block with a work
  and recovery pair.
- Inside a set, relabel "+ Segment" to say the segment joins that set.
- Dropping a set's repeat to 1 turns it into plain steps. Raising a step's
  repeat above 1 turns it into a set; give a step a quiet "Repeat" affordance.
- The delete guard `draft.blocks.length === 1` becomes wrong once blocks
  coalesce. Guard on total resolved segments instead.

**Coalescing.** Add a function that merges adjacent `repeat === 1` blocks into
one, and run it after every structural edit. Without it, two consecutive steps
sit in separate blocks and the arrows will not move a step past a boundary the
user can no longer see, which reads as a broken button. Unit-test it: adjacent
repeat-1 blocks merge, repeat sets never merge, and `resolveWorkout` output is
identical before and after coalescing.

### 4b. Duplicate does not duplicate

In `WorkoutPicker.tsx`, "Duplicate" throws the user into the builder instead of
making a copy. On a preset that looks like you are about to wreck the original.

- Preset cards: rename the action to "Customize". Behaviour stays as is.
- Custom cards: make "Duplicate" actually duplicate. Save the copy, stay on the
  list, let it appear under Mine. Do not open the builder.
- Add a small muted subtitle in the builder header: "New workout" when `isNew`,
  otherwise "Editing".

### 4c. Labels

- "Flattened order" is an internal transform name. Rename the heading to
  "Preview".
- Add a summary beside the repeat counter so sets are distinguishable, for
  example "8 × · 400 m + 1:30".
- Add a quiet uppercase "type" label above the four kind chips, matching the
  muted label style used for stats on the ride screen.
- The builder renders the raw kind key with CSS uppercase. `KIND_LABEL` exists
  in `workouts.ts` and is unused here. Use it.
- New segments default to the name "Segment", duplicating the chip. Default to
  the kind's label instead, and on kind change update the name only if it still
  matches the previous kind's label. Never overwrite a typed name.
- When Save is disabled, say why in the header: name the workout, or add a
  segment.
- Cancel discards silently. Confirm if the draft differs from `initial`, using
  the same two-tap pattern as "Delete workout".

### Phone check

1. The ladder preset shows nine plain steps, no repeat headers.
2. The 4 × (2 min / 30 s) preset shows one bordered set containing both
   segments.
3. Add a step to a workout starting with a set. It lands outside the set and
   Preview shows it once, not four times.
4. Add two steps, move the second above the first. The arrows work across what
   were separate blocks.
5. Drop a set's repeat to 1. It becomes plain steps and merges with any
   adjacent steps.
6. Duplicate a custom workout. A copy appears under Mine, no builder.
7. Customize a preset. The builder opens on a copy, the header says so, and the
   preset is unchanged in the list.

---

# If something goes wrong

Each step is its own commit range, so revert the step and keep the ones before
it.

Two items carry most of the risk. 4a's coalescing is the first: if `npm test` is
green and the arrows still misbehave, that is where to look. 3h is the second,
because it is the only change that touches session state during a live ride. If
3h turns messy, drop it and keep the rest of Step 3. Nothing else depends on it.
