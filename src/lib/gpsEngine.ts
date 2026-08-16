import { haversineMeters } from './geo';
import { RollingSpeed } from './smoothing';
import type { RawFix } from './types';

/** Fixes worse than this don't get to move the odometer. */
export const ACCURACY_GATE_M = 25;
/** No fix for this long means the numbers are frozen and marked stale. */
export const DROPOUT_MS = 5000;
/** ~1 mph. Below this the odometer stays put, so it can't drift at a light. */
export const MIN_MOVE_MPS = 0.447;
/** ~30 mph. A jump implying more than this is a GPS glitch, not a run. */
const MAX_PLAUSIBLE_MPS = 13.4;
/** Shortest leg worth counting when we have no device speed to trust. */
const MIN_LEG_M = 5;
/** Leg length required to clear the accuracy circle, as a multiple of it. */
const NOISE_FLOOR_FACTOR = 2;

export const DEFAULT_SMOOTHING_MS = 3000;

export interface GpsSnapshot {
  /** Smoothed speed for display, m/s. Frozen at its last value while stale. */
  displayMps: number | null;
  /** Unsmoothed speed of the most recent fix, m/s. Dev panel only. */
  rawMps: number | null;
  stale: boolean;
  accuracy: number | null;
  lastFixAt: number | null;
  distanceMeters: number;
  fixCount: number;
  /** Fixes rejected for distance because accuracy was worse than the gate. */
  rejectedCount: number;
  /** Times accumulation was skipped because of a dropout gap. */
  dropoutCount: number;
  /** True when the current speed came from Haversine rather than coords.speed. */
  derivedSpeed: boolean;
}

/**
 * Turns a stream of raw fixes into displayable speed and a trustworthy
 * odometer. Knows nothing about sessions, React, or time formatting.
 */
export class GpsEngine {
  private smoother = new RollingSpeed(DEFAULT_SMOOTHING_MS);
  /** Previous fix of any quality, for the Haversine speed fallback. */
  private prevFix: RawFix | null = null;
  /** Previous accuracy-passing fix, used only to spot arrival gaps. */
  private prevGood: RawFix | null = null;
  /** Start of the open leg the odometer is currently measuring. */
  private anchor: RawFix | null = null;
  /** Last good smoothed value, held on screen through a dropout. */
  private frozenMps: number | null = null;

  private lastFixAt: number | null = null;
  private lastAccuracy: number | null = null;
  private rawMps: number | null = null;
  private derivedSpeed = false;

  distanceMeters = 0;
  fixCount = 0;
  rejectedCount = 0;
  dropoutCount = 0;

  /** While paused, fixes are still logged but the odometer holds. */
  accumulating = true;

  setSmoothingMs(ms: number) {
    this.smoother.setWindow(ms);
  }

  /**
   * Feed one raw fix. `receivedAt` is our own clock — fix timestamps come from
   * the device and are only ever compared against each other.
   */
  ingest(fix: RawFix, receivedAt: number) {
    this.fixCount++;
    this.lastFixAt = receivedAt;
    this.lastAccuracy = fix.accuracy;

    const speed = this.deriveSpeed(fix);
    if (speed != null) {
      this.rawMps = speed;
      this.smoother.push(receivedAt, speed);
    }

    if (fix.accuracy > ACCURACY_GATE_M) {
      // Still usable for display, never for distance. Leave the anchor alone so
      // the next good fix measures from the last good position, not this one.
      this.rejectedCount++;
      this.prevFix = fix;
      return;
    }
    this.prevFix = fix;

    const prevGood = this.prevGood;
    this.prevGood = fix;

    // No open leg yet, or the odometer is held (paused): just re-anchor, which
    // guarantees the held stretch can never be bridged into distance later.
    if (!this.anchor || !this.accumulating) {
      this.anchor = fix;
      return;
    }

    if (prevGood && fix.t - prevGood.t > DROPOUT_MS) {
      // Tree cover, underpass. Do not draw a straight line across the gap:
      // re-anchor here and resume accumulating from the next fix.
      this.dropoutCount++;
      this.anchor = fix;
      return;
    }

    const dtSec = (fix.t - this.anchor.t) / 1000;
    if (dtSec <= 0) return;
    const d = haversineMeters(this.anchor.lat, this.anchor.lon, fix.lat, fix.lon);
    const implied = d / dtSec;
    if (implied > MAX_PLAUSIBLE_MPS) {
      // A teleport, not a run. Drop the leg and start a new one.
      this.anchor = fix;
      return;
    }

    // A phone sitting still still wanders several meters a second, and that
    // wander is fast enough to clear a naive 1 mph gate. So the "are we moving"
    // question is answered by the device's own speed whenever it gives us one.
    const deviceSpeed = fix.speed != null && fix.speed >= 0 ? fix.speed : null;
    if (deviceSpeed != null) {
      if (deviceSpeed > MIN_MOVE_MPS) this.distanceMeters += d;
      this.anchor = fix;
      return;
    }

    // No device speed: geometry is the only defense left. A parked phone's
    // wander is bounded by its accuracy circle no matter how long you watch;
    // real movement isn't. So the leg stays open — never expiring — until the
    // displacement clears that circle, which a run does in a few seconds and
    // jitter never does. A slow runner just gets counted in longer legs.
    const floor = Math.max(
      MIN_LEG_M,
      NOISE_FLOOR_FACTOR * Math.max(fix.accuracy, this.anchor.accuracy),
    );
    if (d > floor) {
      this.distanceMeters += d;
      this.anchor = fix;
    }
  }

  /**
   * `position.coords.speed` when the device gives us one, otherwise Haversine
   * between consecutive fixes over their timestamp delta.
   */
  private deriveSpeed(fix: RawFix): number | null {
    if (fix.speed != null && fix.speed >= 0 && Number.isFinite(fix.speed)) {
      this.derivedSpeed = false;
      return fix.speed;
    }
    const prev = this.prevFix;
    if (!prev) return null;
    const dtMs = fix.t - prev.t;
    // A stale pair spans a dropout; its average speed would be a fiction.
    if (dtMs <= 0 || dtMs > DROPOUT_MS) return null;
    const d = haversineMeters(prev.lat, prev.lon, fix.lat, fix.lon);
    const v = d / (dtMs / 1000);
    if (v > MAX_PLAUSIBLE_MPS) return null;
    this.derivedSpeed = true;
    return v;
  }

  isStale(now: number): boolean {
    return this.lastFixAt == null || now - this.lastFixAt > DROPOUT_MS;
  }

  snapshot(now: number): GpsSnapshot {
    const stale = this.isStale(now);
    if (!stale) {
      const v = this.smoother.value(now);
      if (v != null) this.frozenMps = v;
    }
    return {
      displayMps: this.frozenMps,
      rawMps: this.rawMps,
      stale,
      accuracy: this.lastAccuracy,
      lastFixAt: this.lastFixAt,
      distanceMeters: this.distanceMeters,
      fixCount: this.fixCount,
      rejectedCount: this.rejectedCount,
      dropoutCount: this.dropoutCount,
      derivedSpeed: this.derivedSpeed,
    };
  }

  /** Called on pause/resume so a stop never gets bridged into the odometer. */
  dropAnchor() {
    this.anchor = null;
    this.prevFix = null;
    this.prevGood = null;
    this.smoother.clear();
  }

  resetForSession(startingDistance = 0) {
    this.smoother.clear();
    this.prevFix = null;
    this.prevGood = null;
    this.anchor = null;
    this.frozenMps = null;
    // These must go too, or a fresh session shows the last one's speed and
    // accuracy until its own first fix lands.
    this.lastFixAt = null;
    this.lastAccuracy = null;
    this.rawMps = null;
    this.derivedSpeed = false;
    this.distanceMeters = startingDistance;
    this.fixCount = 0;
    this.rejectedCount = 0;
    this.dropoutCount = 0;
    this.accumulating = true;
  }
}
