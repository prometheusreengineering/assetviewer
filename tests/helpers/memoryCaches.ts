import { vi } from 'vitest'

/** An in-memory Cache Storage, so live tests in Node download each CDN file once (like the browser cache does). */
export function installMemoryCaches() {
  const stores = new Map<string, Map<string, ArrayBuffer>>()
  const caches = {
    async open(name: string) {
      let store = stores.get(name)
      if (!store) stores.set(name, (store = new Map()))
      const s = store
      return {
        async match(url: string) {
          const b = s.get(url)
          return b ? new Response(b.slice(0)) : undefined
        },
        async put(url: string, res: Response) {
          s.set(url, await res.arrayBuffer())
        },
      }
    },
  }
  vi.stubGlobal('caches', caches)
  return stores
}
