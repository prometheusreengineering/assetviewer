import { describe, expect, it, vi } from 'vitest'
import { handle, ORIGIN } from '../../worker/dawnProxy'

const H = 'a'.repeat(40)
const req = (path: string, init?: RequestInit) => new Request('https://assetviewer.dreamys.studio' + path, init)

function memCache() {
  const store = new Map<string, Response>()
  return {
    store,
    match: vi.fn(async (r: Request) => store.get(r.url)?.clone()),
    put: vi.fn(async (r: Request, res: Response) => void store.set(r.url, res)),
  }
}

describe('dawn proxy', () => {
  it('only allows the index and game files', async () => {
    const fetcher = vi.fn(async () => new Response('x'))
    for (const p of ['/dawn/', '/dawn/other.json', '/dawn/game/../secret', '/dawn/https://evil.example/x']) {
      expect((await handle(req(p), fetcher)).status, p).toBe(404)
    }
    expect((await handle(req('/dawn/assets_index.json', { method: 'POST' }), fetcher)).status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetches from the Dawn origin and sets cache headers by kind', async () => {
    const fetcher = vi.fn(async () => new Response('body', { headers: { 'Content-Type': 'image/webp' } }))
    const idx = await handle(req('/dawn/assets_index.json'), fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(ORIGIN + 'assets_index.json', undefined)
    expect(idx.headers.get('Cache-Control')).toBe('public, max-age=300')
    const file = await handle(req(`/dawn/game/cosmetics/hats/a.webp?h=${H}`), fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(ORIGIN + 'game/cosmetics/hats/a.webp', undefined)
    expect(file.headers.get('Cache-Control')).toContain('immutable')
    expect(file.headers.get('Content-Type')).toBe('image/webp')
    expect(await file.text()).toBe('body')
    const unhashed = await handle(req('/dawn/game/cosmetics/hats/a.webp'), fetcher)
    expect(unhashed.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })

  it('passes upstream errors through', async () => {
    const res = await handle(req('/dawn/game/missing.webp'), async () => new Response('nope', { status: 404 }))
    expect(res.status).toBe(404)
  })

  it('caches whole files at the edge keyed by hash and serves ranges from them', async () => {
    const cache = memCache()
    const fetcher = vi.fn(async () => new Response('0123456789'))
    const r1 = await handle(req(`/dawn/game/a.webp?h=${H}`, { headers: { Range: 'bytes=2-4' } }), fetcher, cache)
    expect(r1.status).toBe(206)
    expect(r1.headers.get('Content-Range')).toBe('bytes 2-4/10')
    expect(await r1.text()).toBe('234')
    expect(cache.store.has(ORIGIN + `game/a.webp?h=${H}`)).toBe(true)
    const r2 = await handle(req(`/dawn/game/a.webp?h=${H}`), fetcher, cache)
    expect(await r2.text()).toBe('0123456789')
    const r3 = await handle(req(`/dawn/game/a.webp?h=${H}`, { headers: { Range: 'bytes=-3' } }), fetcher, cache)
    expect(await r3.text()).toBe('789')
    expect((await handle(req(`/dawn/game/a.webp?h=${H}`, { headers: { Range: 'bytes=50-' } }), fetcher, cache)).status).toBe(416)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('forwards Range upstream when there is no edge cache', async () => {
    const fetcher = vi.fn(async () => new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } }))
    const res = await handle(req('/dawn/game/a.webp', { headers: { Range: 'bytes=0-1' } }), fetcher)
    expect(fetcher).toHaveBeenCalledWith(ORIGIN + 'game/a.webp', { headers: { Range: 'bytes=0-1' } })
    expect(res.status).toBe(206)
  })
})

describe('site worker', () => {
  it('proxies /dawn/* and serves everything else from the static assets', async () => {
    const { default: worker } = await import('../../worker/index')
    const cache = memCache()
    vi.stubGlobal('caches', { default: cache })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
    const assets = { fetch: vi.fn(async () => new Response('<html>')) }
    const waits: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) }
    const dawn = await worker.fetch(req('/dawn/assets_index.json'), { ASSETS: assets }, ctx)
    expect(await dawn.text()).toBe('[]')
    expect(waits).toHaveLength(1)
    expect(assets.fetch).not.toHaveBeenCalled()
    const page = await worker.fetch(req('/#/dawn/hats'), { ASSETS: assets }, ctx)
    expect(await page.text()).toBe('<html>')
    expect((await worker.fetch(req('/assets/index.js'), { ASSETS: assets }, ctx)).status).toBe(200)
    expect(assets.fetch).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
