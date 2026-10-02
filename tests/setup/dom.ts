import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, vi } from 'vitest'

// happy-dom has no Cache Storage or WebGL; give every test a clean, predictable browser.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  vi.stubGlobal('caches', undefined)
})
// afterEach hooks run last-registered first: unmount the components, then drop the overlays they teleported to body.
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
enableAutoUnmount(afterEach)
