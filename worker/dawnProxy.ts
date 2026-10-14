// Same-origin proxy for the Dawn Client asset CDN, which sends no CORS headers (run by worker/index.ts).
// GET /dawn/assets_index.json and /dawn/game/...; files carry ?h=<sha1> from the index, so the edge cache key
// changes with the content and those responses can be cached for a year.

export const ORIGIN = 'https://assets.dawn.gg/assets/'
const ALLOWED = /^(assets_index\.json|game\/[\w\-./ %]+)$/

export interface EdgeCache {
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<void>
}

export async function handle(request: Request, fetcher: typeof fetch, cache?: EdgeCache, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/dawn\//, '')
  if (!ALLOWED.test(path) || path.includes('..')) return new Response('Not found', { status: 404 })
  const isIndex = path === 'assets_index.json'
  const hashed = !isIndex && /^[0-9a-f]{40}$/.test(url.searchParams.get('h') ?? '')
  const range = request.headers.get('Range')
  // Cache whole files only; a Range request is served from the cached whole file when there is one.
  const key = new Request(ORIGIN + path + (hashed ? '?h=' + url.searchParams.get('h') : ''))
  let res = await cache?.match(key)
  if (!res) {
    const upstream = await fetcher(ORIGIN + path, range && !cache ? { headers: { Range: range } } : undefined)
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status })
    res = new Response(upstream.body, upstream)
    res.headers.set('Cache-Control', isIndex ? 'public, max-age=300' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    if (cache && upstream.status === 200) {
      const put = cache.put(key, res.clone())
      if (waitUntil) waitUntil(put)
      else await put
    }
  }
  if (range && res.status === 200) return sliceRange(res, range)
  return res
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
