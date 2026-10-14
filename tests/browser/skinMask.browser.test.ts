// Skin masks (Essential) on a real canvas: black mask pixels hide the skin's pixels; masks combine.
import type { MeshLambertMaterial, Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { parseBobj } from '../../src/three/bobj'
import { createPlayer } from '../../src/three/player'
import { playerBobj } from '../fixtures/player'

async function bitmap(draw: (g: OffscreenCanvasRenderingContext2D) => void, w = 64, h = 64) {
  const c = new OffscreenCanvas(w, h)
  draw(c.getContext('2d')!)
  return createImageBitmap(c)
}
/** Alpha of the player's current skin texture at (x, y). */
function alphaAt(tex: Texture, x: number, y: number) {
  const img = tex.image as ImageBitmap
  const c = new OffscreenCanvas(img.width, img.height)
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  return g.getImageData(x, y, 1, 1).data[3]
}

describe('Player.maskSkin', () => {
  it('hides skin pixels that are black in any mask and restores them without masks', async () => {
    const skin = await bitmap((g) => ((g.fillStyle = '#c84'), g.fillRect(0, 0, 64, 64)))
    const p = createPlayer(parseBobj(playerBobj()), skin)
    const mat = () => (p.object.children[0] as unknown as { material: MeshLambertMaterial }).material
    // mask 1: white everywhere, black over the torso's outer layer (16..40, 32..48)
    const m1 = await bitmap((g) => {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 64, 64)
      g.fillStyle = '#000'
      g.fillRect(16, 32, 24, 16)
    })
    // mask 2: black over one arm pixel
    const m2 = await bitmap((g) => {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 64, 64)
      g.fillStyle = '#000'
      g.fillRect(44, 20, 1, 1)
    })
    await p.maskSkin([m1, m2])
    const tex = mat().map!
    expect(alphaAt(tex, 20, 40)).toBe(0)
    expect(alphaAt(tex, 44, 20)).toBe(0)
    expect(alphaAt(tex, 8, 8)).toBe(255)
    await p.maskSkin([])
    expect(alphaAt(mat().map!, 20, 40)).toBe(255)
    p.dispose()
  })

  it('a legacy 64x32 skin takes the top half of a mask', async () => {
    const skin = await bitmap((g) => ((g.fillStyle = '#c84'), g.fillRect(0, 0, 64, 32)), 64, 32)
    const p = createPlayer(parseBobj(playerBobj()), skin)
    const mask = await bitmap((g) => {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 64, 64)
      g.fillStyle = '#000'
      g.fillRect(0, 0, 8, 8)
    })
    await p.maskSkin([mask])
    const tex = (p.object.children[0] as unknown as { material: MeshLambertMaterial }).material.map!
    expect([alphaAt(tex, 2, 2), alphaAt(tex, 20, 20)]).toEqual([0, 255])
    p.dispose()
  })
})
