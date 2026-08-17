import { haversineMeters } from './geo';
import { RollingSpeed, SpikeGate } from './smoothing';
import type { RawFix } from './types';
import { MAX_SANE_MPH, MIN_SANE_MPH, MPS_TO_MPH } from './units';

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

/**
 * Raised from 3s after the first real ride: pace is far twitchier than speed
 * (a 0.5 mph wobble at 7 mph moves pace by ~35 s/mile), so the hero number
 * churned. 5s costs a couple of seconds of lag and visibly settles it.
 */
export const DEFAULT_SMOOTHING_MS = 5000;

/** Below this the phone is parked; show a clean 0.0 rather than noise. */
const STATIONARY_MPH = 0.5;
/**
 * Pace must be sane for this long before it appears, and insane for this long
 * before it disappears. Stops a rocking phone on a bike flashing a pace on and
 * off as its noise crosses the 3 mph floor.
 */
const PACE_HYSTERESIS_MS = 2000;
/** Don't move the shown pace for less than this, in seconds per mile. */
const PACE_DEADBAND_SEC = 3;
/**
 * Movement has to be sustained, not momentary. Rocking a phone on a handlebar
 * mount throws single-second bursts well past any instantaneous speed gate, and
 * those bursts were creeping the odometer while parked.
 */
const MOVE_CONFIRM_MS = 2000;
const MOVE_RELEASE_MS = 3000;
/**
 * Asymmetric on purpose. Starting the odometer needs ~2 mph, comfortably above
 * the ~1.5 mph a 5s average of handlebar rocking produces, while stopping it
 * only needs to fall under 1 mph — so noise can never start it, but a genuine
 * slow recovery jog never stops it either.
 */
const MOVE_CONFIRM_MPS = 0.894;
/**
 * How far back the Haversine fallback may reach for its baseline. A longer arm
 * divides the position error by the same factor, which is the only way to get a
 * usable speed out of position differencing.
 */
const HAVERSINE_BASELINE_MS = 4000;

export interface GpsSnapshot {
  /** Smoothed speed for display, m/s. Frozen at its last value while stale. */
  displayMps: number | null;
  /**
   * Pace to display, in seconds per mile, already hysteresis-gated and
   * deadbanded. Null means show `--:--`. Kept here rather than derived in the
   * component because it is stateful, and state in a render path is a bug farm.
   */
  paceSecPerMile: number | null;
  /** Speed samples the spike gate threw away this session. */
  spikesRejected: number;
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
  /**
   * True before the first usable reading exists. A dropout badge means "the
   * number you are looking at is frozen" — with nothing yet to freeze, the
   * honest word is "acquiring".
   */
  acquiring: boolean;
}

/**
 * Turns a stream of raw fixes into displayable speed and a trustworthy
 * odometer. Knows nothing about sessions, React, or time formatting.
 */
export class GpsEngine {
  private smoother = new RollingSpeed(DEFAULT_SMOOTHING_MS);
  private gate = new SpikeGate();
  /** Display-stabilisation state. */
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private paceValid = false;
  private shownPaceSec: number | null = null;
  /** Recent fixes, newest first, for the Haversine baseline. */
  private recent: RawFix[] = [];
  private movingSince: number | null = null;
  private stoppedSince: number | null = null;
  private moving = false;
  spikesRejected = 0;
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
    // A gap means the fixes either side aren't a continuous track, so the
    // baseline history can't span it.
    if (this.recent[0] && fix.t - this.recent[0].t > DROPOUT_MS) this.recent = [];
    this.lastFixAt = receivedAt;
    this.lastAccuracy = fix.accuracy;

    const speed = this.deriveSpeed(fix);
    if (speed != null) {
      this.rawMps = speed;
      // The gate sees every sample so its history stays current; only accepted
      // ones reach the smoother.
      if (this.gate.accept(speed)) this.smoother.push(receivedAt, speed);
      else this.spikesRejected++;
    }
    this.recent.unshift(fix);
    if (this.recent.length > 12) this.recent.pop();
    this.updateMovement(receivedAt);

    if (fix.accuracy > ACCURACY_GATE_M) {
      // Still usable for display, never for distance. Leave the anchor alone so
      // the next good fix measures from the last good position, not this one.
      this.rejectedCount++;
      return;
    }

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

    // Not actually going anywhere: hold the leg open rather than re-anchoring.
    // Nothing accumulates while parked, and because the anchor stays put, the
    // real displacement from the parked spot is still counted on departure.
    if (!this.moving) return;

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
   * `position.coords.speed` when the device gives us one, otherwise Haversine.
   *
   * iOS reports null speed whenever it can't determine one — in practice, most
   * of the time the phone is standing still — so this path runs a lot, and it
   * has to be honest about measurement error. Two fixes one second apart with
   * 12 m accuracy can sit 3 m apart purely from wander, which naive
   * differencing reports as 6.7 mph from a phone sitting on a bike rack.
   *
   * So: measure over the longest baseline available (up to a few seconds, which
   * shrinks the error by that factor), and believe the displacement only if it
   * is larger than the positions' own uncertainty. Anything smaller is noise,
   * and noise means not moving.
   */
  private deriveSpeed(fix: RawFix): number | null {
    if (fix.speed != null && fix.speed >= 0 && Number.isFinite(fix.speed)) {
      this.derivedSpeed = false;
      return fix.speed;
    }

    // Oldest fix still inside the baseline window; the longer the arm, the
    // better the signal-to-noise. `recent` is newest-first, so keep walking
    // back — taking the first match would give the shortest arm, which is
    // precisely the noisy measurement this is here to avoid.
    let base: RawFix | null = null;
    for (const cand of this.recent) {
      const dt = fix.t - cand.t;
      if (dt <= 0) continue;
      if (dt > HAVERSINE_BASELINE_MS) break;
      base = cand;
    }
    if (!base) return null;

    const dtSec = (fix.t - base.t) / 1000;
    const d = haversineMeters(base.lat, base.lon, fix.lat, fix.lon);
    const uncertainty = (base.accuracy + fix.accuracy) / 2;
    this.derivedSpeed = true;
    // Indistinguishable from standing still.
    if (d <= uncertainty) return 0;
    const v = d / dtSec;
    return v > MAX_PLAUSIBLE_MPS ? null : v;
  }

  isStale(now: number): boolean {
    return this.lastFixAt == null || now - this.lastFixAt > DROPOUT_MS;
  }

  /**
   * Sustained-movement state machine. Confirming takes 2s so a burst can't
   * start the odometer; releasing takes 3s so a genuine brief slow-down at the
   * top of a hill doesn't stop it.
   */
  private updateMovement(now: number) {
    const v = this.smoother.value(now);
    const above = v != null && v > (this.moving ? MIN_MOVE_MPS : MOVE_CONFIRM_MPS);
    if (above) {
      this.stoppedSince = null;
      if (this.movingSince == null) this.movingSince = now;
      if (now - this.movingSince >= MOVE_CONFIRM_MS) this.moving = true;
    } else {
      this.movingSince = null;
      if (this.stoppedSince == null) this.stoppedSince = now;
      if (now - this.stoppedSince >= MOVE_RELEASE_MS) this.moving = false;
    }
  }

  /**
   * Decide whether a pace is worth showing, and by how much it may move.
   * Only runs on fresh data — during a dropout the whole display is frozen,
   * and letting validity decay would blank the pace mid-freeze.
   */
  private updatePaceDisplay(now: number, mph: number | null) {
    const sane = mph != null && mph >= MIN_SANE_MPH && mph <= MAX_SANE_MPH;
    if (sane) {
      this.belowSince = null;
      if (this.aboveSince == null) this.aboveSince = now;
      if (now - this.aboveSince >= PACE_HYSTERESIS_MS) this.paceValid = true;
    } else {
      this.aboveSince = null;
      if (this.belowSince == null) this.belowSince = now;
      if (now - this.belowSince >= PACE_HYSTERESIS_MS) this.paceValid = false;
    }

    if (!this.paceValid || !sane) {
      this.shownPaceSec = null;
      return;
    }
    const target = 3600 / mph;
    if (this.shownPaceSec == null || Math.abs(target - this.shownPaceSec) >= PACE_DEADBAND_SEC) {
      this.shownPaceSec = target;
    }
  }

  snapshot(now: number): GpsSnapshot {
    const stale = this.isStale(now);
    if (!stale) {
      const v = this.smoother.value(now);
      if (v != null) this.frozenMps = v;
      const mph = this.frozenMps == null ? null : this.frozenMps * MPS_TO_MPH;
      this.updatePaceDisplay(now, mph);
    }
    // Parked is parked: show a clean zero rather than the noise floor, and
    // never a few tenths of a mph from a phone rocking on its mount.
    const display =
      this.frozenMps == null
        ? null
        : !this.moving || this.frozenMps * MPS_TO_MPH < STATIONARY_MPH
          ? 0
          : this.frozenMps;
    return {
      acquiring: this.frozenMps == null,
      displayMps: display,
      paceSecPerMile: this.shownPaceSec,
      spikesRejected: this.spikesRejected,
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
    this.prevGood = null;
    this.recent = [];
    this.smoother.clear();
  }

  resetForSession(startingDistance = 0) {
    this.smoother.clear();
    this.gate.reset();
    this.prevGood = null;
    this.recent = [];
    this.anchor = null;
    this.frozenMps = null;
    this.aboveSince = null;
    this.belowSince = null;
    this.paceValid = false;
    this.shownPaceSec = null;
    this.movingSince = null;
    this.stoppedSince = null;
    this.moving = false;
    this.spikesRejected = 0;
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
