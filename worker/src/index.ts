// Caching proxy in front of the Lunar Client texture CDN.
// Files are content-addressed (sha1), so they can be cached for a year at the edge and in browsers.

const ORIGIN = 'https://textures.lunarclientcdn.com'

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

    const { pathname } = new URL(request.url)
    if (!/^\/(file|index)\/[0-9a-f]{40}$/.test(pathname)) return new Response('Not found', { status: 404 })

    const cache = caches.default
    const key = new Request(ORIGIN + pathname)
    let res = await cache.match(key)
    if (!res) {
      const upstream = await fetch(ORIGIN + pathname)
      if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: cors() })
      res = new Response(upstream.body, upstream)
      res.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      ctx.waitUntil(cache.put(key, res.clone()))
    }
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(cors())) out.headers.set(k, v)
    return out
  },
}

function cors(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
}
