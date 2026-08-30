/**
 * Handing a file to the platform, without ever suspending first.
 *
 * iOS grants a tap a short window in which `navigator.share` may be called,
 * and the first `await` spends it: the sheet never opens, no error is thrown,
 * and nothing on screen says why. So this takes a file that has *already* been
 * built and is synchronous up to the share call — which means the rule is
 * enforced by the signature. Anything a share needs that has to be fetched,
 * an IndexedDB read most of all, is fetched before the tap, not during it.
 *
 * The result comes back through a callback rather than a promise for the same
 * reason: a caller awaiting this function would be back where it started.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'canceled';

/** Last resort when the share sheet isn't on offer: put it in Files. */
function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

export function shareFile(file: File, onDone: (outcome: ShareOutcome) => void): void {
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: file.name }).then(
      () => onDone('shared'),
      (e: { name?: string }) => {
        // A canceled share is not a failure and needs no fallback. Anything
        // else falls through to the download rather than leaving him with no
        // way to get the file off the phone.
        if (e?.name === 'AbortError') {
          onDone('canceled');
          return;
        }
        download(file);
        onDone('downloaded');
      },
    );
    return;
  }
  download(file);
  onDone('downloaded');
}
