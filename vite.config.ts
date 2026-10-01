import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // PRIMEUI_LICENSE from .env is read at build time and embedded in the bundle.
  envPrefix: ['VITE_', 'PRIMEUI_'],
})
