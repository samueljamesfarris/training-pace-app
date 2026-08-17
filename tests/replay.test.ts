import { GpsEngine } from '../src/lib/gpsEngine.ts';
import type { RawFix } from '../src/lib/types.ts';
import { formatPaceSeconds, mpsToMph } from '../src/lib/units.ts';
import { readFileSync } from 'node:fs';

const path = process.argv[2]!;
const fixes: RawFix[] = JSON.parse(readFileSync(path, 'utf8'));
let fails = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ': ' + detail : ''}`);
}

/** Feed a fix list through the real engine, sampling what the screen shows. */
function run(list: RawFix[]) {
  const e = new GpsEngine();
  const shown: (number | null)[] = [];
  const speeds: (number | null)[] = [];
  for (const f of list) {
    e.ingest(f, f.t);
    const s = e.snapshot(f.t);
    shown.push(s.paceSecPerMile);
    speeds.push(s.displayMps == null ? null : mpsToMph(s.displayMps));
  }
  return { engine: e, shown, speeds };
}

console.log('=== real ride replayed through the shipped engine ===');
const real = run(fixes);
const moves: number[] = [];
for (let i = 1; i < real.shown.length; i++) {
  const a = real.shown[i - 1], b = real.shown[i];
  if (a != null && b != null && a !== b) moves.push(Math.abs(b - a));
}
moves.sort((x, y) => x - y);
const perMin = Math.round((moves.length / fixes.length) * 60);
console.log(`   pace changes/min ${perMin}, typical ${Math.round(moves[Math.floor(moves.length / 2)]!)} s/mi, worst ${Math.round(moves[Math.floor(moves.length * 0.9)]!)} s/mi`);
ok('fewer than 50 pace changes per minute (was 58 raw)', perMin < 50, `${perMin}/min`);
const rejected = real.engine.snapshot(fixes[fixes.length - 1]!.t).spikesRejected;
ok('spike gate stays quiet on real data', rejected / fixes.length < 0.02,
   `${rejected}/${fixes.length} fixes`);
console.log(`   distance: ${(real.engine.distanceMeters / 1609.344).toFixed(3)} mi over ${((fixes[fixes.length-1]!.t - fixes[0]!.t)/1000).toFixed(0)}s`);

console.log('\n=== injected spike, the thing he saw on the ride ===');
{
  const spiked = fixes.map((f, i) => (i === 100 ? { ...f, speed: 11.2 } : f)); // ~25 mph
  const r = run(spiked);
  const trueMph = mpsToMph(fixes[100]!.speed!);
  const shownMph = r.speeds[100]!;
  console.log(`   true ${trueMph.toFixed(2)} mph, displayed ${shownMph.toFixed(2)} mph`);
  ok('spike does not reach the display', Math.abs(shownMph - trueMph) < 1.0);
  ok('spike is counted', r.engine.snapshot(spiked[101]!.t).spikesRejected >= 1);
  ok('display recovers immediately after', Math.abs(r.speeds[102]! - mpsToMph(fixes[102]!.speed!)) < 1.0);
}

console.log('\n=== a genuine hard surge must NOT be gated away ===');
{
  // Self-contained: 20s cruising at 6 mph, then 8s accelerating to ~12 mph.
  // Built synthetically so the assertion means the same thing for any log.
  const t0 = 1_700_000_000_000;
  const seq: RawFix[] = [];
  let lat = 37;
  for (let i = 0; i < 28; i++) {
    const mph = i < 20 ? 6 : 6 + (i - 19) * 0.75;
    const mps = mph / 2.2369362920544;
    lat += mps / 111_320;
    seq.push({ t: t0 + i * 1000, lat, lon: -122, speed: mps, accuracy: 5,
      altitude: null, heading: 0, source: 'geo' });
  }
  const r = run(seq);
  const trueEnd = mpsToMph(seq[27]!.speed!);
  const shownEnd = r.speeds[27]!;
  console.log(`   after 8s surge: true ${trueEnd.toFixed(2)} mph, displayed ${shownEnd.toFixed(2)} mph`);
  ok('surge is tracked, not blocked', shownEnd > trueEnd - 3.0, `${shownEnd.toFixed(2)} vs ${trueEnd.toFixed(2)}`);
}

console.log('\n=== standing still: rocking the phone must not flash a pace ===');
{
  const t0 = fixes[0]!.t;
  const still: RawFix[] = [];
  for (let i = 0; i < 180; i++) {
    // parked, but rocking: device speed noise up to ~3.5 mph in bursts
    const noise = i % 7 === 0 ? 1.55 : Math.random() * 0.5;
    still.push({ t: t0 + i * 1000, lat: 37 + Math.random() * 1e-5, lon: -122 + Math.random() * 1e-5,
      speed: noise, accuracy: 4, altitude: null, heading: null, source: 'geo' });
  }
  const r = run(still);
  const everShowed = r.shown.some((p) => p != null);
  ok('pace stays --:-- for 3 parked minutes', !everShowed,
      everShowed ? `flashed ${formatPaceSeconds(r.shown.find((p) => p != null)!)}` : 'never flashed');
  const maxSpeed = Math.max(...r.speeds.map((s) => s ?? 0));
  ok('displayed speed stays under 1 mph', maxSpeed < 1.0, `${maxSpeed.toFixed(2)} mph`);
  ok('odometer stays at zero', r.engine.distanceMeters < 1, `${r.engine.distanceMeters.toFixed(1)} m`);
}

console.log('\n=== null coords.speed + poor accuracy must not invent a pace ===');
{
  // The evening ride's flutter: two consecutive null-speed fixes ~3m apart with
  // ~12m accuracy. Naive differencing called that 6.7 mph from a parked bike.
  const t0 = 1_700_000_000_000;
  const mk = (i: number, lat: number, acc: number): RawFix => ({
    t: t0 + i * 1000, lat, lon: -122, speed: null, accuracy: acc,
    altitude: null, heading: null, source: 'geo',
  });
  const e = new GpsEngine();
  // ~3m of wander back and forth, 12m accuracy, for 30s
  for (let i = 0; i < 30; i++) {
    e.ingest(mk(i, 37 + (i % 2 ? 2.7e-5 : 0), 12), t0 + i * 1000);
  }
  const s = e.snapshot(t0 + 29_000);
  ok('no phantom pace from wander at 12m accuracy', s.paceSecPerMile === null,
     s.paceSecPerMile ? formatPaceSeconds(s.paceSecPerMile) : 'none');
  ok('no phantom speed', (s.displayMps ?? 0) < 0.3, `${mpsToMph(s.displayMps ?? 0).toFixed(2)} mph`);
  ok('odometer unmoved', e.distanceMeters < 1, `${e.distanceMeters.toFixed(1)} m`);
}

console.log('\n=== but real movement with null coords.speed is still tracked ===');
{
  const t0 = 1_700_000_000_000;
  const e = new GpsEngine();
  let lat = 37;
  const mps = 10 / 2.2369362920544; // 10 mph
  for (let i = 0; i < 40; i++) {
    // 4.47m per second northwards, 8m accuracy, no device speed
    if (i > 0) lat += (mps / 111_320);
    e.ingest({ t: t0 + i * 1000, lat, lon: -122, speed: null, accuracy: 8,
      altitude: null, heading: 0, source: 'geo' }, t0 + i * 1000);
    // Sample as the app's tick does; the pace hysteresis is time-based and
    // needs to observe the value repeatedly, not once at the end.
    e.snapshot(t0 + i * 1000);
  }
  const s = e.snapshot(t0 + 39_000);
  const shown = mpsToMph(s.displayMps ?? 0);
  ok('speed tracked over the longer baseline', Math.abs(shown - 10) < 2, `${shown.toFixed(1)} mph`);
  ok('pace is shown', s.paceSecPerMile != null, formatPaceSeconds(s.paceSecPerMile));
  const miles = e.distanceMeters / 1609.344;
  ok('distance accumulates', Math.abs(miles - 0.108) < 0.02, `${miles.toFixed(3)} mi`);
}

console.log('\n=== acquiring is distinguished from a real dropout ===');
{
  const t0 = 1_700_000_000_000;
  const e = new GpsEngine();
  ok('acquiring before any fix', e.snapshot(t0).acquiring === true);
  for (let i = 0; i < 10; i++) {
    e.ingest({ t: t0 + i * 1000, lat: 37 + i * 4e-5, lon: -122, speed: 4, accuracy: 5,
      altitude: null, heading: 0, source: 'geo' }, t0 + i * 1000);
  }
  ok('not acquiring once a reading exists', e.snapshot(t0 + 9000).acquiring === false);
  const late = e.snapshot(t0 + 30_000);
  ok('a later gap is a real dropout, not acquiring', late.stale && !late.acquiring);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
