import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base so the built bundle works from any static host, including
  // a subdirectory (GitHub Pages project sites).
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
});
