// The site's Worker (Cloudflare Workers Builds with static assets, see wrangler.jsonc): /dawn/* is proxied to the
// Dawn CDN, everything else is the built site in dist/.
import { handle, type EdgeCache } from './dawnProxy'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

export default {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/dawn/')) {
      const edge = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default
      return handle(request, fetch, edge, (p) => ctx.waitUntil(p))
    }
    return env.ASSETS.fetch(request)
  },
}
