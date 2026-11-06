import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, ORIGIN, resetIndexMemo } from '../../worker/dawnProxy'

const H = 'a'.repeat(40)
const UNKNOWN = 'b'.repeat(40)
const INDEX_BODY = JSON.stringify([{ name: 'game/a.webp', hash: H }])
const req = (path: string, init?: RequestInit) => new Request('https://assetviewer.prometheusreengineer.ing' + path, init)

function memCache() {
  const store = new Map<string, Response>()
  return {
    store,
    match: vi.fn(async (r: Request) => store.get(r.url)?.clone()),
    put: vi.fn(async (r: Request, res: Response) => void store.set(r.url, res)),
  }
}

/** The Dawn origin: the index, and `file` for everything else. */
const origin = (file: () => Response) =>
  vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (String(url).endsWith('assets_index.json') ? new Response(INDEX_BODY) : file()))
const fileCalls = (f: ReturnType<typeof origin>) => f.mock.calls.filter(([u]) => !String(u).endsWith('assets_index.json'))

beforeEach(resetIndexMemo)

describe('dawn proxy', () => {
  it('only allows the index and game files', async () => {
    const fetcher = vi.fn(async () => new Response('x'))
    for (const p of [
      '/dawn/',
      '/dawn/other.json',
      '/dawn/game/../secret',
      '/dawn/https://evil.example/x',
      // encoded traversal: URL parsing leaves %2f alone, so only decoding shows it
      '/dawn/game/%2e%2e%2fsecret',
      '/dawn/game/..%2f..%2fsecret',
      // double encoded, and not decodable at all
      '/dawn/game/%252e%252e%252fsecret',
      '/dawn/game/%E0%A4%A',
    ]) {
      expect((await handle(req(p), fetcher)).status, p).toBe(404)
    }
    expect((await handle(req('/dawn/assets_index.json', { method: 'POST' }), fetcher)).status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('accepts the file names Dawn uses, spaces included', async () => {
    const fetcher = origin(() => new Response('x'))
    expect((await handle(req('/dawn/game/cosmetics/My%20Hat_2-b.webp'), fetcher)).status).toBe(200)
    expect(fetcher).toHaveBeenLastCalledWith(ORIGIN + 'game/cosmetics/My%20Hat_2-b.webp', undefined)
  })

  it('fetches from the Dawn origin and sets cache headers by kind', async () => {
    const fetcher = origin(() => new Response('body'))
    const idx = await handle(req('/dawn/assets_index.json'), fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(ORIGIN + 'assets_index.json', undefined)
    expect(idx.headers.get('Cache-Control')).toBe('public, max-age=300')
    const file = await handle(req(`/dawn/game/cosmetics/hats/a.webp?h=${H}`), fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(ORIGIN + 'game/cosmetics/hats/a.webp', undefined)
    expect(file.headers.get('Cache-Control')).toContain('immutable')
    expect(file.headers.get('Content-Type')).toBe('image/webp')
    expect(await file.text()).toBe('body')
    const unhashed = await handle(req('/dawn/game/cosmetics/hats/a.webp'), fetcher)
    expect(unhashed.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it("decides the response's headers itself, whatever the upstream sends", async () => {
    const fetcher = origin(
      () =>
        new Response('<script>alert(1)</script>', {
          headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=1', 'Access-Control-Allow-Origin': '*', ETag: '"x"', 'Content-Length': '25' },
        }),
    )
    const res = await handle(req('/dawn/game/page.html'), fetcher)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(res.headers.get('ETag')).toBe('"x"')
    expect(res.headers.get('Content-Length')).toBe('25')
  })

  it('rebuilds the headers of entries cached before this code', async () => {
    const cache = memCache()
    cache.store.set(ORIGIN + 'game/page.html', new Response('old', { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=1' } }))
    const res = await handle(req('/dawn/game/page.html'), origin(() => new Response('new')), cache)
    expect(await res.text()).toBe('old')
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it("drops a compressed upstream's length, which doesn't describe the decoded body", async () => {
    const fetcher = origin(() => new Response('{}', { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '999' } }))
    const res = await handle(req('/dawn/game/a.json'), fetcher)
    expect(res.headers.get('Content-Length')).toBeNull()
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('a hash the index does not know is not immutable and shares the plain cache entry', async () => {
    const cache = memCache()
    const fetcher = origin(() => new Response('body'))
    const res = await handle(req(`/dawn/game/a.webp?h=${UNKNOWN}`), fetcher, cache)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(cache.store.has(ORIGIN + 'game/a.webp')).toBe(true)
    expect(cache.store.has(ORIGIN + `game/a.webp?h=${UNKNOWN}`)).toBe(false)
    // Made-up hashes neither fill the cache nor reach the origin again.
    await handle(req(`/dawn/game/a.webp?h=${'c'.repeat(40)}`), fetcher, cache)
    await handle(req(`/dawn/game/a.webp?h=${'d'.repeat(40)}`), fetcher, cache)
    expect(fileCalls(fetcher)).toHaveLength(1)
  })

  it('reads the index once while it is fresh', async () => {
    const fetcher = origin(() => new Response('body'))
    await handle(req(`/dawn/game/a.webp?h=${H}`), fetcher)
    await handle(req(`/dawn/game/b.webp?h=${H}`), fetcher)
    expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('assets_index.json'))).toHaveLength(1)
  })

  it('is not immutable when the index is unavailable', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('assets_index.json') ? new Response(null, { status: 500 }) : new Response('body')))
    const res = await handle(req(`/dawn/game/a.webp?h=${H}`), fetcher)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('passes an upstream error status through, without its body', async () => {
    const res = await handle(req('/dawn/game/missing.webp'), async () => new Response('<h1>nope</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } }))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
    expect(res.headers.get('Content-Type')).toBeNull()
  })

  it('answers 502 when the origin cannot be reached', async () => {
    const res = await handle(req('/dawn/game/a.webp'), async () => {
      throw new Error('network down')
    })
    expect(res.status).toBe(502)
  })

  it('caches whole files at the edge keyed by hash and serves ranges from them', async () => {
    const cache = memCache()
    const fetcher = origin(() => new Response('0123456789'))
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
    expect(fileCalls(fetcher)).toHaveLength(1)
  })

  it('forwards Range upstream when there is no edge cache', async () => {
    const fetcher = vi.fn(async () => new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } }))
    const res = await handle(req('/dawn/game/a.webp', { headers: { Range: 'bytes=0-1' } }), fetcher)
    expect(fetcher).toHaveBeenCalledWith(ORIGIN + 'game/a.webp', { headers: { Range: 'bytes=0-1' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1/10')
  })
})

describe('site worker: missing files', () => {
  it('a 404 is never cached, whatever public/_headers put on it', async () => {
    const { default: worker } = await import('../../worker/index')
    const assets = { fetch: vi.fn(async () => new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } })) }
    const res = await worker.fetch(req('/assets/gone-abc.js'), { ASSETS: assets }, { waitUntil: () => {} })
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
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
