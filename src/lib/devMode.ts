/**
 * Whether the dev tools are on offer.
 *
 * The panel behind that button injects speeds, replays logs and fakes a
 * backgrounding — useful at a desk, alarming on someone else's phone mid-run.
 * So it is hidden by default and revealed deliberately, rather than compiled
 * out: it is exactly as useful on the real phone as at the desk, and a build
 * flag would put it out of reach precisely where the interesting bugs are.
 *
 * Two ways in, because the app is usually launched from a home-screen icon
 * where there is no address bar to type in:
 *   - five taps on the status chip, within a few seconds of each other
 *   - `?dev=1` on the URL, for a browser tab (and `?dev=0` to turn it off)
 *
 * The choice is remembered, so it survives a reload but not an install on a
 * phone that never asked for it.
 */

const KEY = 'pace-dev';

/** Taps on the status chip that reveal or re-hide the button. */
export const DEV_REVEAL_TAPS = 5;

/** How close together those taps have to be, in ms. */
export const DEV_REVEAL_WINDOW_MS = 3000;

export function saveDevEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // A blocked storage write must never stop the app from rendering.
  }
}

export function loadDevEnabled(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get('dev');
    if (flag === '1' || flag === '0') {
      const on = flag === '1';
      // Sticky, so the query string is needed once rather than every launch.
      saveDevEnabled(on);
      return on;
    }
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
