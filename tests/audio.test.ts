/** Deterministic test of BeepEngine against a fake Web Audio implementation. */
let fails = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ': ' + detail : ''}`);
}

interface FakeOsc {
  freq: number;
  startedAt: number;
  stoppedEarly: boolean;
}
const created: FakeOsc[] = [];
let paramWrites: number[] = [];

class FakeParam {
  value = 0;
  setValueAtTime(_v: number, t: number) {
    paramWrites.push(t);
    if (!(t >= 0)) throw new RangeError(`Time must be non-negative: ${t}`);
  }
  exponentialRampToValueAtTime(_v: number, t: number) {
    paramWrites.push(t);
    if (!(t >= 0)) throw new RangeError(`Time must be non-negative: ${t}`);
  }
}

class FakeCtx {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain() {
    return { gain: new FakeParam(), connect() {} };
  }
  createOscillator() {
    const rec: FakeOsc = { freq: 0, startedAt: -1, stoppedEarly: false };
    created.push(rec);
    return {
      type: '',
      frequency: { value: 0, set(v: number) {} },
      connect() {},
      start: (t: number) => {
        rec.startedAt = t;
      },
      stop: (t?: number) => {
        if (t === undefined) rec.stoppedEarly = true;
      },
      set onended(_f: unknown) {},
      get frequencyRef() {
        return rec;
      },
    } as unknown as OscillatorNode & { frequencyRef: FakeOsc };
  }
  resume() {
    return Promise.resolve();
  }
}

// Wire the fake into the module's globals before importing it.
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).AudioContext = FakeCtx;

const { BeepEngine } = await import(
  '../src/lib/audio.ts'
);

console.log('--- a brand-new context starts at currentTime 0 ---');
{
  created.length = 0;
  paramWrites = [];
  const e = new BeepEngine();
  let threw = false;
  try {
    e.init();
  } catch {
    threw = true;
  }
  ok('init does not throw on a fresh context', !threw);
  ok('no negative AudioParam times', paramWrites.every((t) => t >= 0),
     `min ${Math.min(...paramWrites)}`);
  ok('audio is usable after init', e.ready);
}

console.log('\n--- the boundary tone must survive the reschedule it triggers ---');
{
  const e = new BeepEngine();
  e.init();
  const ctx = (e as unknown as { ctx: FakeCtx }).ctx;
  created.length = 0;

  // Schedule a boundary 2s out, plus a countdown 1s out.
  const now = Date.now();
  e.scheduleAt('countdown', now + 1000);
  e.scheduleAt('boundary', now + 2000);
  ok('two cues scheduled', created.length === 2, `${created.length}`);

  // Advance the audio clock past the boundary's start, as happens when the
  // segment rolls over, then reschedule.
  ctx.currentTime = 2.5;
  e.cancelPending();

  const countdown = created[0]!;
  const boundary = created[1]!;
  ok('the already-sounding boundary tone is NOT cancelled', !boundary.stoppedEarly);
  ok('the already-passed countdown is NOT cancelled', !countdown.stoppedEarly);
}

console.log('\n--- but genuinely future cues still get cancelled on a pause ---');
{
  const e = new BeepEngine();
  e.init();
  const ctx = (e as unknown as { ctx: FakeCtx }).ctx;
  created.length = 0;
  const now = Date.now();
  e.scheduleAt('warning', now + 5000);
  e.scheduleAt('boundary', now + 15000);
  ctx.currentTime = 0.5; // nothing has sounded yet
  e.cancelPending();
  ok('all pending cues cancelled', created.every((c) => c.stoppedEarly),
     `${created.filter((c) => c.stoppedEarly).length}/${created.length}`);
}

console.log('\n--- muting and per-cue toggles ---');
{
  const e = new BeepEngine();
  e.init();
  created.length = 0;
  e.settings = { ...e.settings, enabled: false };
  e.scheduleAt('boundary', Date.now() + 5000);
  ok('muted schedules nothing', created.length === 0, `${created.length}`);

  e.settings = { ...e.settings, enabled: true, warning: false };
  e.scheduleAt('warning', Date.now() + 5000);
  ok('a disabled cue schedules nothing', created.length === 0, `${created.length}`);
  e.scheduleAt('boundary', Date.now() + 5000);
  ok('an enabled cue still schedules', created.length === 1, `${created.length}`);
}

console.log('\n--- a cue whose moment has passed is not scheduled late ---');
{
  const e = new BeepEngine();
  e.init();
  created.length = 0;
  const scheduled = e.scheduleAt('boundary', Date.now() - 3000);
  ok('past cue is skipped, not fired late', scheduled === false && created.length === 0);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
