import type { RawFix, SessionRecord } from './types';
import type { WorkoutDef } from './workouts';

const DB_NAME = 'pace-app';
const DB_VERSION = 2;
const SESSIONS = 'sessions';
const FIXES = 'fixes';
const WORKOUTS = 'workouts';

let dbPromise: Promise<IDBDatabase> | null = null;
/** Set when persistence is unavailable (private mode, quota, old browser). */
export let dbUnavailable: string | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FIXES)) {
        const store = db.createObjectStore(FIXES, { keyPath: 'seq', autoIncrement: true });
        store.createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains(WORKOUTS)) {
        db.createObjectStore(WORKOUTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/**
 * Persistence must never take the workout down with it. Every call is
 * best-effort; a failure flips a flag the UI shows and the ride continues.
 */
function guard<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e) => {
    dbUnavailable = e?.message ?? String(e);
    console.warn('[db]', e);
    return null;
  });
}

export function putSession(rec: SessionRecord) {
  return guard(tx(SESSIONS, 'readwrite', (s) => s.put(rec)));
}

export function getSession(id: string): Promise<SessionRecord | null> {
  return guard(tx<SessionRecord>(SESSIONS, 'readonly', (s) => s.get(id))).then((r) => r ?? null);
}

export function listSessions(): Promise<SessionRecord[]> {
  return guard(tx<SessionRecord[]>(SESSIONS, 'readonly', (s) => s.getAll())).then(
    (r) => r ?? [],
  );
}

/** Append a batch of raw fixes in one transaction. */
export function appendFixes(sessionId: string, fixes: RawFix[]): Promise<void> {
  if (fixes.length === 0) return Promise.resolve();
  return guard(
    openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const t = db.transaction(FIXES, 'readwrite');
          const store = t.objectStore(FIXES);
          for (const f of fixes) store.put({ ...f, sessionId });
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        }),
    ),
  ).then(() => undefined);
}

export function getFixes(sessionId: string): Promise<RawFix[]> {
  return guard(
    openDb().then(
      (db) =>
        new Promise<RawFix[]>((resolve, reject) => {
          const t = db.transaction(FIXES, 'readonly');
          const req = t.objectStore(FIXES).index('bySession').getAll(sessionId);
          req.onsuccess = () => resolve(req.result as RawFix[]);
          req.onerror = () => reject(req.error);
        }),
    ),
  ).then((r) => r ?? []);
}

export function putWorkout(w: WorkoutDef) {
  return guard(tx(WORKOUTS, 'readwrite', (s) => s.put(w)));
}

export function deleteWorkout(id: string) {
  return guard(tx(WORKOUTS, 'readwrite', (s) => s.delete(id)));
}

export function listWorkouts(): Promise<WorkoutDef[]> {
  return guard(tx<WorkoutDef[]>(WORKOUTS, 'readonly', (s) => s.getAll())).then((r) => r ?? []);
}

/** Where the id of the currently live session is parked, so the next launch
 *  can fetch one record instead of reading every session ever recorded. */
const LIVE_KEY = 'pace-live-session';

export function rememberLiveSession(id: string) {
  try {
    localStorage.setItem(LIVE_KEY, id);
  } catch {
    // Storage blocked; the scan below still finds it.
  }
}

export function forgetLiveSession() {
  try {
    localStorage.removeItem(LIVE_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Most recent session that never reached `finished`.
 *
 * The pointer in localStorage is the fast path — one keyed read instead of
 * deserialising every session on the phone. The full scan stays as the
 * fallback, because the pointer can be missing for reasons that are not
 * "there is no session": private mode, a cleared site setting, or a crash
 * between creating the record and writing the key.
 */
export async function findUnfinishedSession(): Promise<SessionRecord | null> {
  let liveId: string | null = null;
  try {
    liveId = localStorage.getItem(LIVE_KEY);
  } catch {
    liveId = null;
  }
  if (liveId) {
    const rec = await getSession(liveId);
    if (rec && rec.status !== 'finished') return rec;
  }
  const all = await listSessions();
  const open = all.filter((s) => s.status !== 'finished');
  open.sort((a, b) => b.startedAt - a.startedAt);
  return open[0] ?? null;
}

/** Raw fixes for sessions this old are dropped; metadata is tiny and stays. */
const KEEP_FIX_SESSIONS = 20;

/**
 * One fix per second per ride adds up without bound, and the failure mode is a
 * quota error landing mid-workout. Keep the raw logs for the most recent rides
 * and drop the rest — the session rows themselves are kept either way, so
 * history stays complete even once its fixes are gone.
 *
 * Called once on load and never during a live session.
 */
export async function pruneOldFixes(): Promise<number> {
  const pruned = await guard(
    openDb().then(async (db) => {
      const sessions = await new Promise<SessionRecord[]>((resolve, reject) => {
        const req = db.transaction(SESSIONS, 'readonly').objectStore(SESSIONS).getAll();
        req.onsuccess = () => resolve(req.result as SessionRecord[]);
        req.onerror = () => reject(req.error);
      });
      const keep = new Set(
        sessions
          .slice()
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, KEEP_FIX_SESSIONS)
          .map((s) => s.id),
      );
      const stale = sessions.filter((s) => !keep.has(s.id));
      let count = 0;
      for (const s of stale) count += await deleteFixesFor(s.id);
      return count;
    }),
  );
  if (pruned) console.info(`[db] pruned raw fixes from ${pruned} old session(s)`);
  return pruned ?? 0;
}

/** Drop every raw fix belonging to one session. Returns 1 if any were removed. */
async function deleteFixesFor(sessionId: string): Promise<number> {
  const removed = await guard(
    openDb().then(
      (db) =>
        new Promise<number>((resolve, reject) => {
          const t = db.transaction(FIXES, 'readwrite');
          const index = t.objectStore(FIXES).index('bySession');
          const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
          let n = 0;
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            t.objectStore(FIXES).delete(cursor.primaryKey);
            n++;
            cursor.continue();
          };
          t.oncomplete = () => resolve(n);
          t.onerror = () => reject(t.error);
        }),
    ),
  );
  return removed && removed > 0 ? 1 : 0;
}

/** Remove a session record and the raw fixes that belong to it. */
export async function deleteSession(id: string) {
  await deleteFixesFor(id);
  await guard(tx(SESSIONS, 'readwrite', (s) => s.delete(id)));
}
