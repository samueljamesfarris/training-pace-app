import { useEffect, useState } from 'react';
import { deleteSession, getFixes, listSessions } from '../lib/db';
import { completedSegments } from '../lib/segments';
import { summarize, sortSessions, toCsv, toTextSummary } from '../lib/history';
import { isIndoor, type SessionRecord } from '../lib/types';
import { averageMph, formatClock, formatMiles, formatPace, sanePaceSecPerMile } from '../lib/units';

function when(ms: number) {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Hand a string to the platform: share sheet if offered, download otherwise. */
async function shareText(name: string, text: string, mime: string): Promise<string> {
  const file = new File([text], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'Shared.';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return '';
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return 'Downloaded.';
}

function Detail({
  rec,
  onBack,
  onDeleted,
}: {
  rec: SessionRecord;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fixCount, setFixCount] = useState<number | null>(null);

  // Raw logs are pruned beyond the most recent rides, so whether this one still
  // has fixes is a fact to look up, not to assume.
  useEffect(() => {
    void getFixes(rec.id).then((f) => setFixCount(f.length));
  }, [rec.id]);

  const s = summarize(rec);
  const indoor = isIndoor(rec);
  const ceiling = rec.finishedAt ?? rec.lastSeenAt;
  const rows = completedSegments(rec, ceiling, rec.distanceMeters);
  const targets = rec.workout?.segments ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-3">
        <button onClick={onBack} className="rounded-lg border border-line px-3 py-2 text-sm font-bold">
          Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black">{s.workoutName ?? 'Free run'}</div>
          <div className="text-xs text-muted">
            {when(rec.startedAt)}
            {indoor && ' · indoor'}
            {!s.finished && ' · unfinished'}
            {rec.source !== 'geo' && !indoor && ` · ${rec.source}`}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mt-3 grid grid-cols-2 gap-4 rounded-2xl bg-card p-4">
          <div>
            <div className="text-3xl font-black">{formatClock(s.totalMs)}</div>
            <div className="text-xs font-bold tracking-widest text-muted uppercase">time</div>
          </div>
          {/* Nothing was measured indoors, so nothing derived from distance is
              stated — the same rule the finish card and the CSV follow. */}
          {!indoor && (
            <>
              <div>
                <div className="text-3xl font-black">{formatMiles(s.distanceMeters)}</div>
                <div className="text-xs font-bold tracking-widest text-muted uppercase">
                  miles
                </div>
              </div>
              <div>
                <div className="text-3xl font-black">
                  {formatPace(averageMph(s.distanceMeters, s.totalMs))}
                </div>
                <div className="text-xs font-bold tracking-widest text-muted uppercase">
                  avg pace
                </div>
              </div>
            </>
          )}
          <div>
            <div className="text-3xl font-black">{rows.length}</div>
            <div className="text-xs font-bold tracking-widest text-muted uppercase">
              {rec.workout ? 'segments' : 'laps'}
            </div>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-3 rounded-2xl bg-card p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] tracking-widest text-muted uppercase">
                  <th className="text-left font-bold">segment</th>
                  <th className="text-right font-bold">time</th>
                  {!indoor && <th className="text-right font-bold">dist</th>}
                  {!indoor && <th className="text-right font-bold">pace</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const paceSec = sanePaceSecPerMile(row.distanceMeters, row.durationMs);
                  const mph = paceSec == null ? null : 3600 / paceSec;
                  const target = targets[row.index]?.targetPaceSecPerMile;
                  const delta = target != null && paceSec != null ? Math.round(paceSec - target) : null;
                  return (
                    <tr key={row.index} className="border-t border-line">
                      <td className="py-1 font-bold">{row.name}</td>
                      <td className="py-1 text-right">{formatClock(row.durationMs)}</td>
                      {!indoor && (
                        <td className="py-1 text-right">{formatMiles(row.distanceMeters)}</td>
                      )}
                      {!indoor && (
                        <td className="py-1 text-right font-bold">
                          {formatPace(mph)}
                          {delta != null && (
                            <span className="ml-1 text-xs font-bold text-muted">
                              {delta === 0 ? 'even' : `${delta > 0 ? '+' : ''}${delta}s`}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(toTextSummary(rec));
                setNote('Summary copied.');
              } catch {
                setNote('Clipboard refused; try the CSV instead.');
              }
            }}
            className="h-[56px] rounded-2xl border-2 border-line text-base font-bold text-ink"
          >
            Copy summary
          </button>
          <button
            onClick={async () => setNote((await shareText(`${rec.id}.csv`, toCsv(rec), 'text/csv')) || null)}
            className="h-[56px] rounded-2xl border-2 border-line text-base font-bold text-ink"
          >
            Export CSV
          </button>
          <button
            disabled={indoor || fixCount === 0}
            onClick={async () => {
              const fixes = await getFixes(rec.id);
              setNote(
                (await shareText(
                  `${rec.id}-fixes.json`,
                  JSON.stringify(fixes),
                  'application/json',
                )) || null,
              );
            }}
            className="h-[56px] rounded-2xl bg-next text-base font-bold text-next-ink disabled:opacity-40"
          >
            {indoor
              ? 'No GPS log — indoor session'
              : fixCount === null
                ? 'Raw GPS log (JSON)'
                : fixCount === 0
                ? 'Raw GPS log pruned'
                : `Raw GPS log (${fixCount} fixes)`}
          </button>
        </div>

        {note && (
          <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-center text-sm font-semibold">
            {note}
          </p>
        )}

        <button
          onClick={async () => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            await deleteSession(rec.id);
            onDeleted();
          }}
          className={`mt-6 w-full rounded-xl py-3 text-sm font-black ${
            confirmDelete ? 'bg-stop text-stop-ink' : 'border-2 border-stop text-stop'
          }`}
        >
          {confirmDelete ? 'Tap again to delete this session' : 'Delete session'}
        </button>
      </div>
    </div>
  );
}

export function History({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = () => void listSessions().then((all) => setSessions(sortSessions(all)));
  useEffect(load, []);

  const open = sessions?.find((s) => s.id === openId) ?? null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface text-ink">
      {open ? (
        <Detail
          rec={open}
          onBack={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            load();
          }}
        />
      ) : (
        <>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-lg font-black">History</h2>
            <button
              onClick={onClose}
              className="rounded-lg bg-next px-4 py-2 text-sm font-bold text-next-ink"
            >
              Close
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {sessions == null && <p className="text-sm text-muted">Reading…</p>}
            {sessions?.length === 0 && (
              <p className="text-sm text-muted">
                No sessions yet. Finished rides appear here.
              </p>
            )}
            {sessions?.map((rec) => {
              const s = summarize(rec);
              return (
                <button
                  key={rec.id}
                  onClick={() => setOpenId(rec.id)}
                  className="mb-2 w-full rounded-xl border-2 border-line p-3 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-base font-black">
                      {s.workoutName ?? 'Free run'}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{when(rec.startedAt)}</span>
                  </div>
                  <div className="mt-1 text-sm font-bold">
                    {s.indoor ? (
                      <>
                        {formatClock(s.totalMs)}{' '}
                        <span className="text-muted">· indoor</span>
                      </>
                    ) : (
                      <>
                        {formatClock(s.totalMs)} · {formatMiles(s.distanceMeters)} mi ·{' '}
                        {formatPace(averageMph(s.distanceMeters, s.totalMs))}/mi
                      </>
                    )}
                  </div>
                  {!s.finished && (
                    <div className="mt-1 text-xs font-bold text-muted">unfinished</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
