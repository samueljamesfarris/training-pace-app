import { useState } from 'react';
import type { InstallContext } from '../lib/install';

/**
 * Getting the app onto the home screen, which iOS makes entirely manual.
 *
 * There is no `beforeinstallprompt` on iOS. The install cannot be triggered or
 * detected, so this is instruction and nothing else — which means the pictures
 * carry it. "Tap Share" assumes you know that the box with the arrow is called
 * Share, and that the entry sits below the fold of the sheet, past a row of
 * app icons. Both of those were losing people, so both are drawn.
 */

/** The iOS share glyph, drawn rather than named. */
function ShareGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/** The plus-in-a-square that iOS puts beside Add to Home Screen. */
function AddGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/** The overflow menu an in-app browser hides "Open in Safari" behind. */
function MoreGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/**
 * A glyph sized to sit in a sentence.
 *
 * Trailing them at the end of the line was the first attempt and it read as
 * decoration: "tap this button" pointed at an icon on the far margin, three
 * words away from the phrase naming it. Inline, the sentence contains the
 * thing it is telling you to look for.
 */
function Inline({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-block h-5 w-5 align-text-bottom text-ink">{children}</span>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-black text-ink">
        {n}
      </span>
      <span className="min-w-0 flex-1 pt-1 text-base leading-snug font-bold text-ink">
        {children}
      </span>
    </li>
  );
}

/**
 * A slim bar offering the install, shown on the idle screen only.
 *
 * It rides in the ride screen's notice run — the same strip that carries the
 * GPS error and the wake-lock warning — rather than floating over the bottom
 * of the screen. Docked at the bottom it covered the workout row and START
 * outright: an offer to install cannot be allowed to sit on top of the one
 * button the app exists for.
 *
 * Dismissal lives in the caller's state rather than in storage, so it is gone
 * for this launch and offered again on the next one. That is deliberate: the
 * thing being asked for is a one-time action, and once it is done the banner
 * can't appear at all — `installContext` reports `installed` and the caller
 * stops rendering it. Nobody who takes the advice ever sees it twice.
 */
export function InstallBanner({
  ctx,
  onOpen,
  onDismiss,
}: {
  ctx: InstallContext;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const inApp = ctx === 'ios-in-app';
  return (
    <div className="mx-3 mb-1 flex items-center gap-2 rounded-md bg-raised px-3 py-2">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <ShareGlyph className="h-5 w-5 shrink-0 text-ink" />
        <span className="min-w-0">
          <span className="block text-sm leading-tight font-black text-ink">
            {inApp ? 'Open in Safari to install' : 'Add Pace to your home screen'}
          </span>
          <span className="block text-xs leading-tight font-semibold text-muted">
            {inApp ? 'This browser can’t add it' : 'Opens from an icon, works with no signal'}
          </span>
        </span>
      </button>
      <button
        onClick={onOpen}
        className="shrink-0 rounded-lg bg-next px-2.5 py-1.5 text-xs font-black text-next-ink"
      >
        Show me
      </button>
      <button
        onClick={onDismiss}
        className="shrink-0 px-1 text-xs font-bold text-muted"
        aria-label="Dismiss install prompt"
      >
        Later
      </button>
    </div>
  );
}

/** The steps in full, with the glyphs they are actually looking for. */
export function InstallSheet({ ctx, onClose }: { ctx: InstallContext; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  /*
   * The escape hatch for an in-app browser whose menu is somewhere unexpected:
   * with the address on the clipboard they can open Safari themselves and
   * paste, without going back to the message to hunt for the link.
   */
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard refused. The steps above still work; say nothing.
    }
  }

  const inApp = ctx === 'ios-in-app';

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface text-ink">
      <header className="flex items-center justify-end px-4 py-3">
        <button onClick={onClose} className="px-2 py-1 text-sm font-bold text-muted">
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-4">
          <h2 className="text-3xl font-black">
            {inApp ? 'Open this in Safari first' : 'Add Pace to your home screen'}
          </h2>

          {inApp ? (
            <>
              <p className="mt-3 text-base leading-snug font-semibold text-muted">
                You’re in another app’s built-in browser. It can’t add anything to your
                home screen — Safari can.
              </p>
              <ol className="mt-6 flex flex-col gap-5">
                <Step n={1}>
                  Tap
                  <Inline>
                    <MoreGlyph className="h-full w-full" />
                  </Inline>
                  — usually at the top right
                </Step>
                <Step n={2}>Choose “Open in Safari”, or “Open in browser”</Step>
                <Step n={3}>Then follow the three steps to add it — they’re short</Step>
              </ol>

              <button
                onClick={() => void copyLink()}
                className={`mt-6 h-[52px] w-full rounded-2xl text-base font-black ${
                  copied ? 'border-2 border-line text-muted' : 'bg-next text-next-ink'
                }`}
              >
                {copied ? 'Link copied' : 'Can’t find it? Copy the link'}
              </button>
              {copied && (
                <p className="mt-3 text-sm font-semibold text-ink">
                  Open Safari and paste it in the address bar.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-3 text-base leading-snug font-semibold text-muted">
                It opens from an icon like any other app, holds the screen awake, and
                works with no signal.
              </p>
              <ol className="mt-6 flex flex-col gap-5">
                <Step n={1}>
                  Tap
                  <Inline>
                    <ShareGlyph className="h-full w-full" />
                  </Inline>
                  {ctx === 'ios-browser'
                    ? '— in the address bar, or in the menu'
                    : '— at the bottom of the screen'}
                </Step>
                <Step n={2}>
                  Scroll down past the row of apps, then tap
                  <Inline>
                    <AddGlyph className="h-full w-full" />
                  </Inline>
                  “Add to Home Screen”
                </Step>
                <Step n={3}>Tap “Add”, then open Pace from its new icon</Step>
              </ol>

              {/* Not every browser on iOS carries the entry, and hunting a menu
                  that has no such item is exactly how somebody gives up. */}
              {ctx === 'ios-browser' && (
                <p className="mt-6 rounded-2xl bg-raised p-4 text-sm leading-snug font-semibold text-ink">
                  No “Add to Home Screen” in the menu? Open this page in Safari and try
                  again — Safari always has it.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 pt-2 pb-3">
        <div className="mx-auto w-full max-w-md">
          <button
            onClick={onClose}
            className="h-[60px] w-full rounded-2xl bg-go text-xl font-black text-go-ink"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
