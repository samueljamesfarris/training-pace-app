import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A render throw used to white-screen the app mid-workout, which is the worst
 * possible failure here: the ride is still happening and the phone is showing
 * nothing.
 *
 * This does not try to preserve state, because it doesn't need to. `persistNow`
 * writes the session every second and `ResumePrompt` offers any unfinished one
 * back on the next load, so the recovery path already exists. The job is to
 * fail loudly, say the session is safe, and offer the one action that helps.
 *
 * The fallback deliberately depends on nothing — no hooks, no ride state, no
 * theme state — so it still renders when whatever broke is exactly that.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Never swallow it: this is the only record of what happened.
    console.error('[fatal] render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-surface px-6 text-ink">
        <div className="text-center">
          <h1 className="text-3xl font-black">Something broke</h1>
          <p className="mt-3 text-base font-semibold text-muted">
            Your session was saved. Reload and it will offer to pick up where you left off.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="h-[76px] w-full max-w-sm rounded-2xl bg-go text-2xl font-black text-go-ink"
        >
          RELOAD
        </button>
        <p className="max-w-sm text-center text-xs text-muted">
          {this.state.error.message}
        </p>
      </div>
    );
  }
}
