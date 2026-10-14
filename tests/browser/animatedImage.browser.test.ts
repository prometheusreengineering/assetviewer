// WebCodecs ImageDecoder in Chromium: animated images become a grid atlas with per-frame timing.
import { describe, expect, it } from 'vitest'
import { decodeFrames } from '../../src/three/animatedImage'
import { animatedGif } from '../fixtures/images'

function pixels(bitmap: ImageBitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height)
  const g = c.getContext('2d')!
  g.drawImage(bitmap, 0, 0)
  return (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]
}

describe('decodeFrames', () => {
  const RED: [number, number, number] = [255, 0, 0]
  const GREEN: [number, number, number] = [0, 255, 0]
  const BLUE: [number, number, number] = [0, 0, 255]

  it('packs every frame of an animated GIF in order with its durations', async () => {
    const buf = animatedGif(4, 2, [RED, GREEN, BLUE], [10, 20, 30]).buffer as ArrayBuffer
    const d = await decodeFrames(buf, 'image/gif')
    expect(d.sourceFrames).toBe(3)
    expect(d.layout).toEqual({ cols: 3, rows: 1, count: 3, ends: [100, 300, 600] })
    expect([d.bitmap.width, d.bitmap.height]).toEqual([12, 2])
    const at = pixels(d.bitmap)
    expect(at(1, 1)).toEqual(RED)
    expect(at(5, 1)).toEqual(GREEN)
    expect(at(9, 1)).toEqual(BLUE)
  })

  it('samples frames into a small atlas', async () => {
    const buf = animatedGif(4, 4, [RED, GREEN, BLUE], [10, 10, 10]).buffer as ArrayBuffer
    const d = await decodeFrames(buf, 'image/gif', 8)
    expect(d.layout.count).toBe(3)
    expect([d.layout.cols, d.layout.rows]).toEqual([2, 2])
    // row by row: the third frame starts the second row
    expect(pixels(d.bitmap)(1, 5)).toEqual(BLUE)
    expect(pixels(d.bitmap)(5, 1)).toEqual(GREEN)
  })

  it('a still image (or an undecodable one) is a single frame', async () => {
    const c = new OffscreenCanvas(3, 3)
    c.getContext('2d')!.fillRect(0, 0, 3, 3)
    const png = await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()
    const d = await decodeFrames(png, 'image/png')
    expect(d.layout.count).toBe(1)
    expect(d.bitmap.width).toBe(3)
    await expect(decodeFrames(new ArrayBuffer(8), 'image/webp')).rejects.toThrow()
  })
})
