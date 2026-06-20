import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri serves this frontend. Fixed port + no clearScreen so Tauri's logs stay visible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
