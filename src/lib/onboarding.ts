/**
 * Whether the guide has been read.
 *
 * Stored as the version it was last read at, so a future rewrite can show
 * itself again to someone who read the old one, without a second flag.
 */

const KEY = 'pace-guide-seen';

/** Bump when the guide changes enough to be worth showing again. */
export const GUIDE_VERSION = 1;

export function guideSeen(): boolean {
  try {
    return Number(localStorage.getItem(KEY)) >= GUIDE_VERSION;
  } catch {
    // Storage blocked: better to show the guide again than to hide it forever.
    return false;
  }
}

export function markGuideSeen() {
  try {
    localStorage.setItem(KEY, String(GUIDE_VERSION));
  } catch {
    // Never let a storage failure stop the guide from closing.
  }
}
