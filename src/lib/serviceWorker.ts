/**
 * Registers the offline shell and reports when a newer build is waiting.
 *
 * The new version is never applied automatically. Swapping bundles mid-workout
 * is the one thing this app must not do, so the page surfaces a prompt and the
 * user takes the update when they're standing still.
 */
export function registerServiceWorker(onUpdateReady: () => void) {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  // This runs from a React effect, which fires *after* `load` has already
  // happened — so waiting for that event would mean never registering at all.
  const start = () => {
    const url = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker
      .register(url)
      .then((reg) => {
        // Already waiting from a previous visit.
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady();

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` present means this is an update, not a first install.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateReady();
            }
          });
        });
      })
      .catch((e) => console.warn('[sw] registration failed', e));

    /*
     * Reload only when an *update* takes over, never on a first install.
     *
     * A first registration ends with the worker calling clients.claim(), which
     * fires controllerchange on a page that is already running the newest code
     * — there is nothing to reload for. Reloading anyway cost a real feature:
     * a workout link opened in a browser that had never seen the app booted,
     * read the link, cleared the fragment, and was then reloaded onto the bare
     * URL, so the shared workout vanished before it could be accepted. That is
     * every first-time visitor tapping a shared link.
     *
     * A controller present at registration time means this page is already
     * controlled, so a later controllerchange is a new version taking over,
     * which is the only case that needs the reload.
     */
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** Tell the waiting worker to take over; the reload follows from it. */
export async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING');
  else window.location.reload();
}
