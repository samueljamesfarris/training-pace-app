import { KINDS, MILE, resolveWorkout, type SegmentDef, type WorkoutDef } from './workouts';

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

/** The wire form. Deliberately terse — every byte shows up in the message. */
interface WireSegment {
  n: string;
  /** Index into KINDS. */
  k: number;
  /** Seconds, for a timed segment. Exactly one of t/d is present. */
  t?: number;
  /** Meters, for a distance segment. */
  d?: number;
  /** Goal pace, seconds per mile. */
  p?: number;
}

interface WireBlock {
  r: number;
  s: WireSegment[];
}

interface WirePayload {
  /** Format version, so an older app can say "that link is newer than me". */
  v: number;
  n: string;
  b: WireBlock[];
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

/** The encoded payload for a workout, without any URL around it. */
export function encodeWorkout(w: WorkoutDef): string {
  const payload: WirePayload = {
    v: VERSION,
    n: w.name,
    b: w.blocks.map((b) => ({
      r: Math.max(1, Math.round(b.repeat)),
      s: b.segments.map((s) => {
        const seg: WireSegment = { n: s.name, k: Math.max(0, KINDS.indexOf(s.kind)) };
        if (s.end.type === 'time') seg.t = Math.round(s.end.seconds);
        // A mile is 1609.344 m, so meters keep their fraction: rounding here
        // would quietly turn a shared mile rep into something else.
        else seg.d = Math.round(s.end.meters * 1000) / 1000;
        if (s.targetPaceSecPerMile != null) seg.p = Math.round(s.targetPaceSecPerMile);
        return seg;
      }),
    })),
  };
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
      if (!isRecord(rawSeg)) return { ok: false, reason: 'invalid' };
      const kind = KINDS[typeof rawSeg.k === 'number' ? rawSeg.k : -1];
      if (!kind) return { ok: false, reason: 'invalid' };

      // Exactly one end condition. Both, or neither, is a corrupt payload.
      const timed = rawSeg.t != null;
      const measured = rawSeg.d != null;
      if (timed === measured) return { ok: false, reason: 'invalid' };
      if (timed && !inRange(rawSeg.t, LIMITS.seconds)) return { ok: false, reason: 'invalid' };
      if (measured && !inRange(rawSeg.d, LIMITS.meters)) return { ok: false, reason: 'invalid' };

      const seg: SegmentDef = {
        name: cleanName(rawSeg.n, kind),
        kind,
        end: timed
          ? { type: 'time', seconds: Math.round(rawSeg.t as number) }
          : { type: 'distance', meters: Math.round((rawSeg.d as number) * 1000) / 1000 },
      };
      if (rawSeg.p != null) {
        if (!inRange(rawSeg.p, LIMITS.targetSecPerMile)) return { ok: false, reason: 'invalid' };
        seg.targetPaceSecPerMile = Math.round(rawSeg.p);
      }
      segments.push(seg);
    }
    blocks.push({ id: '', repeat: Math.round(rawBlock.r), segments });
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
    const ua = navigator.userAgent;
    return (
      /iPhone|iPad|iPod/.test(ua) ||
      // iPadOS reports itself as a Mac; the touch points give it away.
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
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
