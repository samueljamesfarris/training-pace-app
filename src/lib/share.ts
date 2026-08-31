import {
  inferPlan,
  KIND_DEFAULT_NAME,
  KINDS,
  MILE,
  planToBlocks,
  resolveWorkout,
  samePlan,
  type EndCondition,
  type MainSection,
  type RepeatStep,
  type SegmentDef,
  type WorkoutDef,
  type WorkoutPlan,
} from './workouts';

/**
 * Workouts as links.
 *
 * A workout is small — a name and a handful of segments — so it travels whole
 * inside the URL's fragment rather than needing a server to store it. The
 * fragment never leaves the browser, so a shared workout costs no backend, no
 * account and no round trip, and a link still opens the app offline once it is
 * installed.
 *
 * Keys are one character and the kind is an index, because the result gets
 * pasted into a text message. A four-segment workout lands around 150
 * characters; the ladder preset, the longest thing the builder makes, is
 * comfortably inside the cap below.
 */

/** An end condition. Exactly one of t/d is present. */
interface WireEnd {
  /** Seconds, for a timed segment. */
  t?: number;
  /** Meters, for a distance segment. */
  d?: number;
}

/** The wire form. Deliberately terse — every byte shows up in the message. */
interface WireSegment extends WireEnd {
  n: string;
  /** Index into KINDS. */
  k: number;
  /** Goal pace, seconds per mile. */
  p?: number;
}

interface WireBlock {
  r: number;
  s: WireSegment[];
  /** `dropFinalStep`: the set's closing recovery is skipped on its last round. */
  x?: 1;
}

/** A repeat step, with the two fields that make a ladder a ladder. */
interface WireStep extends WireSegment {
  /** `perRound`, one end condition per round. */
  pr?: WireEnd[];
  /** `matchPrevious`. */
  mp?: 1;
}

interface WirePlan {
  /** Warmup and cooldown, absent when the workout has none. */
  w?: WireSegment;
  c?: WireSegment;
  /** The main section: `k` 0 is steady, 1 is a repeat set. */
  m:
    | { k: 0; s: WireSegment }
    | { k: 1; r: number; s: WireStep[]; x?: 1 };
}

interface WirePayload {
  /** Format version, so an older app can say "that link is newer than me". */
  v: number;
  n: string;
  b: WireBlock[];
  /**
   * The structured form, carried only when the blocks alone can't say it —
   * a ladder, in practice. Everything else is recovered by `inferPlan` on
   * arrival, so the common link is exactly as short as it always was.
   *
   * An extra key inside a v1 payload rather than a v2 format, deliberately:
   * an app built before plans existed reads `v`, `n` and `b`, ignores this
   * entirely, and still runs the workout correctly.
   */
  pl?: WirePlan;
}

const VERSION = 1;

/**
 * What a link is allowed to contain.
 *
 * A link is untrusted input — anyone can hand-write one — and the app it opens
 * runs a real workout with real audio. Nothing here is a guess: each bound sits
 * far outside what the builder can produce, so a link from a friend always
 * passes, while a hostile or corrupt one can't create the 10,000-segment
 * workout that would wedge the session engine.
 */
export const LIMITS = {
  /** Characters of encoded payload, before we even try to decode it. */
  payloadChars: 8000,
  nameChars: 60,
  blocks: 30,
  segmentsPerBlock: 30,
  /** After repeat groups are expanded — the number the engine actually walks. */
  resolvedSegments: 200,
  repeat: { min: 1, max: 50 },
  seconds: { min: 1, max: 7200 },
  meters: { min: 1, max: 100 * MILE },
  /** Goal pace: a 1:00 mile and a 30:00 mile are both past any real workout. */
  targetSecPerMile: { min: 60, max: 1800 },
};

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked: spreading a large array into fromCharCode blows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // Anything malformed is simply not a workout link.
    return null;
  }
}

function wireEnd(end: EndCondition): WireEnd {
  // A mile is 1609.344 m, so meters keep their fraction: rounding here would
  // quietly turn a shared mile rep into something else.
  return end.type === 'time'
    ? { t: Math.round(end.seconds) }
    : { d: Math.round(end.meters * 1000) / 1000 };
}

function wireSegment(s: SegmentDef): WireSegment {
  const seg: WireSegment = {
    n: s.name,
    k: Math.max(0, KINDS.indexOf(s.kind)),
    ...wireEnd(s.end),
  };
  if (s.targetPaceSecPerMile != null) seg.p = Math.round(s.targetPaceSecPerMile);
  return seg;
}

function wireStep(s: RepeatStep): WireStep {
  const step: WireStep = wireSegment(s);
  if (s.perRound && s.perRound.length > 0) step.pr = s.perRound.map(wireEnd);
  if (s.matchPrevious) step.mp = 1;
  return step;
}

function wirePlan(plan: WorkoutPlan): WirePlan {
  const out: WirePlan = {
    m:
      plan.main.kind === 'steady'
        ? { k: 0, s: wireSegment(plan.main.segment) }
        : {
            k: 1,
            r: Math.max(1, Math.round(plan.main.rounds)),
            s: plan.main.steps.map(wireStep),
            ...(plan.main.dropFinalRecovery ? { x: 1 as const } : {}),
          },
  };
  if (plan.warmup) out.w = wireSegment(plan.warmup);
  if (plan.cooldown) out.c = wireSegment(plan.cooldown);
  return out;
}

/**
 * Whether the plan has to ride along, or the blocks already imply it.
 *
 * `inferPlan` recovers a warmup, one main section and a cooldown from the
 * blocks alone, which covers everything except a ladder — so a link only pays
 * for its structure when the structure is genuinely unguessable.
 */
function planWorthSending(w: WorkoutDef): WorkoutPlan | null {
  if (!w.plan) return null;
  const inferred = inferPlan(w.blocks);
  return inferred && samePlan(inferred, w.plan) ? null : w.plan;
}

/** The encoded payload for a workout, without any URL around it. */
export function encodeWorkout(w: WorkoutDef): string {
  const payload: WirePayload = {
    v: VERSION,
    n: w.name,
    b: w.blocks.map((b) => ({
      r: Math.max(1, Math.round(b.repeat)),
      s: b.segments.map(wireSegment),
      ...(b.dropFinalStep ? { x: 1 as const } : {}),
    })),
  };
  const plan = planWorthSending(w);
  if (plan) payload.pl = wirePlan(plan);
  return base64UrlEncode(JSON.stringify(payload));
}

/** A full shareable link to this app, carrying the workout in its fragment. */
export function workoutLink(w: WorkoutDef, baseUrl: string): string {
  // Drop any existing fragment or query so re-sharing a link doesn't nest one.
  const base = baseUrl.split('#')[0]!.split('?')[0]!;
  return `${base}#w=${encodeWorkout(w)}`;
}

/** The payload out of a full URL, a bare fragment, or the payload itself. */
export function payloadFromUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const marked = text.match(/[#&?]w=([A-Za-z0-9\-_]+)/);
  if (marked) return marked[1]!;
  // A bare payload pasted on its own is still a workout worth accepting.
  return /^[A-Za-z0-9\-_]+$/.test(text) ? text : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function inRange(v: unknown, range: { min: number; max: number }): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max;
}

/**
 * Names are the one thing we tidy rather than reject: a long or oddly
 * punctuated name is harmless once the control characters are gone, and
 * refusing a whole workout over its title would be the wrong trade. Every
 * other field is rejected out of range rather than clamped — importing a
 * workout that differs from the one that was sent is worse than importing none.
 */
function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // Control characters, including the newlines that would otherwise break a
  // name out of its row on screen.
  const stripped = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return stripped ? stripped.slice(0, LIMITS.nameChars) : fallback;
}

export type DecodeFailure =
  | 'not-a-link'
  | 'too-long'
  | 'unreadable'
  | 'newer-version'
  | 'invalid';

export type DecodeResult =
  | { ok: true; workout: WorkoutDef }
  | { ok: false; reason: DecodeFailure };

/**
 * One end condition off the wire, or null.
 *
 * Exactly one of t/d — both, or neither, is a corrupt payload — and each is
 * rejected out of range rather than clamped, because importing a workout that
 * differs from the one that was sent is worse than importing none.
 */
function readEnd(raw: Record<string, unknown>): EndCondition | null {
  const timed = raw.t != null;
  const measured = raw.d != null;
  if (timed === measured) return null;
  if (timed) {
    if (!inRange(raw.t, LIMITS.seconds)) return null;
    return { type: 'time', seconds: Math.round(raw.t as number) };
  }
  if (!inRange(raw.d, LIMITS.meters)) return null;
  return { type: 'distance', meters: Math.round((raw.d as number) * 1000) / 1000 };
}

function readSegment(raw: unknown): SegmentDef | null {
  if (!isRecord(raw)) return null;
  const kind = KINDS[typeof raw.k === 'number' ? raw.k : -1];
  if (!kind) return null;
  const end = readEnd(raw);
  if (!end) return null;

  // The fallback is the app's own default name, not the bare kind: a segment
  // that arrives nameless should read "Warmup", the way one built here does.
  const seg: SegmentDef = { name: cleanName(raw.n, KIND_DEFAULT_NAME[kind]), kind, end };
  if (raw.p != null) {
    if (!inRange(raw.p, LIMITS.targetSecPerMile)) return null;
    seg.targetPaceSecPerMile = Math.round(raw.p);
  }
  return seg;
}

/**
 * The structured form off the wire, or null.
 *
 * A plan is advisory: the blocks are what the app actually runs. So anything
 * wrong here means the plan is dropped and the workout still imports — the
 * recipient gets it in the advanced editor rather than not at all.
 */
function readPlan(raw: unknown, rounds: { min: number; max: number }): WorkoutPlan | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.m)) return null;

  const optional = (v: unknown): SegmentDef | null | false =>
    v == null ? null : (readSegment(v) ?? false);
  const warmup = optional(raw.w);
  const cooldown = optional(raw.c);
  if (warmup === false || cooldown === false) return null;

  let main: MainSection;
  if (raw.m.k === 0) {
    const segment = readSegment(raw.m.s);
    if (!segment) return null;
    main = { kind: 'steady', segment };
  } else if (raw.m.k === 1) {
    if (!inRange(raw.m.r, rounds)) return null;
    if (!Array.isArray(raw.m.s)) return null;
    if (raw.m.s.length < 1 || raw.m.s.length > LIMITS.segmentsPerBlock) return null;

    const count = Math.round(raw.m.r);
    const steps: RepeatStep[] = [];
    for (const rawStep of raw.m.s) {
      const base = readSegment(rawStep);
      if (!base || !isRecord(rawStep)) return null;
      const step: RepeatStep = base;
      if (rawStep.pr != null) {
        // A ladder that doesn't have a rung for every round would run some
        // round off the end of its own list.
        if (!Array.isArray(rawStep.pr) || rawStep.pr.length !== count) return null;
        const perRound: EndCondition[] = [];
        for (const rawEnd of rawStep.pr) {
          if (!isRecord(rawEnd)) return null;
          const end = readEnd(rawEnd);
          if (!end) return null;
          perRound.push(end);
        }
        step.perRound = perRound;
      }
      if (rawStep.mp != null) step.matchPrevious = true;
      steps.push(step);
    }
    main = { kind: 'repeat', rounds: count, steps, dropFinalRecovery: raw.m.x != null };
  } else {
    return null;
  }

  return { warmup, cooldown, main };
}

/**
 * Turn a link back into a workout, or say why it isn't one.
 *
 * The returned workout has no id: it is a proposal, not a stored record. The
 * caller assigns an id when the user accepts it, so an imported workout can
 * never overwrite one already in the library.
 */
export function decodeWorkout(input: string): DecodeResult {
  const payload = payloadFromUrl(input);
  if (!payload) return { ok: false, reason: 'not-a-link' };
  if (payload.length > LIMITS.payloadChars) return { ok: false, reason: 'too-long' };

  const json = base64UrlDecode(payload);
  if (json == null) return { ok: false, reason: 'unreadable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'invalid' };
  if (typeof parsed.v !== 'number') return { ok: false, reason: 'invalid' };
  if (parsed.v > VERSION) return { ok: false, reason: 'newer-version' };
  if (!Array.isArray(parsed.b)) return { ok: false, reason: 'invalid' };
  if (parsed.b.length < 1 || parsed.b.length > LIMITS.blocks) {
    return { ok: false, reason: 'invalid' };
  }

  const blocks: WorkoutDef['blocks'] = [];
  for (const rawBlock of parsed.b) {
    if (!isRecord(rawBlock)) return { ok: false, reason: 'invalid' };
    if (!inRange(rawBlock.r, LIMITS.repeat)) return { ok: false, reason: 'invalid' };
    if (!Array.isArray(rawBlock.s)) return { ok: false, reason: 'invalid' };
    if (rawBlock.s.length < 1 || rawBlock.s.length > LIMITS.segmentsPerBlock) {
      return { ok: false, reason: 'invalid' };
    }

    const segments: SegmentDef[] = [];
    for (const rawSeg of rawBlock.s) {
      const seg = readSegment(rawSeg);
      if (!seg) return { ok: false, reason: 'invalid' };
      segments.push(seg);
    }
    blocks.push({
      id: '',
      repeat: Math.round(rawBlock.r),
      segments,
      ...(rawBlock.x != null ? { dropFinalStep: true } : {}),
    });
  }

  const workout: WorkoutDef = {
    id: '',
    name: cleanName(parsed.n, 'Shared workout'),
    blocks,
  };
  // The bound that actually protects the engine: repeat groups multiply, so a
  // payload well inside every other limit can still expand without bound.
  if (resolveWorkout(workout).segments.length > LIMITS.resolvedSegments) {
    return { ok: false, reason: 'invalid' };
  }

  /*
   * The structure, if any survives scrutiny.
   *
   * The blocks are what runs; the plan only decides which editor opens. So a
   * plan is attached only when it compiles to exactly the workout that came
   * with it — which also means a hostile link can't ship innocuous blocks
   * beside a plan that would rewrite them the moment anything is saved.
   */
  const plan =
    parsed.pl != null
      ? readPlan(parsed.pl, LIMITS.repeat)
      : inferPlan(blocks);
  if (
    plan &&
    JSON.stringify(resolveWorkout({ ...workout, blocks: planToBlocks(plan) }).segments) ===
      JSON.stringify(resolveWorkout(workout).segments)
  ) {
    workout.plan = plan;
  }
  return { ok: true, workout };
}

/**
 * Whether the app is running as an installed app rather than a browser tab.
 *
 * It matters for sharing: on iOS a link tapped in Messages opens Safari, which
 * keeps its own storage, so a workout accepted there never reaches the app on
 * the home screen. The prompt says so rather than letting the import look like
 * it worked and then be missing at the track.
 */
export function isInstalledApp(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Whether this is an iPhone or iPad.
 *
 * Sniffing the agent string is a poor tool and this is the one place it earns
 * its keep: the consequence being described — a home-screen app that keeps its
 * own storage, separate from every browser on the device — is specific to iOS,
 * and saying it on Android, where an installed app and the browser share
 * storage and the import simply works, would be a false alarm. Wrong either
 * way it only changes the wording of a hint, never what the app does.
 *
 * Not a Safari check: on iOS every browser is WebKit underneath and the split
 * is the same whether the link opened in Safari, Chrome or anything else.
 */
export function isIOS(): boolean {
  try {
    return isIOSAgent(navigator.userAgent, navigator.maxTouchPoints);
  } catch {
    return false;
  }
}

/**
 * The test itself, over values rather than over `navigator`.
 *
 * Split out so the install prompt can decide what to say against a table of
 * real agent strings, which is the only way to check agent sniffing at all.
 */
export function isIOSAgent(ua: string, maxTouchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && maxTouchPoints > 1)
  );
}

/*
 * An offered import, parked where a reload can't lose it.
 *
 * The fragment is cleared the moment it is read, so between that and the tap
 * that accepts it, the only record of the workout is React state — and a
 * service worker update takes the page out from under it. sessionStorage is
 * the right scope: it survives the reload and dies with the tab, so an import
 * nobody answered doesn't reappear next week.
 */
const PENDING_KEY = 'pace-pending-link';

export function savePendingLink(raw: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, raw);
  } catch {
    // Storage blocked: the import still works, it just won't survive a reload.
  }
}

export function loadPendingLink(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingLink() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do; a stale entry dies with the tab anyway.
  }
}

/** Wording for a failed import, in the app's own voice. */
export const DECODE_MESSAGE: Record<DecodeFailure, string> = {
  'not-a-link': "That doesn't look like a workout link.",
  'too-long': 'That link is too long to be a workout.',
  unreadable: 'That link is damaged — ask for it again.',
  'newer-version': 'That link was made by a newer version of the app. Update, then try again.',
  invalid: "That link isn't a workout this app can run.",
};
