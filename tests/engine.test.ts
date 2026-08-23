import { formatPace, formatSpeed, formatClock, mpsToMph, averageMph } from '../src/lib/units.ts';
import { GpsEngine } from '../src/lib/gpsEngine.ts';
import { project, haversineMeters } from '../src/lib/geo.ts';
import { elapsedMs, type SessionRecord } from '../src/lib/types.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}
function near(label: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got.toFixed(3)}${ok ? '' : ` (want ~${want})`}`);
}

console.log('--- pace math ---');
eq('6.7 mph', formatPace(6.7), '8:57');           // spec working range low end
eq('15.0 mph', formatPace(15.0), '4:00');         // spec working range high end
eq('6.666.. mph', formatPace(60 / 9), '9:00');
eq('10 mph', formatPace(10), '6:00');
// The floor is a sanity check against a parked phone's noise, not a judgement
// about speed: at 3 mph it blanked the hero during a walk-back recovery.
eq('below the 2 mph floor', formatPace(1.9), '--:--');
eq('a walk-back recovery still reads a pace', formatPace(2.9), '20:41');
eq('above 25 mph', formatPace(25.1), '--:--');
eq('null', formatPace(null), '--:--');
eq('speed fmt', formatSpeed(8.049), '8.0');
eq('clock <1h', formatClock(65_000), '1:05');
eq('clock >1h', formatClock(3_725_000), '1:02:05');
eq('mps->mph', mpsToMph(4.4704).toFixed(2), '10.00');
eq('avg pace 1mi in 8min', formatPace(averageMph(1609.344, 8 * 60_000)!), '8:00');

console.log('\n--- timing model (timestamps, not ticks) ---');
const base = 1_700_000_000_000;
const rec: SessionRecord = {
  id: 'x', createdAt: base, startedAt: base,
  pauses: [{ start: base + 60_000, end: base + 90_000 }],
  finishedAt: null, status: 'running', distanceMeters: 0, fixCount: 0, source: 'sim',
};
eq('elapsed excludes pause', elapsedMs(rec, base + 120_000), 90_000);
const open: SessionRecord = { ...rec, pauses: [{ start: base + 60_000, end: null }], status: 'paused' };
eq('open pause holds clock', elapsedMs(open, base + 300_000), 60_000);
eq('30min gap while suspended still counted', elapsedMs(rec, base + 1_800_000), 1_770_000);

console.log('\n--- gps engine: distance at a known speed ---');
{
  const e = new GpsEngine();
  let lat = 37.0, lon = -122.0;
  const mps = 8 / 2.2369362920544; // 8 mph
  for (let i = 0; i < 60; i++) {
    const t = base + i * 1000;
    const p = project(lat, lon, 45, i === 0 ? 0 : mps);
    lat = p.lat; lon = p.lon;
    e.ingest({ t, lat, lon, speed: mps, accuracy: 8, altitude: null, heading: 45, source: 'sim' }, t);
  }
  // 59 one-second steps at 8 mph
  near('distance after 60s @8mph (m)', e.distanceMeters, mps * 59, 1);
  near('smoothed mph', mpsToMph(e.snapshot(base + 59_000).displayMps!), 8, 0.01);
  eq('not stale', e.snapshot(base + 59_000).stale, false);
  eq('stale after 6s', e.snapshot(base + 65_000).stale, true);
  eq('frozen value survives stale', mpsToMph(e.snapshot(base + 65_000).displayMps!).toFixed(1), '8.0');
}

console.log('\n--- gps engine: haversine fallback when coords.speed is null ---');
{
  const e = new GpsEngine();
  let lat = 37.0, lon = -122.0;
  const mps = 10 / 2.2369362920544;
  for (let i = 0; i < 10; i++) {
    const t = base + i * 1000;
    const p = project(lat, lon, 90, i === 0 ? 0 : mps);
    lat = p.lat; lon = p.lon;
    e.ingest({ t, lat, lon, speed: null, accuracy: 6, altitude: null, heading: 90, source: 'sim' }, t);
  }
  const s = e.snapshot(base + 9000);
  near('derived mph', mpsToMph(s.displayMps!), 10, 0.05);
  eq('flagged as haversine', s.derivedSpeed, true);
}

console.log('\n--- gps engine: stopped at a light does not drift ---');
{
  const e = new GpsEngine();
  for (let i = 0; i < 30; i++) {
    const t = base + i * 1000;
    // jitter the position by a few meters, as a parked phone does
    const p = project(37.0, -122.0, Math.random() * 360, Math.random() * 3);
    e.ingest({ t, lat: p.lat, lon: p.lon, speed: 0.1, accuracy: 8, altitude: null, heading: null, source: 'sim' }, t);
  }
  eq('odometer stayed at zero', e.distanceMeters.toFixed(1), '0.0');
}

console.log('\n--- gps engine: parked with NO device speed (geometry defense only) ---');
{
  const e = new GpsEngine();
  for (let i = 0; i < 300; i++) {
    const t = base + i * 1000;
    // wander across the full accuracy circle — harsher than a real parked phone
    const p = project(37.0, -122.0, Math.random() * 360, Math.random() * 8);
    e.ingest({ t, lat: p.lat, lon: p.lon, speed: null, accuracy: 8, altitude: null, heading: null, source: 'sim' }, t);
  }
  // 5 minutes of parked jitter. Some creep is unavoidable without a speed
  // signal; it must stay small enough to be invisible on a 0.01 mile display.
  const miles = e.distanceMeters / 1609.344;
  console.log(`     creep over 5 parked minutes: ${e.distanceMeters.toFixed(1)} m (${miles.toFixed(3)} mi)`);
  const ok = miles < 0.02;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} creep under 0.02 mi`);
}

console.log('\n--- gps engine: MOVING with no device speed still measures distance ---');
{
  const e = new GpsEngine();
  let lat = 37.0, lon = -122.0;
  const mps = 10 / 2.2369362920544;
  for (let i = 0; i < 61; i++) {
    const t = base + i * 1000;
    const p = project(lat, lon, 30, i === 0 ? 0 : mps);
    lat = p.lat; lon = p.lon;
    e.ingest({ t, lat, lon, speed: null, accuracy: 8, altitude: null, heading: 30, source: 'sim' }, t);
  }
  // Truth is 60 x 4.47m = 268m; the open leg may hold back up to one floor (16m).
  near('distance over 60s @10mph, no coords.speed', e.distanceMeters, 262, 18);
}

console.log('\n--- gps engine: accuracy gate + dropout ---');
{
  const e = new GpsEngine();
  const mps = 4.0;
  let lat = 37.0, lon = -122.0;
  const step = (t: number, accuracy: number) => {
    const p = project(lat, lon, 0, mps);
    lat = p.lat; lon = p.lon;
    e.ingest({ t, lat, lon, speed: mps, accuracy, altitude: null, heading: 0, source: 'sim' }, t);
  };
  step(base, 8);
  step(base + 1000, 8);           // +4m
  step(base + 2000, 80);          // rejected for distance
  step(base + 3000, 8);           // measured from the last GOOD fix: +8m
  near('gate keeps bad fix out but bridges good ones', e.distanceMeters, 12, 0.2);
  eq('one rejection counted', e.snapshot(base + 3000).rejectedCount, 1);

  const before = e.distanceMeters;
  // 20s hole, then fixes resume far away
  lat = project(lat, lon, 0, 200).lat;
  e.ingest({ t: base + 23_000, lat, lon, speed: mps, accuracy: 8, altitude: null, heading: 0, source: 'sim' }, base + 23_000);
  eq('no straight-line jump across the dropout', e.distanceMeters, before);
  eq('dropout counted', e.snapshot(base + 23_000).dropoutCount, 1);
  step(base + 24_000, 8);
  near('accumulation resumes from the first new good fix', e.distanceMeters - before, 4, 0.2);
}

console.log('\n--- haversine sanity ---');
near('1 deg latitude ~111.2km', haversineMeters(0, 0, 1, 0), 111195, 100);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
