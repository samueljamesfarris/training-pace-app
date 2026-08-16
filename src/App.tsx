import { useState } from 'react';
import { DevPanel } from './components/DevPanel';
import { FinishCard } from './components/FinishCard';
import { RideScreen } from './components/RideScreen';
import { WorkoutPicker } from './components/WorkoutPicker';
import { useRide } from './lib/useRide';

export default function App() {
  const ride = useRide();
  const [devOpen, setDevOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
