import { isIOSAgent } from './share';

/**
 * Which install path — if any — this browser can actually offer.
 *
 * The app is only worth much once it is on the home screen, and on iOS the
 * only way to get it there is to talk somebody through Apple's share sheet.
 * There is no `beforeinstallprompt` on iOS: the install cannot be triggered,
 * offered, or even observed, so instruction is the whole of the mechanism and
 * the instruction has to match the browser they are actually holding.
 *
 * Three cases behave differently enough to need different words:
 *
 * - Safari has the share button in the toolbar and the entry buried down the
 *   sheet. This is the case everything else is measured against.
 * - Chrome, Firefox, Edge and friends on iOS put the same thing somewhere
 *   else, and not all of them offer it at all. They get the steps plus a way
 *   out to Safari when the entry isn't there.
 * - An in-app browser — the one Gmail, Instagram, Slack or Facebook opens a
 *   link in — has no entry at all. Rewording the steps cannot help; the only
 *   move is to escape to Safari first. This is the case that was silently
 *   eating people, because a link sent through a messaging app is exactly how
 *   a stranger first meets the app.
 */
export type InstallContext =
  | 'installed'
  | 'ios-safari'
  | 'ios-browser'
  | 'ios-in-app'
  /** Android, desktop, anything else: it has its own install story, or none. */
  | 'elsewhere';

/*
 * Apps whose in-app browser is common enough to name, and which carry a marker
 * that survives into the agent string. Not exhaustive and never will be — the
 * generic test below is what actually catches the long tail.
 */
const IN_APP_MARKERS =
  /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|Pinterest|Twitter|MicroMessenger|GSA\/|Line\//;

/** Real browsers that are not Safari. They keep the share sheet, elsewhere. */
const THIRD_PARTY_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/;

/**
 * Whether this looks like a link opened inside another app.
 *
 * Two tests, because neither is enough alone. The marker list catches the apps
 * that announce themselves — including Google's, which otherwise passes for
 * Safari exactly. The `Safari/` test catches everyone else: on iOS a plain
 * embedded WKWebView leaves that token off, while every real browser keeps it,
 * Chrome and Firefox included.
 *
 * Wrong in the cautious direction only changes which set of instructions is
 * offered, and both sets end at the same place.
 */
export function isInAppAgent(ua: string): boolean {
  return IN_APP_MARKERS.test(ua) || !/Safari\//.test(ua);
}

/**
 * What to tell this browser, from values rather than from `navigator`.
 *
 * Pure so the agent strings can be checked against a table; agent sniffing is
 * only defensible when it is pinned down by tests.
 */
export function detectInstallContext(
  ua: string,
  standalone: boolean,
  maxTouchPoints: number,
): InstallContext {
  if (standalone) return 'installed';
  if (!isIOSAgent(ua, maxTouchPoints)) return 'elsewhere';
  if (isInAppAgent(ua)) return 'ios-in-app';
  if (THIRD_PARTY_BROWSERS.test(ua)) return 'ios-browser';
  return 'ios-safari';
}

/** The same question asked of the live browser. Never throws. */
export function installContext(): InstallContext {
  try {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    return detectInstallContext(navigator.userAgent, standalone, navigator.maxTouchPoints);
  } catch {
    // Nothing readable: say nothing rather than nag on a guess.
    return 'elsewhere';
  }
}

/** Whether there is anything worth prompting about. */
export function canPromptInstall(ctx: InstallContext): boolean {
  return ctx === 'ios-safari' || ctx === 'ios-browser' || ctx === 'ios-in-app';
}
