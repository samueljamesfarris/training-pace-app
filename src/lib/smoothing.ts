interface Sample {
  t: number;
  v: number;
}

/**
 * Rolling time window over raw speed samples. GPS speed is jittery enough that
 * the instantaneous value is unreadable on a bouncing mount; this is what makes
 * the hero number hold still.
 *
 * Samples are averaged with a linear ramp: the newest sample in the window gets
 * full weight, the oldest gets near zero. A flat mean lags noticeably on pace
 * changes at a 3s window; the ramp keeps most of the noise rejection while
 * responding to a real surge about a second sooner.
 */
export class RollingSpeed {
  private samples: Sample[] = [];
  windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  push(t: number, v: number) {
    this.samples.push({ t, v });
    this.trim(t);
  }

  setWindow(ms: number) {
    this.windowMs = ms;
    if (this.samples.length) this.trim(this.samples[this.samples.length - 1]!.t);
  }

  /** Weighted mean of samples inside the window, or null if the window is empty. */
  value(now: number): number | null {
    this.trim(now);
    if (this.samples.length === 0) return null;
    let sum = 0;
    let weight = 0;
    for (const s of this.samples) {
      const age = now - s.t;
      // Newest ≈ 1, oldest ≈ 0.15, never zero so a single stale-ish sample
      // still produces a number rather than a hole.
      const w = Math.max(0.15, 1 - age / this.windowMs);
      sum += s.v * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : null;
  }

  clear() {
    this.samples = [];
  }

  private trim(now: number) {
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0]!.t < cutoff) this.samples.shift();
  }
}
