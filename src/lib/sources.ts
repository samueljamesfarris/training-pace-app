import { project } from './geo';
import type { RawFix } from './types';

export interface PositionSource {
  start(onFix: (f: RawFix) => void, onError: (msg: string, code?: number) => void): void;
  stop(): void;
}

export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 10000,
};

function geoErrorMessage(e: GeolocationPositionError): string {
  switch (e.code) {
    case e.PERMISSION_DENIED:
      return 'Location permission denied. Enable it for this site in Settings, then reload.';
    case e.POSITION_UNAVAILABLE:
      return 'Position unavailable — no usable satellite fix right now.';
    case e.TIMEOUT:
      return 'No fix within 10s. Still trying.';
    default:
      return e.message || 'Geolocation error.';
  }
}

/** The real thing: navigator.geolocation.watchPosition, nothing else. */
export class GeoSource implements PositionSource {
  private watchId: number | null = null;

  start(onFix: (f: RawFix) => void, onError: (msg: string, code?: number) => void) {
    if (!('geolocation' in navigator)) {
      onError('This browser has no geolocation API.');
      return;
    }
    if (!window.isSecureContext) {
      onError('Geolocation needs HTTPS. Load this page over https.');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          t: p.timestamp || Date.now(),
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          speed: p.coords.speed ?? null,
          accuracy: p.coords.accuracy ?? 9999,
          altitude: p.coords.altitude ?? null,
          heading: p.coords.heading ?? null,
          source: 'geo',
        }),
      (e) => onError(geoErrorMessage(e), e.code),
      GEO_OPTIONS,
    );
  }

  stop() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /** True when the watch is live. */
  get active() {
    return this.watchId != null;
  }
}

export interface SimConfig {
  /** Target speed in mph. Set jitter to 0 for direct speed injection. */
  targetMph: number;
  /** Peak random deviation in mph applied to each emitted fix. */
  jitterMph: number;
  /** Reported horizontal accuracy in meters. */
  accuracy: number;
  /** When false, coords.speed is null and the Haversine fallback takes over. */
  provideSpeed: boolean;
  /** While true the source emits nothing, so the dropout path runs. */
  dropout: boolean;
  /** Emission interval in ms. */
  intervalMs: number;
}

export const DEFAULT_SIM: SimConfig = {
  targetMph: 8.0,
  jitterMph: 0.8,
  accuracy: 8,
  provideSpeed: true,
  dropout: false,
  intervalMs: 1000,
};

/**
 * Synthetic track. Walks a point along a bearing at the configured pace and
 * emits fixes shaped exactly like the real ones, so everything downstream —
 * smoothing, gating, the odometer — runs the identical code path at a desk.
 */
export class SimSource implements PositionSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lat = 37.7749;
  private lon = -122.4194;
  private bearing = 0;
  private lastEmit = 0;
  private getConfig: () => SimConfig;

  constructor(getConfig: () => SimConfig) {
    this.getConfig = getConfig;
  }

  start(onFix: (f: RawFix) => void) {
    this.lastEmit = Date.now();
    const tick = () => {
      const cfg = this.getConfig();
      const now = Date.now();
      const dtSec = Math.max(0.001, (now - this.lastEmit) / 1000);
      this.lastEmit = now;
      if (cfg.dropout) return;

      const jitter = (Math.random() * 2 - 1) * cfg.jitterMph;
      const mph = Math.max(0, cfg.targetMph + jitter);
      const mps = mph / 2.2369362920544;

      const moved = project(this.lat, this.lon, this.bearing, mps * dtSec);
      this.lat = moved.lat;
      this.lon = moved.lon;
      // Gentle curve so headings and bearings vary like a real road.
      this.bearing = (this.bearing + 1.5) % 360;

      onFix({
        t: now,
        lat: this.lat,
        lon: this.lon,
        speed: cfg.provideSpeed ? mps : null,
        accuracy: cfg.accuracy,
        altitude: null,
        heading: this.bearing,
        source: 'sim',
      });
    };
    this.timer = setInterval(tick, this.getConfig().intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Replays a raw GPS log exported from a real session, paced by the fixes' own
 * timestamps. This is how a real ride becomes a repeatable test case.
 */
export class ReplaySource implements PositionSource {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private index = 0;
  private stopped = false;
  private fixes: RawFix[];
  private rate: number;
  private onEnd?: () => void;

  constructor(fixes: RawFix[], rate = 1, onEnd?: () => void) {
    this.fixes = fixes;
    this.rate = rate;
    this.onEnd = onEnd;
  }

  start(onFix: (f: RawFix) => void, onError: (msg: string) => void) {
    if (this.fixes.length === 0) {
      onError('Replay log is empty.');
      return;
    }
    const step = () => {
      if (this.stopped || this.index >= this.fixes.length) {
        if (!this.stopped) this.onEnd?.();
        return;
      }
      const fix = this.fixes[this.index]!;
      onFix(fix);
      this.index++;
      const next = this.fixes[this.index];
      // Preserve the log's own gaps, including the dropouts, scaled by rate.
      const delayMs = next ? Math.max(0, (next.t - fix.t) / this.rate) : 0;
      if (next) this.timer = setTimeout(step, delayMs);
      else this.onEnd?.();
    };
    step();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Loose validation of an imported raw-log JSON file. */
export function parseFixLog(text: string): RawFix[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data?.fixes;
  if (!Array.isArray(arr)) throw new Error('Expected a JSON array of fixes.');
  const fixes: RawFix[] = [];
  for (const raw of arr) {
    if (typeof raw?.t !== 'number' || typeof raw?.lat !== 'number' || typeof raw?.lon !== 'number') {
      continue;
    }
    fixes.push({
      t: raw.t,
      lat: raw.lat,
      lon: raw.lon,
      speed: typeof raw.speed === 'number' ? raw.speed : null,
      accuracy: typeof raw.accuracy === 'number' ? raw.accuracy : 9999,
      altitude: typeof raw.altitude === 'number' ? raw.altitude : null,
      heading: typeof raw.heading === 'number' ? raw.heading : null,
      source: 'sim',
    });
  }
  if (fixes.length === 0) throw new Error('No usable fixes in that file.');
  fixes.sort((a, b) => a.t - b.t);
  return fixes;
}
