import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * `process` is declared here rather than pulling in @types/node. This config is
 * the only file in the project that runs under Node, and one declared global
 * costs less than a dependency the app itself never uses.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Which commit this bundle was built from.
 *
 * The app is installed to a home screen and updates only when the service
 * worker is allowed to, so "which version is actually on the phone" is a real
 * question with a non-obvious answer. Baking it into the bundle is the only
 * honest way to ask it: the string ships inside the same file the browser is
 * running, so it cannot report a build the phone isn't using.
 *
 * Actions sets GITHUB_SHA, and Actions builds everything the phone ever runs.
 * A local build says "dev" rather than guessing at a commit that was never
 * deployed; the timestamp beside it is what tells two local builds apart.
 */
function buildSha(): string {
  return process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';
}

export default defineConfig({
  // Relative base so the built bundle works from any static host, including
  // a subdirectory (GitHub Pages project sites).
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
  },
});
