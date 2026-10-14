import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // PRIMEUI_LICENSE from .env is read at build time and embedded in the bundle.
  envPrefix: ['VITE_', 'PRIMEUI_'],
  // The Dawn CDN sends no CORS headers; production goes through functions/dawn (a Pages Function), dev through this.
  server: {
    proxy: { '/dawn/': { target: 'https://assets.dawn.gg', changeOrigin: true, rewrite: (p) => p.replace(/^\/dawn\//, '/assets/') } },
  },
})
