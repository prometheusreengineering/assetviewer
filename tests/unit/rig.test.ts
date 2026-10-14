import { Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { atlasLayout } from '../../src/three/animatedImage'
import { frameAt, showFrame, singleFrame, stackedFrames } from '../../src/three/rig'

describe('frame timing', () => {
  it('stacked frames advance every frameMs and loop', () => {
    const l = stackedFrames(4, 100)
    expect([0, 99, 100, 250, 399, 400, 950].map((t) => frameAt(l, t))).toEqual([0, 0, 1, 2, 3, 0, 1])
  })
  it('variable durations', () => {
    const l = { cols: 2, rows: 2, count: 3, ends: [50, 250, 300] }
    expect([0, 49, 50, 249, 250, 299, 300, 349].map((t) => frameAt(l, t))).toEqual([0, 0, 1, 1, 2, 2, 0, 0])
  })
  it('a single frame never moves', () => {
    expect(frameAt(singleFrame(), 12345)).toBe(0)
  })
})

describe('showFrame', () => {
  it('walks a grid row by row from the top', () => {
    const tex = new Texture()
    const l = { cols: 3, rows: 2, count: 5, ends: [1, 2, 3, 4, 5] }
    showFrame(tex, l, 4)
    expect([tex.offset.x, tex.offset.y]).toEqual([1 / 3, 1 / 2])
    showFrame(tex, l, 2)
    expect([tex.offset.x, tex.offset.y]).toEqual([2 / 3, 0])
  })
  it('flipY textures count rows from the other end', () => {
    const tex = new Texture()
    const l = stackedFrames(4, 1)
    showFrame(tex, l, 0, true)
    expect(tex.offset.y).toBe(0.75)
    showFrame(tex, l, 3, true)
    expect(tex.offset.y).toBe(0)
  })
})

describe('atlasLayout', () => {
  it('keeps every frame when they fit', () => {
    const p = atlasLayout(64, 64, 6)
    expect(p).toMatchObject({ cols: 6, rows: 1, cellW: 64, cellH: 64 })
    expect(p.picks).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('halves big frames until enough fit (a 60-frame cloak)', () => {
    const p = atlasLayout(352, 272, 60)
    expect([p.cellW, p.cellH]).toEqual([176, 136])
    expect(p.picks.length).toBe(35)
    expect(p.cols * p.cellW).toBeLessThanOrEqual(1024)
    expect(p.rows * p.cellH).toBeLessThanOrEqual(1024)
    expect(p.picks[0]).toBe(0)
    expect(new Set(p.picks).size).toBe(35)
  })
  it('samples thousands of small frames evenly at full size', () => {
    const p = atlasLayout(64, 32, 3000)
    expect([p.cellW, p.cellH]).toEqual([64, 32])
    expect(p.picks.length).toBe(16 * 32)
    expect(p.picks.at(-1)).toBeLessThan(3000)
    expect(p.picks[1]! - p.picks[0]!).toBe(5)
  })
  it('few frames of a huge image are scaled to fit', () => {
    const p = atlasLayout(4000, 2000, 2)
    expect(p.cols * p.cellW).toBeLessThanOrEqual(1024)
    expect(p.picks).toEqual([0, 1])
  })
})
