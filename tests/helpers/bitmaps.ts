import { vi } from 'vitest'
import { imageSize } from '../../src/dimensions'
import { png } from '../fixtures/images'

/** A stand-in ImageBitmap (Node has none). */
export const fakeBitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap

/**
 * `createImageBitmap` reads the size from the image header, `OffscreenCanvas` records its 2D calls and
 * converts to a 1x1 PNG. Enough for the model loaders and the skin code to run without a browser.
 */
export function installBitmapStubs() {
  const created: { source: unknown; options?: ImageBitmapOptions }[] = []
  vi.stubGlobal('createImageBitmap', async (source: Blob | { width: number; height: number }, options?: ImageBitmapOptions) => {
    created.push({ source, options })
    if (source instanceof Blob) {
      const size = imageSize(new Uint8Array(await source.arrayBuffer()))
      if (!size) throw new Error('InvalidStateError: undecodable image')
      return fakeBitmap(...size)
    }
    return fakeBitmap(source.width, source.height)
  })
  const ctx = () => {
    const calls: [string, ...unknown[]][] = []
    const rec = (name: string) => (...a: unknown[]) => void calls.push([name, ...a])
    return { calls, fillStyle: '', fillRect: rec('fillRect'), drawImage: rec('drawImage') }
  }
  class FakeOffscreenCanvas {
    width: number
    height: number
    ctx = ctx()
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    getContext() {
      return this.ctx
    }
    async convertToBlob() {
      return new Blob([png(this.width, this.height).slice().buffer as ArrayBuffer], { type: 'image/png' })
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  return { created, FakeOffscreenCanvas }
}
