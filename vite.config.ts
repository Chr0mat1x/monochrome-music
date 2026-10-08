import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local yt-dlp proxy that serves full-length audio (see server/index.mjs).
const AUDIO_SERVER = process.env.MONO_SERVER_URL || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 12000,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
    proxy: {
      '/api': { target: AUDIO_SERVER, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 12000,
  },
})
