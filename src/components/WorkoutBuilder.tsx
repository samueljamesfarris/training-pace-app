import { useState } from 'react';
import { formatClock } from '../lib/units';
import { LIMITS } from '../lib/share';
import {
  blankPlan,
  clonePlan,
  coalesceBlocks,
  endLabel,
  inferPlan,
  KIND_DEFAULT_NAME,
  MILE,
  plannedMeters,
  plannedSeconds,
  planToBlocks,
  resolveWorkout,
  type EndCondition,
  type MainSection,
  type RepeatStep,
  type SegmentDef,
  type SegmentKind,
  type WorkoutBlock,
  type WorkoutDef,
  type WorkoutPlan,
} from '../lib/workouts';
import { BlockEditor } from './BlockEditor';
import {
  DistanceInput,
  KIND_CHIP,
  newSegment,
  SegmentFields,
  SmallButton,
  TimeInput,
} from './SegmentInputs';

/**
 * The workout builder.
 *
 * A workout has a shape — warm up, one main section, cool down — and that is
 * what this edits. The main section is one steady piece or one set of reps,
 * because those are the two workouts that actually get run; anything else goes
 * to the advanced editor, which still edits blocks directly.
 *
 * The plan is never the stored truth. Saving compiles it to blocks, which is
 * what the session engine walks and what a share link carries.
 */

/**
 * Inside the structure, a segment is work or recovery. Warmup and cooldown are
 * sections of their own, so offering them again in the middle of a set only
 * invited a workout whose parts contradict its shape.
 */
const SET_KINDS: SegmentKind[] = ['work', 'recovery'];

function summarize(segments: SegmentDef[]): string {
  const secs = plannedSeconds(segments);
  const meters = plannedMeters(segments);
  return [
    `${segments.length} segment${segments.length === 1 ? '' : 's'}`,
    secs != null && secs > 0 ? formatClock(secs * 1000) : null,
    meters > 0 ? `${(meters / MILE).toFixed(2)} mi` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A titled card, with the on/off switch for the sections that have one. */
function Section({
  title,
  hint,
  present,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  hint?: string;
  present: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="mb-3 rounded-2xl border-2 border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-black tracking-widest text-muted uppercase">{title}</h3>
        <span className="flex-1" />
        {present && onRemove && (
          <SmallButton onClick={onRemove} tone="danger">
            Remove
          </SmallButton>
        )}
        {!present && onAdd && <SmallButton onClick={onAdd}>+ Add</SmallButton>}
      </div>
      {present ? (
        <div className="mt-2">{children}</div>
      ) : (
        hint && <p className="mt-1 text-sm text-muted">{hint}</p>
      )}
    </section>
  );
}

/**
 * A ladder's rungs: one end condition per round.
 *
 * The Time/Distance choice belongs to the whole ladder — a set that measures
 * some rounds in minutes and others in meters is not a ladder, it is two
 * workouts — but each rung keeps its own unit, because 400m, 800m and 1 mile
 * is a perfectly ordinary ladder to want.
 */
function LadderRungs({
  perRound,
  onChange,
}: {
  perRound: EndCondition[];
  onChange: (rungs: EndCondition[]) => void;
}) {
  const type = perRound[0]?.type ?? 'distance';

  function setType(next: 'time' | 'distance') {
    if (next === type) return;
    onChange(
      perRound.map((e) =>
        next === 'time'
          ? { type: 'time', seconds: e.type === 'time' ? e.seconds : 120 }
          : { type: 'distance', meters: e.type === 'distance' ? e.meters : 400 },
      ),
    );
  }

  function setRung(i: number, end: EndCondition) {
    onChange(perRound.map((e, j) => (j === i ? end : e)));
  }

  const tab = (on: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-sm font-bold ${
      on ? 'bg-next text-next-ink' : 'border border-line text-muted'
    }`;

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        <button onClick={() => setType('time')} className={tab(type === 'time')}>
          Time
        </button>
        <button onClick={() => setType('distance')} className={tab(type === 'distance')}>
          Distance
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {perRound.map((end, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg bg-raised px-1.5 py-1">
            <span className="text-[11px] font-black text-muted">{i + 1}</span>
            {end.type === 'time' ? (
              <TimeInput
                seconds={end.seconds}
                compact
                onChange={(s) => setRung(i, { type: 'time', seconds: s })}
              />
            ) : (
              <DistanceInput
                meters={end.meters}
                compact
                onChange={(m) => setRung(i, { type: 'distance', meters: m })}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCard({
  step,
  rounds,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  step: RepeatStep;
  rounds: number;
  index: number;
  total: number;
  onChange: (s: RepeatStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const varies = step.perRound != null;
  const mirrors = step.matchPrevious === true;

  return (
    <div className="mb-2 rounded-xl border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-black ${KIND_CHIP[step.kind]}`}>
          {index + 1}
        </span>
        <span className="flex-1" />
        <SmallButton onClick={() => onMove(-1)} disabled={index === 0} label="Move up">
          ↑
        </SmallButton>
        <SmallButton onClick={() => onMove(1)} disabled={index === total - 1} label="Move down">
          ↓
        </SmallButton>
        <SmallButton onClick={onRemove} disabled={total <= 1} tone="danger" label="Remove step">
          ✕
        </SmallButton>
      </div>

      <div className="mt-2">
        <SegmentFields
          seg={step}
          onChange={(s) => onChange({ ...step, ...s })}
          kinds={SET_KINDS}
          showEnd={!varies && !mirrors}
          namePlaceholder={varies ? `auto — ${endLabel(step.perRound![0]!)}, …` : 'Step name'}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* A step that varies is what makes a set a ladder. Mutually exclusive
            with mirroring: a rung can't both set the distance and copy it. */}
        <SmallButton
          tone={varies ? 'on' : 'plain'}
          onClick={() => {
            if (varies) {
              const { perRound: _drop, ...rest } = step;
              onChange(rest);
            } else {
              const { matchPrevious: _drop, ...rest } = step;
              onChange({
                ...rest,
                perRound: Array.from({ length: rounds }, () => ({ ...step.end })),
              });
            }
          }}
        >
          Varies by round
        </SmallButton>
        {index > 0 && (
          <SmallButton
            tone={mirrors ? 'on' : 'plain'}
            onClick={() => {
              if (mirrors) {
                const { matchPrevious: _drop, ...rest } = step;
                onChange(rest);
              } else {
                const { perRound: _drop, ...rest } = step;
                onChange({ ...rest, matchPrevious: true });
              }
            }}
          >
            Match the step above
          </SmallButton>
        )}
      </div>

      {varies && <LadderRungs perRound={step.perRound!} onChange={(perRound) => onChange({ ...step, perRound })} />}
      {mirrors && (
        <p className="mt-2 text-sm text-muted">
          Takes whatever the step above measures, round by round.
        </p>
      )}
    </div>
  );
}

/** Keep `perRound` exactly as long as there are rounds to run. */
function fitRungs(step: RepeatStep, rounds: number): RepeatStep {
  if (!step.perRound) return step;
  const out = step.perRound.slice(0, rounds);
  while (out.length < rounds) out.push({ ...(out[out.length - 1] ?? step.end) });
  return { ...step, perRound: out };
}

function MainEditor({
  main,
  resolvedCount,
  onChange,
}: {
  main: MainSection;
  resolvedCount: number;
  onChange: (m: MainSection) => void;
}) {
  const [lastSteady, setLastSteady] = useState<SegmentDef>(() =>
    main.kind === 'steady'
      ? main.segment
      : { name: 'Tempo', kind: 'work', end: { type: 'distance', meters: 3 * MILE } },
  );
  const [lastRepeat, setLastRepeat] = useState<Extract<MainSection, { kind: 'repeat' }>>(() =>
    main.kind === 'repeat'
      ? main
      : {
          kind: 'repeat',
          rounds: 4,
          dropFinalRecovery: true,
          steps: [newSegment('work'), newSegment('recovery')],
        },
  );

  function remember(next: MainSection) {
    if (next.kind === 'steady') setLastSteady(next.segment);
    else setLastRepeat(next);
    onChange(next);
  }

  const tab = (on: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-black ${
      on ? 'bg-next text-next-ink' : 'border border-line text-muted'
    }`;

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => main.kind !== 'steady' && onChange({ kind: 'steady', segment: lastSteady })}
          className={tab(main.kind === 'steady')}
        >
          One piece
        </button>
        <button
          onClick={() => main.kind !== 'repeat' && onChange(lastRepeat)}
          className={tab(main.kind === 'repeat')}
        >
          Repeats
        </button>
      </div>

      {main.kind === 'steady' ? (
        <div className="mt-3 rounded-xl border border-line bg-surface p-2">
          <SegmentFields
            seg={main.segment}
            kinds={SET_KINDS}
            onChange={(segment) => remember({ kind: 'steady', segment })}
            namePlaceholder="Tempo, long run, …"
          />
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <SmallButton
              onClick={() =>
                remember({
                  ...main,
                  rounds: Math.max(1, main.rounds - 1),
                  steps: main.steps.map((s) => fitRungs(s, Math.max(1, main.rounds - 1))),
                })
              }
              disabled={main.rounds <= 1}
              label="One fewer round"
            >
              −
            </SmallButton>
            <span className="text-2xl font-black">{main.rounds}×</span>
            <SmallButton
              onClick={() =>
                remember({
                  ...main,
                  rounds: main.rounds + 1,
                  steps: main.steps.map((s) => fitRungs(s, main.rounds + 1)),
                })
              }
              // Bounded by what a share link is allowed to carry, so anything
              // built here can always be sent to somebody.
              disabled={
                main.rounds >= LIMITS.repeat.max ||
                resolvedCount + main.steps.length > LIMITS.resolvedSegments
              }
              label="One more round"
            >
              +
            </SmallButton>
            <span className="text-sm font-bold text-muted">
              round{main.rounds === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-3 border-l-2 border-line pl-3">
            {main.steps.map((step, i) => (
              <StepCard
                key={i}
                step={step}
                rounds={main.rounds}
                index={i}
                total={main.steps.length}
                onChange={(next) =>
                  remember({
                    ...main,
                    steps: main.steps.map((s, j) => (j === i ? next : s)),
                  })
                }
                onRemove={() =>
                  remember({ ...main, steps: main.steps.filter((_, j) => j !== i) })
                }
                onMove={(dir) => {
                  const j = i + dir;
                  if (j < 0 || j >= main.steps.length) return;
                  const steps = main.steps.slice();
                  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
                  // The first step can't mirror anything above it.
                  if (steps[0]?.matchPrevious) {
                    const { matchPrevious: _drop, ...rest } = steps[0]!;
                    steps[0] = rest;
                  }
                  remember({ ...main, steps });
                }}
              />
            ))}
            <SmallButton
              onClick={() =>
                remember({ ...main, steps: [...main.steps, newSegment('recovery')] })
              }
              disabled={
                main.steps.length >= LIMITS.segmentsPerBlock ||
                resolvedCount + main.rounds > LIMITS.resolvedSegments
              }
            >
              + Step to each round
            </SmallButton>
          </div>

          {main.steps.length > 1 && (
            <label className="mt-3 flex items-start gap-2 text-sm font-bold text-muted">
              <input
                type="checkbox"
                checked={main.dropFinalRecovery}
                onChange={(e) => remember({ ...main, dropFinalRecovery: e.target.checked })}
                className="mt-0.5 size-4"
              />
              <span>
                End on {main.steps[0]!.name || KIND_DEFAULT_NAME[main.steps[0]!.kind]} — skip the
                last {main.steps[main.steps.length - 1]!.name || 'step'} on the final round
              </span>
            </label>
          )}
        </>
      )}
    </>
  );
}

function PlanEditor({
  plan,
  onChange,
}: {
  plan: WorkoutPlan;
  onChange: (p: WorkoutPlan) => void;
}) {
  const resolvedCount = resolveWorkout({
    id: 'draft',
    name: 'draft',
    blocks: planToBlocks(plan),
  }).segments.length;

  return (
    <>
      <Section
        title="Warm up"
        hint="No warmup — the workout starts on the main section."
        present={plan.warmup != null}
        onAdd={() =>
          onChange({
            ...plan,
            warmup: { name: 'Warmup', kind: 'warmup', end: { type: 'time', seconds: 600 } },
          })
        }
        onRemove={() => onChange({ ...plan, warmup: null })}
      >
        {plan.warmup && (
          <SegmentFields
            seg={plan.warmup}
            onChange={(warmup) => onChange({ ...plan, warmup })}
            namePlaceholder="Warmup"
          />
        )}
      </Section>

      <Section title="Main" present>
        <MainEditor
          main={plan.main}
          resolvedCount={resolvedCount}
          onChange={(main) => onChange({ ...plan, main })}
        />
      </Section>

      <Section
        title="Cool down"
        hint="No cooldown — the workout ends on the main section."
        present={plan.cooldown != null}
        onAdd={() =>
          onChange({
            ...plan,
            cooldown: { name: 'Cooldown', kind: 'cooldown', end: { type: 'time', seconds: 300 } },
          })
        }
        onRemove={() => onChange({ ...plan, cooldown: null })}
      >
        {plan.cooldown && (
          <SegmentFields
            seg={plan.cooldown}
            onChange={(cooldown) => onChange({ ...plan, cooldown })}
            namePlaceholder="Cooldown"
          />
        )}
      </Section>
    </>
  );
}

export function WorkoutBuilder({
  initial,
  isNew,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: WorkoutDef;
  isNew: boolean;
  onSave: (w: WorkoutDef) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  // A workout arrives structured, or it doesn't. Anything the shape can't
  // describe — an old custom workout, a link from someone using the advanced
  // editor — opens where it can actually be edited, rather than being
  // restructured behind the athlete's back.
  const startPlan = initial.plan ? clonePlan(initial.plan) : inferPlan(initial.blocks);

  const [name, setName] = useState(initial.name);
  const [plan, setPlan] = useState<WorkoutPlan>(() => startPlan ?? blankPlan());
  // Coalesce on load too, not only on edit: a workout stored as several
  // repeat-1 blocks would otherwise render as several step groups whose arrows
  // can't cross the boundaries between them.
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(() => coalesceBlocks(initial.blocks));
  const [structured, setStructured] = useState(startPlan != null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  /** What Save would write, which is also what the preview shows. */
  function draft(): WorkoutDef {
    if (structured) return { ...initial, name, plan, blocks: planToBlocks(plan) };
    // Blocks edited by hand are the truth; a plan alongside them would be a
    // claim about a structure nobody has checked.
    const { plan: _drop, ...rest } = initial;
    return { ...rest, name, blocks: coalesceBlocks(blocks) };
  }

  const current = draft();
  const resolved = resolveWorkout(current).segments;

  // Cancel used to throw the draft away without asking. Only worth asking when
  // there is something to lose, and it reuses Delete's two-tap pattern.
  const dirty =
    JSON.stringify({ ...current, blocks: current.blocks.map((b) => ({ ...b, id: '' })) }) !==
    JSON.stringify({
      ...initial,
      blocks: coalesceBlocks(initial.blocks).map((b) => ({ ...b, id: '' })),
    });

  const blockedReason = !name.trim()
    ? 'Name the workout to save it'
    : resolved.length === 0
      ? 'Add a segment to save it'
      : resolved.length > LIMITS.resolvedSegments
        ? `That is more than ${LIMITS.resolvedSegments} segments`
        : null;

  const flatten = (list: WorkoutBlock[]) =>
    JSON.stringify(resolveWorkout({ id: 'x', name: 'x', blocks: list }).segments);

  function toStructured() {
    // The plan we left with, if these are still the same steps. A ladder
    // expands into a flat run of rungs that `inferPlan` can't read back as a
    // ladder, so looking at Advanced and changing nothing would otherwise cost
    // the structure — a trap, and one there is no reason to walk into.
    const kept = flatten(planToBlocks(plan)) === flatten(blocks) ? plan : inferPlan(blocks);
    if (!kept) {
      setNote(
        "These steps aren't a warm up, one main section and a cool down. Reshape them here, or start a new workout.",
      );
      return;
    }
    setPlan(kept);
    setStructured(true);
    setNote(null);
  }

  function toBlocks() {
    setBlocks(planToBlocks(plan));
    setStructured(false);
    setNote(null);
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface text-ink">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => (dirty && !confirmCancel ? setConfirmCancel(true) : onCancel())}
            className={`rounded-lg border px-3 py-2 text-sm font-bold ${
              confirmCancel ? 'border-stop text-stop' : 'border-line'
            }`}
          >
            {confirmCancel ? 'Discard?' : 'Cancel'}
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workout name"
            aria-label="Workout name"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-base font-black"
          />
          <button
            onClick={() => onSave(current)}
            disabled={!!blockedReason}
            className="rounded-lg bg-go px-4 py-2 text-sm font-black text-go-ink disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <div className="mt-1 text-xs font-bold text-muted">
          {/* A disabled button with no explanation is a dead end. */}
          {blockedReason ?? `${isNew ? 'New workout' : 'Editing'} · ${summarize(resolved)}`}
        </div>
      </header>

      {/* Pinned under the header, not inside the scroller: the button that
          raises this note is at the bottom of a long page, and a message that
          appears a screen and a half above it may as well not exist. */}
      {note && (
        <button
          onClick={() => setNote(null)}
          className="border-b border-line bg-raised px-3 py-2 text-left text-sm font-semibold text-ink"
        >
          {note}
          <span className="ml-1 font-bold text-muted">Tap to dismiss.</span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-8">
        <div className="pt-3">
          {structured ? (
            <PlanEditor plan={plan} onChange={setPlan} />
          ) : (
            <>
              <p className="mb-2 text-xs font-black tracking-widest text-muted uppercase">
                Steps
              </p>
              <BlockEditor blocks={blocks} onChange={setBlocks} />
            </>
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-card p-3">
          <h3 className="mb-2 text-xs font-black tracking-widest text-muted uppercase">
            Preview
          </h3>
          <div className="flex flex-wrap gap-1">
            {resolved.map((s, i) => (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${KIND_CHIP[s.kind]}`}
              >
                {/* A ladder rung is named for its own distance, so printing
                    the label too read "400m 400m". */}
                {s.name === endLabel(s.end) ? s.name : `${s.name} ${endLabel(s.end)}`}
                {s.targetPaceSecPerMile != null &&
                  ` @ ${formatClock(s.targetPaceSecPerMile * 1000)}`}
              </span>
            ))}
          </div>
        </div>

        {/* The escape hatch, kept quiet. Almost every workout is the shape
            above; the ones that aren't still have somewhere to go. */}
        <button
          onClick={() => (structured ? toBlocks() : toStructured())}
          className="mt-4 w-full rounded-xl border-2 border-dashed border-line py-3 text-sm font-bold text-muted"
        >
          {structured ? 'Advanced: edit as a list of steps' : 'Back to warm up / main / cool down'}
        </button>

        {onDelete && (
          <button
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className={`mt-3 w-full rounded-xl py-3 text-sm font-black ${
              confirmDelete ? 'bg-stop text-stop-ink' : 'border-2 border-stop text-stop'
            }`}
          >
            {confirmDelete ? 'Tap again to delete' : 'Delete workout'}
          </button>
        )}
      </div>
    </div>
  );
}
