export type WakeLockState = 'held' | 'released' | 'unsupported' | 'denied';

/**
 * Keeps the screen awake for the length of a workout.
 *
 * iOS releases the lock whenever the app backgrounds — a notification, a
 * glance away — and never gives it back on its own, so re-acquiring on every
 * return to visible is the whole job. A lock that silently lapsed halfway
 * through is indistinguishable from never having one.
 */
export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  state: WakeLockState = 'released';
  onChange: (() => void) | null = null;

  get supported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  private set(next: WakeLockState) {
    if (this.state === next) return;
    this.state = next;
    this.onChange?.();
  }

  /** Ask for the lock and keep wanting it until `release` is called. */
  async acquire() {
    this.wanted = true;
    if (!this.supported) {
      this.set('unsupported');
      return;
    }
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.set('held');
      this.sentinel.addEventListener('release', () => {
        // Fires on backgrounding too; reacquire() decides what to do next.
        if (this.state === 'held') this.set('released');
      });
    } catch {
      // Refused: low battery, or not a user-visible document.
      this.set('denied');
    }
  }

  /** Called on every visibilitychange back to visible. */
  async reacquire() {
    if (!this.wanted) return;
    if (document.visibilityState !== 'visible') return;
    if (this.sentinel && !this.sentinel.released) return;
    await this.acquire();
  }

  async release() {
    this.wanted = false;
    try {
      await this.sentinel?.release();
    } catch {
      // Already gone.
    }
    this.sentinel = null;
    this.set('released');
  }

  get wantsLock() {
    return this.wanted;
  }
}
