import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Three projects: pure logic in Node, DOM/Vue in happy-dom, and real WebGL/Cache Storage in Chromium.
// Live tests talk to the real CDN, so they get long timeouts.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
      projects: [
        { extends: true, test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } },
        { extends: true, test: { name: 'dom', environment: 'happy-dom', include: ['tests/dom/**/*.test.ts'], setupFiles: ['tests/setup/dom.ts'] } },
        {
          extends: true,
          test: {
            name: 'browser',
            include: ['tests/browser/**/*.test.ts'],
            testTimeout: 120_000,
            hookTimeout: 120_000,
            browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }], viewport: { width: 1280, height: 800 } },
          },
        },
      ],
    },
  }),
)
