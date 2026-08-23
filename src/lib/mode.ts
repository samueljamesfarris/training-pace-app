/**
 * Where the session is happening, which decides one thing: whether the phone
 * is measuring position at all.
 *
 * Outdoors the GPS is the whole instrument. On a treadmill it has nothing to
 * measure — the phone is standing still in a room — so indoors the app runs
 * the clocks, the segments and the cues, states the goal pace to dial into the
 * machine, and measures no distance and no pace rather than reporting the
 * noise of a phone sitting on a console as a run.
 */
export type RideMode = 'outdoor' | 'indoor';

const KEY = 'pace-mode';
/** Almost every session is outside; indoors is the exception he opts into. */
const DEFAULT: RideMode = 'outdoor';

export function loadMode(): RideMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'indoor' || v === 'outdoor' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveMode(mode: RideMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // A blocked storage write must never stop a session from starting.
  }
}
