import type { DistanceUnit } from './units';

/**
 * The unit the distance countdown is shown in, when it has been chosen.
 *
 * Null means "whatever suits the segment" — meters for a rep, miles for
 * anything a mile or longer. A double-tap on the countdown sets it explicitly,
 * and from then on every distance segment counts in that unit until it is
 * changed again. Remembered between launches, because it is a preference about
 * how he reads a number, not a property of a workout.
 */

const KEY = 'pace-distance-unit';

export function loadDistanceUnit(): DistanceUnit | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'mi' || v === 'm' ? v : null;
  } catch {
    return null;
  }
}

export function saveDistanceUnit(unit: DistanceUnit) {
  try {
    localStorage.setItem(KEY, unit);
  } catch {
    // A blocked storage write must never stop the display from switching.
  }
}
