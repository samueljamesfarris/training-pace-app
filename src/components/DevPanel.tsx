import { useEffect, useRef, useState } from 'react';
import { parseFixLog } from '../lib/sources';
import { mpsToMph } from '../lib/units';
import type { Ride, SourceKind } from '../lib/useRide';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="block py-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="font-bold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--info)]"
      />
    </label>
  );
}

/**
 * What iOS actually reports for the safe area. env() is 0 everywhere except a
 * notched device with viewport-fit=cover, and 0 in Safari's tab UI even there,
 * so reading it back is the only way to tell "the inset is applied" from "the
 * inset is zero" when a header still looks crowded.
 */
function useScreenFacts() {
  const [facts, setFacts] = useState({ insets: '—', mode: '—', viewport: '—' });
  useEffect(() => {
    const measure = () => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
        'env(safe-area-inset-bottom) env(safe-area-inset-left);';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const px = (v: string) => Math.round(parseFloat(v) || 0);
      const insets = `${px(cs.paddingTop)} ${px(cs.paddingRight)} ${px(cs.paddingBottom)} ${px(cs.paddingLeft)}`;
      probe.remove();
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as { standalone?: boolean }).standalone === true;
      setFacts({
        insets,
        mode: standalone ? 'installed' : 'browser tab',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  return facts;
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`rounded-lg px-3 py-2 text-sm font-bold ${
        on ? 'bg-info text-info-ink' : 'border border-line text-muted'
      }`}
    >
      {label}
    </button>
  );
}

export function DevPanel({ ride, onClose }: { ride: Ride; onClose: () => void }) {
  const { gps, simConfig, setSimConfig, sourceKind, setSourceKind } = ride;
  const fileRef = useRef<HTMLInputElement>(null);
  const screen = useScreenFacts();
  const [note, setNote] = useState<string | null>(null);

  const sources: { key: SourceKind; label: string }[] = [
    { key: 'geo', label: 'Real GPS' },
    { key: 'sim', label: 'Simulator' },
    { key: 'replay', label: 'Replay log' },
  ];

  async function loadLog(file: File) {
    try {
      const fixes = parseFixLog(await file.text());
      ride.setReplayFixes(fixes);
      setSourceKind('replay');
      const span = (fixes[fixes.length - 1]!.t - fixes[0]!.t) / 1000;
      setNote(`Loaded ${fixes.length} fixes spanning ${Math.round(span)}s.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  async function exportJson(copy: boolean) {
    const fixes = await ride.exportFixes();
    if (fixes.length === 0) {
      setNote('No fixes logged yet.');
      return;
    }
    const json = JSON.stringify(fixes);
    if (copy) {
      await navigator.clipboard.writeText(json);
      setNote(`Copied ${fixes.length} fixes to clipboard.`);
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ride.session?.id ?? 'session'}-fixes.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ageSec = gps.lastFixAt ? ((ride.now - gps.lastFixAt) / 1000).toFixed(1) : '--';

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-card">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-lg font-black">Dev panel</h2>
        <button
          onClick={onClose}
          className="rounded-lg bg-next px-4 py-2 text-sm font-bold text-next-ink"
        >
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <section className="py-3">
          <h3 className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Position source
          </h3>
          <div className="flex gap-2">
            {sources.map((s) => (
              <button
                key={s.key}
                onClick={() => setSourceKind(s.key)}
                disabled={s.key === 'replay' && ride.replayFixes.length === 0}
                className={`flex-1 rounded-lg px-2 py-2 text-sm font-bold disabled:opacity-40 ${
                  sourceKind === s.key
                    ? 'bg-info text-info-ink'
                    : 'border border-line text-ink'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Switching sources restarts the watch and drops the odometer anchor.
          </p>
        </section>

        {sourceKind === 'sim' && (
          <section className="border-t border-line py-3">
            <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
              Synthetic track
            </h3>
            <Slider
              label="Target speed"
              value={simConfig.targetMph}
              min={0}
              max={16}
              step={0.1}
              onChange={(v) => setSimConfig({ ...simConfig, targetMph: v })}
              format={(v) => `${v.toFixed(1)} mph`}
            />
            <Slider
              label="Speed jitter (0 = direct injection)"
              value={simConfig.jitterMph}
              min={0}
              max={4}
              step={0.1}
              onChange={(v) => setSimConfig({ ...simConfig, jitterMph: v })}
              format={(v) => `±${v.toFixed(1)} mph`}
            />
            <Slider
              label="Reported accuracy"
              value={simConfig.accuracy}
              min={3}
              max={60}
              step={1}
              onChange={(v) => setSimConfig({ ...simConfig, accuracy: v })}
              format={(v) => `${v} m`}
            />
            <div className="mt-2 flex gap-2">
              <Toggle
                label={simConfig.provideSpeed ? 'coords.speed ON' : 'coords.speed OFF'}
                on={simConfig.provideSpeed}
                onChange={(v) => setSimConfig({ ...simConfig, provideSpeed: v })}
              />
              <Toggle
                label={simConfig.dropout ? 'DROPOUT ACTIVE' : 'Force dropout'}
                on={simConfig.dropout}
                onChange={(v) => setSimConfig({ ...simConfig, dropout: v })}
              />
            </div>
          </section>
        )}

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Replay a recorded log
          </h3>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadLog(f);
            }}
            className="w-full text-sm"
          />
          {ride.replayFixes.length > 0 && (
            <Slider
              label="Replay rate"
              value={ride.replayRate}
              min={0.5}
              max={8}
              step={0.5}
              onChange={ride.setReplayRate}
              format={(v) => `${v}x`}
            />
          )}
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Smoothing
          </h3>
          <Slider
            label="Rolling window"
            value={ride.smoothingMs}
            min={500}
            max={10000}
            step={250}
            onChange={ride.setSmoothingMs}
            format={(v) => `${(v / 1000).toFixed(2)} s`}
          />
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Audio cues
          </h3>
          <p className="mb-2 text-xs text-muted">
            Tap a test button to hear each cue at the volume it will play outdoors. Audio:{' '}
            <span className="font-bold">{ride.audioState}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Toggle
              label={ride.audio.enabled ? 'SOUND ON' : 'MUTED'}
              on={ride.audio.enabled}
              onChange={(v) => ride.applyAudio({ ...ride.audio, enabled: v })}
            />
            <Toggle
              label="10s warning"
              on={ride.audio.warning}
              onChange={(v) => ride.applyAudio({ ...ride.audio, warning: v })}
            />
            <Toggle
              label="3-2-1"
              on={ride.audio.countdown}
              onChange={(v) => ride.applyAudio({ ...ride.audio, countdown: v })}
            />
            <Toggle
              label="Boundary"
              on={ride.audio.boundary}
              onChange={(v) => ride.applyAudio({ ...ride.audio, boundary: v })}
            />
            <Toggle
              label="Off target"
              on={ride.audio.offTarget}
              onChange={(v) => ride.applyAudio({ ...ride.audio, offTarget: v })}
            />
          </div>
          <Slider
            label="Volume"
            value={ride.audio.volume}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => ride.applyAudio({ ...ride.audio, volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {(['warning', 'countdown', 'boundary', 'lap', 'mile', 'offTarget'] as const).map((c) => (
              <button
                key={c}
                onClick={() => ride.previewCue(c)}
                className="flex-1 rounded-lg border border-line py-2 text-sm font-bold text-ink"
              >
                Test {c === 'warning' ? '10s' : c === 'countdown' ? '3-2-1' : c === 'offTarget' ? 'off target' : c}
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Pace tolerance
          </h3>
          <p className="mb-1 text-xs text-muted">
            How far off a segment's goal pace counts as off target. One band for
            the whole workout. A warning needs five continuous seconds outside
            it, and repeats at most every twenty.
          </p>
          <Slider
            label="Band"
            value={ride.toleranceSec}
            min={2}
            max={30}
            step={1}
            onChange={ride.setToleranceSec}
            format={(v) => `± ${v} s/mi`}
          />
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Spoken cues
          </h3>
          <p className="mb-2 text-xs text-muted">
            Speech rides on top of the beeps and is allowed to fail — iOS drops it
            silently after interruptions, so the beeps stay the real signal.
            {!ride.speechSupported && ' This browser has no speech synthesis.'}
          </p>
          <Toggle
            label={ride.speech.enabled ? 'SPEECH ON' : 'speech off'}
            on={ride.speech.enabled}
            onChange={(v) => ride.applySpeech({ ...ride.speech, enabled: v })}
          />
          <Slider
            label="Voice rate"
            value={ride.speech.rate}
            min={0.6}
            max={1.8}
            step={0.05}
            onChange={(v) => ride.applySpeech({ ...ride.speech, rate: v })}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <Slider
            label="Voice volume"
            value={ride.speech.volume}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => ride.applySpeech({ ...ride.speech, volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <button
            onClick={() => ride.previewSpeech('On 2. 1 30, 7 oh 4 pace.')}
            className="mt-1 w-full rounded-lg border border-line py-2 text-sm font-bold text-ink"
          >
            Test voice
          </button>
        </section>

        <section className="border-t border-line py-3 text-sm">
          <h3 className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Screen
          </h3>
          <Row label="safe area t r b l" value={screen.insets} />
          <Row label="launched as" value={screen.mode} />
          <Row label="viewport" value={screen.viewport} />
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-1 text-xs font-bold tracking-widest text-muted uppercase">
            Screen wake lock
          </h3>
          <p className="mb-2 text-xs text-muted">
            Held only while a session is live. State: <span className="font-bold">{ride.wakeLockState}</span>
            {!ride.wakeLockSupported && ' (not available in this browser)'}
          </p>
          <Toggle
            label={ride.wakeLockEnabled ? 'KEEP SCREEN ON' : 'screen may sleep'}
            on={ride.wakeLockEnabled}
            onChange={ride.setWakeLockEnabled}
          />
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Suspend the JS loop
          </h3>
          <div className="flex gap-2">
            {[5, 15, 30].map((s) => (
              <button
                key={s}
                onClick={() => ride.simulateBackground(s)}
                className="flex-1 rounded-lg border border-line py-2 text-sm font-bold text-ink"
              >
                {s}s
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Freezes the render tick and the fix stream, then fires visibilitychange. Elapsed time
            should jump forward by exactly that many seconds.
          </p>
        </section>

        <section className="border-t border-line py-3">
          <h3 className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Raw GPS log
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => void exportJson(false)}
              className="flex-1 rounded-lg bg-next py-2 text-sm font-bold text-next-ink"
            >
              Download JSON
            </button>
            <button
              onClick={() => void exportJson(true)}
              className="flex-1 rounded-lg border border-line py-2 text-sm font-bold text-ink"
            >
              Copy JSON
            </button>
          </div>
        </section>

        {note && (
          <p className="rounded-md bg-raised px-3 py-2 text-sm font-semibold">{note}</p>
        )}

        <section className="border-t border-line py-3 text-sm">
          <h3 className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Diagnostics
          </h3>
          <Row
            label="raw speed"
            value={gps.rawMps != null ? `${mpsToMph(gps.rawMps).toFixed(2)} mph` : '--'}
          />
          <Row
            label="smoothed speed"
            value={gps.displayMps != null ? `${mpsToMph(gps.displayMps).toFixed(2)} mph` : '--'}
          />
          <Row label="speed origin" value={gps.derivedSpeed ? 'haversine' : 'coords.speed'} />
          <Row label="accuracy" value={gps.accuracy != null ? `${gps.accuracy.toFixed(1)} m` : '--'} />
          <Row label="last fix age" value={`${ageSec} s`} />
          <Row label="stale" value={gps.stale ? 'YES' : 'no'} />
          <Row label="fixes" value={String(gps.fixCount)} />
          <Row label="rejected (accuracy)" value={String(gps.rejectedCount)} />
          <Row label="spikes rejected" value={String(gps.spikesRejected)} />
          <Row
            label="shown pace"
            value={gps.paceSecPerMile != null ? `${gps.paceSecPerMile.toFixed(1)} s/mi` : '--'}
          />
          <Row label="dropout gaps" value={String(gps.dropoutCount)} />
          <Row label="distance" value={`${gps.distanceMeters.toFixed(1)} m`} />
          <Row label="session id" value={ride.session?.id.slice(0, 19) ?? '--'} />
        </section>
      </div>
    </div>
  );
}
