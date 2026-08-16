interface Sample {
  t: number;
  v: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Rejects single fixes that sit implausibly far from the recent median — the
 * occasional GPS spike that otherwise drags the hero number to a nonsense pace
 * and keeps contaminating it for the length of the smoothing window.
 *
 * The subtlety is that a naive median gate locks up: while it rejects, its own
 * history stops updating, so a genuine hard acceleration looks "wrong" forever
 * and the display never catches up. Hence the escape hatch — one wild sample is
 * noise, two in a row is a real change, and the gate forgets the old regime.
 */
export class SpikeGate {
  private hist: number[] = [];
  private rejects = 0;

  private windowSize: number;
  /** Max deviation from the recent median, in m/s (~4 mph). */
  private maxDeviation: number;
  private maxConsecutiveRejects: number;

  constructor(windowSize = 5, maxDeviation = 1.8, maxConsecutiveRejects = 2) {
    this.windowSize = windowSize;
    this.maxDeviation = maxDeviation;
    this.maxConsecutiveRejects = maxConsecutiveRejects;
  }

  /** True if the sample should reach the smoother. */
  accept(v: number): boolean {
    if (this.hist.length >= 3) {
      if (Math.abs(v - median(this.hist)) > this.maxDeviation) {
        this.rejects++;
        if (this.rejects <= this.maxConsecutiveRejects) return false;
        this.hist = []; // sustained: this is the new truth, not an outlier
        this.rejects = 0;
      } else {
        this.rejects = 0;
      }
    }
    this.hist.push(v);
    if (this.hist.length > this.windowSize) this.hist.shift();
    return true;
  }

  reset() {
    this.hist = [];
    this.rejects = 0;
  }
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
