import { useEffect, useState } from 'react';
import { DevPanel } from './components/DevPanel';
import { FinishCard } from './components/FinishCard';
import { ResumePrompt } from './components/ResumePrompt';
import { RideScreen } from './components/RideScreen';
import { WorkoutPicker } from './components/WorkoutPicker';
import { applyUpdate, registerServiceWorker } from './lib/serviceWorker';
import { useRide } from './lib/useRide';

export default function App() {
  const ride = useRide();
  const [devOpen, setDevOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true));
  }, []);

  const running = ride.session?.status === 'running';

  return (
    <div className="relative h-full overflow-hidden">
      <RideScreen
        ride={ride}
        onOpenDev={() => setDevOpen(true)}
        onOpenPicker={() => setPickerOpen(true)}
      />
      <FinishCard ride={ride} />
      {pickerOpen && <WorkoutPicker ride={ride} onClose={() => setPickerOpen(false)} />}
      {devOpen && <DevPanel ride={ride} onClose={() => setDevOpen(false)} />}
      <ResumePrompt ride={ride} />

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
