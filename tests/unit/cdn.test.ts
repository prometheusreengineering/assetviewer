import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// cdn.ts keeps a module-level in-flight map, so each test gets a fresh copy.
async function load() {
  vi.resetModules()
  return import('../../src/cdn')
}

/** A tiny in-memory Cache Storage. */
function fakeCaches() {
  const store = new Map<string, Response>()
  const cache = {
    match: vi.fn(async (url: string) => store.get(url)?.clone()),
    put: vi.fn(async (url: string, res: Response) => void store.set(url, res)),
  }
  const caches = { open: vi.fn(async () => cache) }
  return { caches, cache, store }
}

const ok = (body: string) => new Response(body, { status: 200 })

beforeEach(() => vi.useRealTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('urls', () => {
  it('builds file and index urls', async () => {
    const cdn = await load()
    expect(cdn.fileUrl('abc')).toBe('https://textures.lunarclientcdn.com/file/abc')
    expect(cdn.indexUrl('def')).toBe('https://textures.lunarclientcdn.com/index/def')
  })
})

describe('fetching', () => {
  it('fetches on a miss, stores the response and serves the next call from the cache', async () => {
    const { caches, cache, store } = fakeCaches()
    const fetch = vi.fn(async () => ok('hello'))
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    expect(await cdn.getFileText('h1')).toBe('hello')
    await vi.waitFor(() => expect(store.has(cdn.fileUrl('h1'))).toBe(true))
    expect(caches.open).toHaveBeenCalledWith('assetviewer-cdn-v1')
    expect(await cdn.getFileText('h1')).toBe('hello')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cache.match).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent requests for the same url', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = vi.fn(async () => {
      await gate
      return ok('x')
    })
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const a = cdn.getFileBuffer('same')
    const b = cdn.getFileBuffer('same')
    const c = cdn.getIndexBuffer('same')
    release()
    await Promise.all([a, b, c])
    // file + index are different urls
    expect(fetch).toHaveBeenCalledTimes(2)
    // once settled, a new call fetches again (no cache available)
    await cdn.getFileBuffer('same')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('works without Cache Storage and when opening it throws', async () => {
    vi.stubGlobal('fetch', async () => ok('{"a":[1,2]}'))
    vi.stubGlobal('caches', { open: () => Promise.reject(new Error('SecurityError')) })
    const cdn = await load()
    expect(await cdn.getFileJson('j')).toEqual({ a: [1, 2] })
  })

  it('ignores a failing cache.put', async () => {
    const { caches, cache } = fakeCaches()
    cache.put.mockRejectedValue(new Error('quota'))
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('fetch', async () => ok('fine'))
    const cdn = await load()
    expect(await cdn.getFileText('q')).toBe('fine')
  })

  it('decodes UTF-8 text', async () => {
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal('fetch', async () => new Response(new TextEncoder().encode('héllo ✓')))
    const cdn = await load()
    expect(await cdn.getFileText('u')).toBe('héllo ✓')
  })
})

describe('retries', () => {
  beforeEach(() => vi.stubGlobal('caches', undefined))

  it('retries 429 and 5xx with exponential backoff', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok('done'))
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const p = cdn.getFileText('r')
    await vi.advanceTimersByTimeAsync(399)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(800)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(await p).toBe('done')
  })

  it('honours Retry-After when it is longer than the backoff', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(ok('late'))
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const p = cdn.getFileText('r')
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe('late')
  })

  it('retries network errors', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<() => Promise<Response>>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok('back'))
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const p = cdn.getFileText('n')
    await vi.advanceTimersByTimeAsync(400)
    expect(await p).toBe('back')
  })

  it('does not retry other 4xx', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    await expect(cdn.getFileBuffer('missing')).rejects.toThrow('404 https://textures.lunarclientcdn.com/file/missing')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('gives up after 5 attempts', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const p = cdn.getFileBuffer('down')
    const assertion = expect(p).rejects.toThrow(/^500 /)
    await vi.advanceTimersByTimeAsync(400 + 800 + 1600 + 3200)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('gives up on repeated network errors', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => {
      throw new TypeError('offline')
    })
    vi.stubGlobal('fetch', fetch)
    const cdn = await load()
    const assertion = expect(cdn.getFileBuffer('off')).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})
