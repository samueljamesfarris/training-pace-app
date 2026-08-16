export type Theme = 'dark' | 'light';

const KEY = 'pace-theme';
/** Most sessions are pre-dawn, so night is the default. */
const DEFAULT: Theme = 'dark';

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // Keep the iOS status bar in step with the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#04070c' : '#f8fafc');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // A blocked storage write must never stop the app from rendering.
  }
}
