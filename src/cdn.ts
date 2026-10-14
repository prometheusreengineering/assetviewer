import { CDN_BASE } from './config'

const CACHE_NAME = 'assetviewer-cdn-v1'
const inflight = new Map<string, Promise<ArrayBuffer>>()

export const fileUrl = (hash: string) => `${CDN_BASE}/file/${hash}`
export const indexUrl = (hash: string) => `${CDN_BASE}/index/${hash}`

/** Retries network errors, 429 and 5xx with backoff (honouring Retry-After) so throttling degrades gracefully. */
async function fetchRetry(url: string, attempts = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      if (i >= attempts - 1 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} ${url}`)
      const wait = Number(res.headers.get('Retry-After')) * 1000 || 0
      await new Promise((r) => setTimeout(r, Math.max(wait, 400 * 2 ** i)))
    } catch (e) {
      if (i >= attempts - 1 || (e instanceof Error && /^\d{3} /.test(e.message))) throw e
      await new Promise((r) => setTimeout(r, 400 * 2 ** i))
    }
  }
}

// Everything on the CDN is addressed by content hash, so Cache Storage can keep it forever
// and repeat visits cost zero requests (the CDN itself sends max-age=0).
async function fetchCached(url: string): Promise<ArrayBuffer> {
  let cache: Cache | undefined
  try {
    cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) return hit.arrayBuffer()
  } catch {
    cache = undefined
  }
  const res = await fetchRetry(url)
  cache?.put(url, res.clone()).catch(() => {})
  return res.arrayBuffer()
}

function dedupe(url: string): Promise<ArrayBuffer> {
  let p = inflight.get(url)
  if (!p) {
    p = fetchCached(url).finally(() => inflight.delete(url))
    inflight.set(url, p)
  }
  return p
}

/** Any content-addressed URL (the hash must be part of the URL, e.g. `?h=<sha1>`), cached forever. */
export const getUrlBuffer = (url: string) => dedupe(url)

/** A URL whose content changes (an index): network first, the cached copy when offline. */
export async function getFreshBuffer(url: string): Promise<ArrayBuffer> {
  let cache: Cache | undefined
  try {
    cache = await caches.open(CACHE_NAME)
  } catch {
    cache = undefined
  }
  try {
    const res = await fetchRetry(url, 3)
    cache?.put(url, res.clone()).catch(() => {})
    return await res.arrayBuffer()
  } catch (e) {
    const hit = await cache?.match(url).catch(() => undefined)
    if (hit) return hit.arrayBuffer()
    throw e
  }
}

export const getIndexBuffer = (hash: string) => dedupe(indexUrl(hash))
export const getFileBuffer = (hash: string) => dedupe(fileUrl(hash))
export const getFileText = async (hash: string) => new TextDecoder().decode(await getFileBuffer(hash))
export const getFileJson = async <T = unknown>(hash: string) => JSON.parse(await getFileText(hash)) as T
