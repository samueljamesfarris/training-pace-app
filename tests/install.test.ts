import {
  canPromptInstall,
  detectInstallContext,
  isInAppAgent,
} from '../src/lib/install.ts';

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (want ${want})`}`);
}

/*
 * Real agent strings, because that is the only way to check agent sniffing.
 * Every one of these was copied from a device or from a vendor's own docs;
 * shortening one to "the interesting part" is how this kind of test rots.
 */
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15';
const GOOGLE_APP_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/295.0.567561978 Mobile/15E148 Safari/604.1';
const FACEBOOK_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/466.0.0.35.107]';
const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.37.90';
/* Slack, Gmail's viewer, and every other plain WKWebView: no Safari token. */
const BARE_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const IPADOS_SAFARI = MAC_SAFARI; // iPadOS lies about being a Mac; touch points give it away.

console.log('--- an installed app is never prompted ---');
{
  // Whatever the agent says, standalone settles it. Nagging somebody who has
  // already installed it is the one outcome with no possible upside.
  eq('installed from Safari', detectInstallContext(SAFARI_IPHONE, true, 5), 'installed');
  eq('installed, agent unreadable', detectInstallContext('', true, 5), 'installed');
  eq('nothing to prompt', canPromptInstall('installed'), false);
}

console.log('\n--- Safari gets the plain steps ---');
{
  eq('iPhone Safari', detectInstallContext(SAFARI_IPHONE, false, 5), 'ios-safari');
  eq('iPad reporting as a Mac', detectInstallContext(IPADOS_SAFARI, false, 5), 'ios-safari');
}

console.log('\n--- other real browsers keep the steps, plus a way out ---');
{
  eq('Chrome on iOS', detectInstallContext(CHROME_IOS, false, 5), 'ios-browser');
  eq('Firefox on iOS', detectInstallContext(FIREFOX_IOS, false, 5), 'ios-browser');
}

console.log('\n--- an in-app browser is told to escape first ---');
{
  // The case that was actually losing people: a link sent through a messaging
  // app has no Add to Home Screen anywhere in its sheet.
  eq('Facebook', detectInstallContext(FACEBOOK_IOS, false, 5), 'ios-in-app');
  eq('Instagram', detectInstallContext(INSTAGRAM_IOS, false, 5), 'ios-in-app');
  eq('a bare WKWebView (Slack, Gmail)', detectInstallContext(BARE_WEBVIEW, false, 5), 'ios-in-app');
  // Google's app is the reason the marker list exists at all: its agent is
  // Safari's exactly, down to the Safari token, so the generic test misses it.
  eq('the Google app', detectInstallContext(GOOGLE_APP_IOS, false, 5), 'ios-in-app');
  eq('and Google is not caught generically', /Safari\//.test(GOOGLE_APP_IOS), true);
}

console.log('\n--- everywhere else is left alone ---');
{
  // Android has its own install flow and shares storage with the browser, so
  // none of this advice applies; saying it there would be a false alarm.
  eq('Android Chrome', detectInstallContext(ANDROID_CHROME, false, 5), 'elsewhere');
  eq('a real Mac has no touch', detectInstallContext(MAC_SAFARI, false, 0), 'elsewhere');
  eq('nothing to prompt', canPromptInstall('elsewhere'), false);
}

console.log('\n--- the in-app test on its own ---');
{
  eq('Safari is not in-app', isInAppAgent(SAFARI_IPHONE), false);
  eq('Chrome is not in-app', isInAppAgent(CHROME_IOS), false);
  eq('Firefox is not in-app', isInAppAgent(FIREFOX_IOS), false);
  eq('a bare webview is', isInAppAgent(BARE_WEBVIEW), true);
}

console.log('\n--- every iOS case is worth a prompt ---');
{
  eq('Safari', canPromptInstall('ios-safari'), true);
  eq('another browser', canPromptInstall('ios-browser'), true);
  eq('in-app', canPromptInstall('ios-in-app'), true);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
