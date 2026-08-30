import { useEffect, useRef, useState } from 'react';
import {
  isDefaultSegmentName,
  KIND_DEFAULT_NAME,
  KIND_LABEL,
  KINDS,
  MILE,
  type EndCondition,
  type SegmentDef,
  type SegmentKind,
} from '../lib/workouts';

/**
 * The inputs a segment is built out of, shared by both editors.
 *
 * The structured builder and the advanced block editor edit the same thing —
 * a name, a kind, an end condition and an optional goal pace — so they edit it
 * with the same controls. `TimeInput` and `DistanceInput` in particular carry
 * a lot of bug history and exist exactly once.
 */

/**
 * A new segment is named after its kind rather than the word "Segment", which
 * only duplicated the chip below it. `KIND_DEFAULT_NAME` is the one place
 * these names are spelled, so the chips, the preview and the defaults cannot
 * drift.
 */
export function newSegment(kind: SegmentKind = 'work'): SegmentDef {
  return {
    name: KIND_DEFAULT_NAME[kind],
    kind,
    end: { type: 'time', seconds: kind === 'work' ? 60 : 30 },
  };
}

export const KIND_CHIP: Record<SegmentKind, string> = {
  work: 'bg-work text-work-ink',
  recovery: 'bg-recovery text-recovery-ink',
  warmup: 'bg-neutral-kind text-neutral-kind-ink',
  cooldown: 'bg-neutral-kind text-neutral-kind-ink',
};

export function SmallButton({
  children,
  onClick,
  disabled,
  tone = 'plain',
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'danger' | 'on';
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`rounded-lg border px-2.5 py-1.5 text-sm font-bold disabled:opacity-30 ${
        tone === 'danger'
          ? 'border-stop text-stop'
          : tone === 'on'
            ? 'border-next bg-next text-next-ink'
            : 'border-line text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** Seconds read as a clock, so 5 shows as 05 — but only at rest, never mid-edit. */
function padSeconds(s: number) {
  return String(s).padStart(2, '0');
}

/**
 * Minutes + seconds, because a single field invites 90 meaning 1:30 or 0:90.
 *
 * The text is held locally so an empty box is legal while typing — coercing
 * every keystroke through `Number(x) || 0` made blank unreachable, since
 * backspacing to empty immediately rendered "0" back into the field. The parent
 * still gets a number on every keystroke, so the preview stays live.
 */
export function TimeInput({
  seconds,
  onChange,
  compact,
}: {
  seconds: number;
  onChange: (s: number) => void;
  compact?: boolean;
}) {
  const [minText, setMinText] = useState(() => String(Math.floor(seconds / 60)));
  const [secText, setSecText] = useState(() => padSeconds(seconds % 60));
  // The last value this field sent up. Anything else arriving in `seconds` came
  // from outside, and only then may we overwrite what is being typed.
  const emitted = useRef(seconds);

  useEffect(() => {
    if (seconds === emitted.current) return;
    emitted.current = seconds;
    setMinText(String(Math.floor(seconds / 60)));
    setSecText(padSeconds(seconds % 60));
  }, [seconds]);

  function commit(mRaw: string, sRaw: string) {
    const m = Math.max(0, Math.floor(Number(mRaw) || 0));
    const s = Math.min(59, Math.max(0, Math.floor(Number(sRaw) || 0)));
    const total = m * 60 + s;
    emitted.current = total;
    onChange(total);
    return total;
  }

  /** On blur, empty commits 0 and seconds settle inside 0-59. */
  function normalize() {
    const total = commit(minText, secText);
    setMinText(String(Math.floor(total / 60)));
    setSecText(padSeconds(total % 60));
  }

  const field = `${compact ? 'w-11' : 'w-14'} rounded-lg border border-line px-1 py-1.5 text-center text-base font-bold`;
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={minText}
        aria-label="minutes"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setMinText(e.target.value);
          commit(e.target.value, secText);
        }}
        className={field}
      />
      <span className="font-bold text-muted">:</span>
      {/* Padding is applied when the field is at rest, never to what is being
          typed — a padded "030" mid-edit is what turned typing 45 into 3045.
          Local text plus select-on-focus is what makes this safe now. */}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={secText}
        aria-label="seconds"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setSecText(e.target.value);
          commit(minText, e.target.value);
        }}
        className={field}
      />
    </span>
  );
}

type DistanceUnit = 'm' | 'mi';

function showDistance(meters: number, unit: DistanceUnit) {
  return unit === 'mi' ? String(+(meters / MILE).toFixed(2)) : String(Math.round(meters));
}

export function DistanceInput({
  meters,
  onChange,
  compact,
}: {
  meters: number;
  onChange: (m: number) => void;
  compact?: boolean;
}) {
  // Which unit is *displayed*. Seeded from magnitude once and then owned by the
  // user: deriving it from the value on every render meant picking "mi" on a
  // 400 m segment stored 400 miles, and typing 0.5 mi flipped back to 804 m
  // mid-keystroke.
  const [unit, setUnit] = useState<DistanceUnit>(() => (meters >= MILE ? 'mi' : 'm'));
  const [text, setText] = useState(() =>
    showDistance(meters, meters >= MILE ? 'mi' : 'm'),
  );
  const emitted = useRef(meters);

  useEffect(() => {
    if (meters === emitted.current) return;
    emitted.current = meters;
    setText(showDistance(meters, unit));
  }, [meters, unit]);

  function commit(raw: string, u: DistanceUnit) {
    const n = Math.max(0, Number(raw) || 0);
    const m = u === 'mi' ? n * MILE : n;
    emitted.current = m;
    onChange(m);
    return m;
  }

  function normalize() {
    const n = Math.max(0, Number(text) || 0);
    const m = unit === 'mi' ? n * MILE : n;
    // Compare what is *shown*, so tabbing through a field displaying 805 m
    // can't quietly round the stored 804.672 m that a 0.5 mi entry produced.
    if (showDistance(m, unit) !== showDistance(meters, unit)) {
      emitted.current = m;
      onChange(m);
      setText(showDistance(m, unit));
    } else {
      setText(showDistance(meters, unit));
    }
  }

  /** The dropdown re-expresses the same distance. The stored meters never move. */
  function changeUnit(next: DistanceUnit) {
    setUnit(next);
    setText(showDistance(meters, next));
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={unit === 'mi' ? 0.05 : 50}
        value={text}
        aria-label="distance"
        onFocus={(e) => e.target.select()}
        onBlur={normalize}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value, unit);
        }}
        className={`${compact ? 'w-16' : 'w-20'} rounded-lg border border-line px-2 py-1.5 text-center text-base font-bold`}
      />
      <select
        value={unit}
        aria-label="distance unit"
        onChange={(e) => changeUnit(e.target.value as DistanceUnit)}
        className="rounded-lg border border-line px-1.5 py-1.5 text-sm font-bold"
      >
        <option value="m">m</option>
        <option value="mi">mi</option>
      </select>
    </span>
  );
}

/**
 * An end condition: the Time/Distance choice and whichever field it needs.
 *
 * What each mode last held is remembered, so flipping between them to look at
 * the other one doesn't throw away what was already entered. The defaults are
 * only ever used the first time a mode is opened for this segment.
 */
export function EndInput({
  end,
  onChange,
  compact,
}: {
  end: EndCondition;
  onChange: (e: EndCondition) => void;
  compact?: boolean;
}) {
  const [lastSeconds, setLastSeconds] = useState(end.type === 'time' ? end.seconds : 120);
  const [lastMeters, setLastMeters] = useState(end.type === 'distance' ? end.meters : 400);
  useEffect(() => {
    if (end.type === 'time') setLastSeconds(end.seconds);
    else setLastMeters(end.meters);
  }, [end]);

  const tab = (on: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-sm font-bold ${
      on ? 'bg-next text-next-ink' : 'border border-line text-muted'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <button
          onClick={() => onChange({ type: 'time', seconds: lastSeconds })}
          className={tab(end.type === 'time')}
        >
          Time
        </button>
        <button
          onClick={() => onChange({ type: 'distance', meters: lastMeters })}
          className={tab(end.type === 'distance')}
        >
          Distance
        </button>
      </div>
      {end.type === 'time' ? (
        <TimeInput
          seconds={end.seconds}
          compact={compact}
          onChange={(s) => onChange({ type: 'time', seconds: s })}
        />
      ) : (
        <DistanceInput
          meters={end.meters}
          compact={compact}
          onChange={(m) => onChange({ type: 'distance', meters: m })}
        />
      )}
    </div>
  );
}

/**
 * The kind picker. Only offered where the kind is genuinely a choice, and only
 * over the kinds that make sense there: inside a repeat set a step is work or
 * recovery, because warmup and cooldown are sections of their own now, and
 * offering all four wrapped the row onto a second line for nothing.
 */
export function KindChips({
  seg,
  onChange,
  kinds = KINDS,
}: {
  seg: SegmentDef;
  onChange: (s: SegmentDef) => void;
  kinds?: SegmentKind[];
}) {
  return (
    <>
      {kinds.map((k) => (
        <button
          key={k}
          onClick={() =>
            onChange({
              ...seg,
              kind: k,
              // Follow the kind only while the name is still a default. A name
              // he typed is his, and changing the type must not quietly
              // overwrite it.
              name: isDefaultSegmentName(seg.name) ? KIND_DEFAULT_NAME[k] : seg.name,
            })
          }
          className={`rounded px-2 py-1 text-[11px] font-black tracking-widest ${
            seg.kind === k ? KIND_CHIP[k] : 'border border-line text-muted'
          }`}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </>
  );
}

/**
 * Goal pace. Optional, and absent by default: most segments don't have one,
 * and an empty field invites filling in.
 */
export function TargetField({
  seg,
  onChange,
}: {
  seg: SegmentDef;
  onChange: (s: SegmentDef) => void;
}) {
  return (
    <>
      {seg.targetPaceSecPerMile == null ? (
        <SmallButton onClick={() => onChange({ ...seg, targetPaceSecPerMile: 480 })}>
          + Goal pace
        </SmallButton>
      ) : (
        <>
          <TimeInput
            seconds={seg.targetPaceSecPerMile}
            onChange={(v) => onChange({ ...seg, targetPaceSecPerMile: v })}
          />
          <span className="text-xs font-bold text-muted">/ mile</span>
          <SmallButton
            onClick={() => {
              const { targetPaceSecPerMile: _drop, ...rest } = seg;
              onChange(rest);
            }}
            tone="danger"
            label="Remove goal pace"
          >
            ✕
          </SmallButton>
        </>
      )}
    </>
  );
}

/** Name, kind, goal pace and end condition — a whole segment, in one block. */
export function SegmentFields({
  seg,
  onChange,
  kinds,
  showEnd = true,
  namePlaceholder = 'Segment name',
}: {
  seg: SegmentDef;
  onChange: (s: SegmentDef) => void;
  /** Omit to fix the kind; a one-entry list is fixed too. */
  kinds?: SegmentKind[];
  showEnd?: boolean;
  namePlaceholder?: string;
}) {
  return (
    <>
      <input
        value={seg.name}
        onChange={(e) => onChange({ ...seg, name: e.target.value })}
        placeholder={namePlaceholder}
        aria-label="Segment name"
        className="w-full min-w-0 rounded-lg border border-line px-2 py-1.5 text-base font-bold"
      />
      {/* Kind and goal pace share a row. Apart they were two near-empty lines,
          which on a phone is most of a step card spent saying nothing. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {kinds && kinds.length > 1 && (
          <KindChips seg={seg} onChange={onChange} kinds={kinds} />
        )}
        <TargetField seg={seg} onChange={onChange} />
      </div>
      {showEnd && (
        <div className="mt-2">
          <EndInput end={seg.end} onChange={(end) => onChange({ ...seg, end })} />
        </div>
      )}
    </>
  );
}
