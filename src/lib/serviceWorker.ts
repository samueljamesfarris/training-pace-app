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

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
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
