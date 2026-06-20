import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PhotoBooth Gallery',
        short_name: 'Gallery',
        description: 'Browse and select your photos',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  server: { port: 5173 },
});
