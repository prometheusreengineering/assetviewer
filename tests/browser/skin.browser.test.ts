// Slim (Alex) skin detection on real canvases.
import { describe, expect, it } from 'vitest'
import { isSlimSkin } from '../../src/skin'

async function skin(slim: boolean, w = 64, h = 64) {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.fillStyle = '#c84'
  g.fillRect(0, 0, w, h)
  // a slim skin leaves the 4th column of the right arm empty
  if (slim) g.clearRect(54, 20, 2, 12)
  return createImageBitmap(c)
}

describe('isSlimSkin', () => {
  it('slim when the unused right-arm column is transparent', async () => {
    expect(isSlimSkin(await skin(true))).toBe(true)
    expect(isSlimSkin(await skin(false))).toBe(false)
  })
  it('legacy 64x32 skins are always wide', async () => {
    expect(isSlimSkin(await skin(true, 64, 32))).toBe(false)
  })
})
