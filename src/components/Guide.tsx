import { useState } from 'react';
import { markGuideSeen } from '../lib/onboarding';

/**
 * The guide, shown once on a first launch and reachable afterwards from the
 * home screen.
 *
 * It exists because the app has no labels to spare: the ride screen is one
 * enormous number and four buttons, read at arm's length in the dark, and
 * everything explaining it has to happen before the session starts. Five
 * pages, each answering one question someone actually asks the first time.
 */

interface Page {
  title: string;
  lines: string[];
}

const PAGES: Page[] = [
  {
    title: 'What this is',
    lines: [
      'A pacing app for running workouts. It shows your pace, counts your intervals down, and calls out what to do next so you never have to look at the screen.',
      'No account, no sign-up. Everything it records stays on this phone.',
    ],
  },
  {
    title: 'Install it first',
    lines: [
      'On iPhone: tap Share, then Add to Home Screen, and open it from the icon.',
      'That is what lets it hold the screen awake through a workout and keep running with no signal. In a browser tab, the screen will sleep on you mid-rep.',
    ],
  },
  {
    title: 'Outdoor or treadmill',
    lines: [
      'OUTDOOR uses GPS for pace and distance. Give it a minute outside before you start — WARM UP GPS gets the fix settling while you stretch.',
      'INDOOR is the treadmill. It never touches GPS, and it shows the clocks, the intervals and the goal pace to dial into the machine.',
    ],
  },
  {
    title: 'Running a session',
    lines: [
      'Pick a workout, or leave it on Free run for a plain stopwatch. Then START.',
      'The middle button is NEXT in a workout and LAP in a free run. FINISH takes two taps, so a knock on the handlebars can’t end your session.',
      'Beeps count you into every boundary, and a voice reads your splits. Sound needs one tap to wake up on iPhone — the chirp at START is it.',
    ],
  },
  {
    title: 'When it says --:--',
    lines: [
      'That means it could not measure a pace, not that you stopped. Under trees or between buildings the numbers freeze rather than guess.',
      'It will never invent a reading. A number on this screen was measured, or it is not there at all.',
    ],
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const current = PAGES[page]!;
  const last = page === PAGES.length - 1;

  function done() {
    markGuideSeen();
    onClose();
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-bold tracking-widest text-muted uppercase">
          {page + 1} / {PAGES.length}
        </span>
        <button onClick={done} className="px-2 py-1 text-sm font-bold text-muted">
          {last ? 'Close' : 'Skip'}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-4">
          <h2 className="text-3xl font-black">{current.title}</h2>
          {current.lines.map((line, i) => (
            <p key={i} className="mt-4 text-lg leading-snug font-semibold text-ink">
              {line}
            </p>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-5 pt-2 pb-3">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-3 flex justify-center gap-2">
            {PAGES.map((p, i) => (
              <span
                key={p.title}
                className={`h-2 w-2 rounded-full ${i === page ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {page > 0 && (
              <button
                onClick={() => setPage((n) => n - 1)}
                className="h-[60px] flex-1 rounded-2xl border-2 border-line text-base font-bold text-ink"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? done() : setPage((n) => n + 1))}
              className="h-[60px] flex-[2] rounded-2xl bg-go text-xl font-black text-go-ink"
            >
              {last ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
