import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchImageSize, imageSize } from '../../src/dimensions'
import { gif, png, webpVP8, webpVP8L, webpVP8X } from '../fixtures/images'

describe('imageSize', () => {
  it.each([
    ['PNG', png(640, 480), [640, 480]],
    ['GIF', gif(300, 20), [300, 20]],
    ['WebP VP8X', webpVP8X(1024, 2048), [1024, 2048]],
    ['WebP VP8L', webpVP8L(64, 32), [64, 32]],
    ['WebP VP8', webpVP8(128, 96), [128, 96]],
  ] as const)('%s', (_, bytes, size) => expect(imageSize(bytes)).toEqual(size))

  it('reads large sizes', () => {
    expect(imageSize(webpVP8X(16384, 1))).toEqual([16384, 1])
    expect(imageSize(webpVP8L(16384, 16384))).toEqual([16384, 16384])
    expect(imageSize(png(100_000, 3))).toEqual([100_000, 3])
  })

  it('respects the byteOffset of a view into a bigger buffer', () => {
    const big = new Uint8Array(100)
    big.set(png(7, 9), 20)
    expect(imageSize(big.subarray(20))).toEqual([7, 9])
  })

  it('returns undefined for truncated or unknown data', () => {
    expect(imageSize(new Uint8Array())).toBeUndefined()
    expect(imageSize(png(1, 1).slice(0, 20))).toBeUndefined()
    expect(imageSize(gif(1, 1).slice(0, 8))).toBeUndefined()
    expect(imageSize(webpVP8X(1, 1).slice(0, 25))).toBeUndefined()
    expect(imageSize(new TextEncoder().encode('{"json": true} padding padding padding'))).toBeUndefined()
    const odd = webpVP8X(1, 1)
    odd.set([...'ABCD'].map((c) => c.charCodeAt(0)), 12)
    expect(imageSize(odd)).toBeUndefined()
  })
})

describe('fetchImageSize', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A response whose body yields the given chunks; `cancel` records whether it was stopped early. */
  function stream(chunks: Uint8Array[], extra = 0) {
    const state = { pulled: 0, cancelled: false }
    const all = [...chunks, ...Array.from({ length: extra }, () => new Uint8Array(1000))]
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = all[state.pulled++]
        if (next) c.enqueue(next)
        else c.close()
      },
      cancel() {
        state.cancelled = true
      },
    })
    return { res: new Response(body, { status: 206 }), state }
  }

  it('sends a Range header and reads the header across chunks', async () => {
    const bytes = png(33, 44)
    const { res } = stream([bytes.slice(0, 10), bytes.slice(10, 30), bytes.slice(30)])
    const fetch = vi.fn(async () => res)
    vi.stubGlobal('fetch', fetch)
    const ctrl = new AbortController()
    expect(await fetchImageSize('https://x/file/abc', ctrl.signal)).toEqual([33, 44])
    expect(fetch).toHaveBeenCalledWith('https://x/file/abc', { headers: { Range: 'bytes=0-47' }, signal: ctrl.signal })
  })

  it('stops reading after the first 48 bytes when the server ignores Range', async () => {
    const { res, state } = stream([webpVP8X(5, 6)], 50)
    vi.stubGlobal('fetch', async () => res)
    expect(await fetchImageSize('u')).toEqual([5, 6])
    expect(state.pulled).toBeLessThan(5)
    expect(state.cancelled).toBe(true)
  })

  it('handles a body shorter than the header and failed responses', async () => {
    vi.stubGlobal('fetch', async () => stream([new Uint8Array([1, 2, 3])]).res)
    expect(await fetchImageSize('u')).toBeUndefined()
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    expect(await fetchImageSize('u')).toBeUndefined()
  })
})
