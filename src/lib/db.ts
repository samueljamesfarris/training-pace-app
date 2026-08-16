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

/** Most recent session that never reached `finished`. Used by step 2's resume. */
export async function findUnfinishedSession(): Promise<SessionRecord | null> {
  const all = await listSessions();
  const open = all.filter((s) => s.status !== 'finished');
  open.sort((a, b) => b.startedAt - a.startedAt);
  return open[0] ?? null;
}
