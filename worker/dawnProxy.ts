// Same-origin proxy for the Dawn Client asset CDN, which sends no CORS headers (run by worker/index.ts).
// GET /dawn/assets_index.json and /dawn/game/...; files carry ?h=<sha1> from the index, so the edge cache key
// changes with the content and those responses can be cached for a year.

export const ORIGIN = 'https://assets.dawn.gg/assets/'
const INDEX = 'assets_index.json'
// Checked after decoding, so %2e%2e%2f is seen as ../ and a double-encoded path keeps its % and fails.
const ALLOWED = /^(assets_index\.json|game\/[\p{L}\p{N}_\-./ ]+)$/u
const CONTENT_TYPES: Record<string, string> = { json: 'application/json', webp: 'image/webp', avif: 'image/avif', png: 'image/png', gif: 'image/gif' }
const COPIED_HEADERS = ['ETag', 'Last-Modified', 'Content-Range']
const INDEX_MAX_AGE = 300
const INDEX_MEMO_MS = INDEX_MAX_AGE * 1000

export interface EdgeCache {
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<void>
}

type WaitUntil = (p: Promise<unknown>) => void

function decodedPath(pathname: string): string | undefined {
  try {
    const path = decodeURIComponent(pathname.replace(/^\/dawn\//, ''))
    return ALLOWED.test(path) && !path.includes('..') ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * This runs on the site's own origin, so nothing of the upstream response decides how a browser treats it: the type
 * comes from our list (a page Dawn might host can't run here), and cookies and other headers stay behind.
 */
function ownHeaders(res: Response, path: string, cacheControl: string): Response {
  const headers = new Headers({
    'Content-Type': CONTENT_TYPES[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  for (const name of COPIED_HEADERS) {
    const v = res.headers.get(name)
    if (v) headers.set(name, v)
  }
  // The length of a compressed upstream body says nothing about the decoded one this response carries.
  const length = res.headers.get('Content-Length')
  if (length && !res.headers.get('Content-Encoding')) headers.set('Content-Length', length)
  return new Response(res.body, { status: res.status, headers })
}

function store(key: Request, res: Response, cache: EdgeCache | undefined, waitUntil: WaitUntil | undefined): Promise<void> | undefined {
  if (!cache || res.status !== 200) return
  const put = cache.put(key, res.clone())
  if (!waitUntil) return put
  waitUntil(put)
}

let memo: { text: string; at: number } | undefined

export function resetIndexMemo() {
  memo = undefined
}

/** The index text, briefly kept in memory: every request with a hash asks, and only needs a substring search. */
async function indexText(fetcher: typeof fetch, cache: EdgeCache | undefined, waitUntil: WaitUntil | undefined): Promise<string | undefined> {
  if (memo && Date.now() - memo.at < INDEX_MEMO_MS) return memo.text
  const key = new Request(ORIGIN + INDEX)
  let res = await cache?.match(key)
  if (!res) {
    const upstream = await fetcher(ORIGIN + INDEX)
    if (!upstream.ok) return undefined
    res = ownHeaders(upstream, INDEX, `public, max-age=${INDEX_MAX_AGE}`)
    await store(key, res, cache, waitUntil)
  }
  const text = await res.text()
  memo = { text, at: Date.now() }
  return text
}

export async function handle(request: Request, fetcher: typeof fetch, cache?: EdgeCache, waitUntil?: WaitUntil): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const url = new URL(request.url)
  const path = decodedPath(url.pathname)
  if (!path) return new Response('Not found', { status: 404 })
  // The name as requested: upstream wants the same encoding.
  const upstreamPath = url.pathname.replace(/^\/dawn\//, '')
  const isIndex = path === INDEX
  const h = url.searchParams.get('h') ?? ''
  try {
    // Only a hash the index knows gets its own cache entry and a year of caching. Others share the file's plain,
    // short-lived entry, so made-up hashes can't fill the cache or reach Dawn's origin on every request.
    const hashed = !isIndex && /^[0-9a-f]{40}$/.test(h) && !!(await indexText(fetcher, cache, waitUntil))?.includes(h)
    const cacheControl = isIndex ? `public, max-age=${INDEX_MAX_AGE}` : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300'
    const range = request.headers.get('Range')
    // Cache whole files only; a Range request is served from the cached whole file when there is one.
    const key = new Request(ORIGIN + upstreamPath + (hashed ? '?h=' + h : ''))
    const hit = await cache?.match(key)
    let res: Response
    if (hit) {
      // Rebuilt on the way out too: entries cached before these headers existed still hold the upstream's.
      res = ownHeaders(hit, path, cacheControl)
    } else {
      const upstream = await fetcher(ORIGIN + upstreamPath, range && !cache ? { headers: { Range: range } } : undefined)
      // Status only: the body of an upstream error page has no business on this origin.
      if (!upstream.ok) return new Response(null, { status: upstream.status })
      res = ownHeaders(upstream, path, cacheControl)
      await store(key, res, cache, waitUntil)
    }
    if (range && res.status === 200) return sliceRange(res, range)
    return res
  } catch {
    return new Response(null, { status: 502 })
  }
}

async function sliceRange(res: Response, range: string): Promise<Response> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (!m || (!m[1] && !m[2])) return new Response(buf, res)
  const total = buf.length
  const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]))
  const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
  if (start >= total || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
  const out = new Response(buf.slice(start, end + 1), { status: 206, headers: res.headers })
  out.headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  out.headers.set('Content-Length', String(end - start + 1))
  return out
}
