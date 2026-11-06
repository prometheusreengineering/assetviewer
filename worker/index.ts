// The site's Worker (Cloudflare Workers with static assets, see wrangler.jsonc): /dawn/* is proxied to the
// Dawn CDN, everything else is the built site in dist/.
import { handle, type EdgeCache } from './dawnProxy'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/dawn/')) {
      const edge = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default
      return handle(request, fetch, edge, (p) => ctx.waitUntil(p))
    }
    // Existing files never get here (only /dawn/* runs this Worker first), so this only costs misses.
    const res = await env.ASSETS.fetch(request)
    if (res.status !== 404) return res
    // public/_headers marks all of /assets/* immutable, which must not hold for a file that isn't there.
    const missing = new Response(res.body, res)
    missing.headers.set('Cache-Control', 'no-store')
    return missing
  },
}
