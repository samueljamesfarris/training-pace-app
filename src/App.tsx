import { useEffect, useState } from 'react';
import { DevPanel } from './components/DevPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Guide } from './components/Guide';
import { InstallBanner, InstallSheet } from './components/InstallPrompt';
import { History } from './components/History';
import { FinishCard } from './components/FinishCard';
import { ResumePrompt } from './components/ResumePrompt';
import { RideScreen } from './components/RideScreen';
import { SharedWorkout, adoptWorkout } from './components/SharedWorkout';
import { WorkoutPicker } from './components/WorkoutPicker';
import { loadDevEnabled, saveDevEnabled } from './lib/devMode';
import { canPromptInstall, installContext } from './lib/install';
import { guideSeen } from './lib/onboarding';
import {
  clearPendingLink,
  DECODE_MESSAGE,
  decodeWorkout,
  loadPendingLink,
  savePendingLink,
} from './lib/share';
import type { WorkoutDef } from './lib/workouts';
import { applyUpdate, registerServiceWorker } from './lib/serviceWorker';
import { useRide } from './lib/useRide';

export default function App() {
  return (
    <ErrorBoundary>
      <AppContents />
    </ErrorBoundary>
  );
}

function AppContents() {
  const ride = useRide();
  const [devOpen, setDevOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  /** A workout that arrived in a link, waiting to be accepted or dismissed. */
  const [shared, setShared] = useState<WorkoutDef | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [devEnabled, setDevEnabled] = useState(loadDevEnabled);
  const [devNote, setDevNote] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  /*
   * Read once: installing opens a separate context with its own storage, so
   * this cannot change under a running page — the installed app is always a
   * fresh launch. Dismissal is state rather than storage, so it lasts the
   * launch and is offered again on the next one; somebody who actually
   * installs never sees it again, because the context stops saying so.
   */
  const [installCtx] = useState(installContext);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true));
  }, []);

  /*
   * A workout link carries the whole workout in the fragment, so opening one
   * is the entire import: no server, no account, works offline. The fragment
   * is cleared either way — a reload should not re-offer a workout that was
   * already declined, and the payload has no business sitting in the address
   * bar afterwards.
   *
   * hashchange matters as much as the mount read: a link tapped while the app
   * is already open is a same-document navigation, so the page never reloads
   * and this is the only notice we get.
   */
  useEffect(() => {
    const offer = (raw: string) => {
      const result = decodeWorkout(raw);
      if (result.ok) {
        setShared(result.workout);
        // Park it: the fragment is about to be cleared, and until this is
        // accepted or declined the workout lives nowhere else.
        savePendingLink(raw);
      } else {
        setShareError(DECODE_MESSAGE[result.reason]);
        clearPendingLink();
      }
    };

    const readLink = () => {
      const hash = window.location.hash;
      if (hash.includes('w=')) {
        offer(hash);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
      // No fragment, but an offer may have survived a reload.
      const carried = loadPendingLink();
      if (carried) offer(carried);
    };

    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, []);

  /*
   * Belt and braces for rotation on iOS. The shell is position:fixed so a stray
   * scroll offset shouldn't be able to hide it, but the failure this replaces
   * left the controls unreachable until the app was restarted, and that is not
   * a thing to be clever about. Costs nothing when there is nothing to reset.
   */
  useEffect(() => {
    const reset = () => window.scrollTo(0, 0);
    window.addEventListener('orientationchange', reset);
    window.addEventListener('resize', reset);
    return () => {
      window.removeEventListener('orientationchange', reset);
      window.removeEventListener('resize', reset);
    };
  }, []);

  /*
   * First launch gets the guide, but it queues behind anything more urgent: a
   * session being offered back, and a workout link. Someone who taps a shared
   * link opened the app *for that workout*, and stacking two full-screen
   * prompts left DOM order deciding which one they saw. The guide follows once
   * the import is answered, which is also when it makes more sense.
   */
  useEffect(() => {
    // Asked of the URL and the parked offer, not of React state: on the first
    // render the link has been read but `shared` has not been committed yet,
    // which is exactly the render where the guide would open underneath it.
    const linkPending =
      shared != null || window.location.hash.includes('w=') || loadPendingLink() != null;
    if (linkPending) return;
    if (!guideSeen() && !ride.session && !ride.resumable) setGuideOpen(true);
  }, [shared, ride.session, ride.resumable]);

  function toggleDev() {
    const next = !devEnabled;
    setDevEnabled(next);
    saveDevEnabled(next);
    if (!next) setDevOpen(false);
    setDevNote(next ? 'Dev tools on' : 'Dev tools off');
    window.setTimeout(() => setDevNote(null), 2000);
  }

  const running = ride.session?.status === 'running';

  /*
   * Only on the idle screen. Mid-session whoever is holding the phone has
   * plainly got in already, and the notice run pushes the numbers down — an
   * install offer is not worth moving the pace readout mid-rep.
   */
  const showInstallBanner =
    canPromptInstall(installCtx) &&
    !installDismissed &&
    !installOpen &&
    !ride.session &&
    !ride.resumable;

  return (
    <div className="relative h-full overflow-hidden">
      <RideScreen
        ride={ride}
        devEnabled={devEnabled}
        onToggleDev={toggleDev}
        onOpenDev={() => setDevOpen(true)}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        notice={
          showInstallBanner ? (
            <InstallBanner
              ctx={installCtx}
              onOpen={() => setInstallOpen(true)}
              onDismiss={() => setInstallDismissed(true)}
            />
          ) : null
        }
      />
      <FinishCard ride={ride} onOpenHistory={() => setHistoryOpen(true)} />
      {pickerOpen && <WorkoutPicker ride={ride} onClose={() => setPickerOpen(false)} />}
      {devOpen && (
        <DevPanel ride={ride} onClose={() => setDevOpen(false)} onHideDev={toggleDev} />
      )}
      {guideOpen && (
        <Guide
          onClose={() => setGuideOpen(false)}
          onOpenInstall={canPromptInstall(installCtx) ? () => setInstallOpen(true) : undefined}
        />
      )}
      {installOpen && <InstallSheet ctx={installCtx} onClose={() => setInstallOpen(false)} />}
      {historyOpen && <History onClose={() => setHistoryOpen(false)} />}
      <ResumePrompt ride={ride} />
      {shared && (
        <SharedWorkout
          workout={shared}
          onAdd={() => {
            const w = adoptWorkout(shared);
            void ride.saveWorkout(w).then((saved) => ride.setSelectedWorkout(saved));
            clearPendingLink();
            setShared(null);
          }}
          onDismiss={() => {
            clearPendingLink();
            setShared(null);
          }}
        />
      )}

      {devNote && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center">
          <span className="rounded-full bg-raised px-4 py-2 text-sm font-black text-ink shadow-lg">
            {devNote}
          </span>
        </div>
      )}

      {shareError && (
        <div className="absolute inset-x-0 bottom-0 z-30 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-raised px-4 py-3 shadow-lg">
            <span className="flex-1 text-sm font-bold text-ink">{shareError}</span>
            <button
              onClick={() => setShareError(null)}
              className="text-sm font-bold text-muted"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* An update is never applied mid-workout; while running this is a note,
          not a button, so a stray thumb can't reload the app under him. */}
      {updateReady && (
        <div className="absolute inset-x-0 bottom-0 z-30 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-raised px-4 py-3 shadow-lg">
            <span className="flex-1 text-sm font-bold text-ink">
              {running ? 'New version ready — installs after you finish' : 'New version ready'}
            </span>
            {!running && (
              <button
                onClick={() => void applyUpdate()}
                className="rounded-lg bg-next px-3 py-2 text-sm font-black text-next-ink"
              >
                Update
              </button>
            )}
            <button
              onClick={() => setUpdateReady(false)}
              className="text-sm font-bold text-muted"
              aria-label="Dismiss update notice"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {ride.suspended && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/85">
          <div className="px-6 text-center text-white">
            <div className="text-3xl font-black">JS SUSPENDED</div>
            <div className="mt-2 text-sm">
              Simulating a backgrounded tab. Nothing is ticking. Times reconcile from timestamps
              when this clears.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
