import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json -> build.devUrl).
export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    sourcemap: 'hidden',
  },
  plugins: [react(), tsconfigPaths()],
})
