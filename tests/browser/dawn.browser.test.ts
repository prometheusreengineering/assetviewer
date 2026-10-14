// Live Dawn CDN in a real browser, through the Vite dev proxy (/dawn/): animated textures and one model per kind.
import { Mesh, type Object3D } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { dawnProvider as dp } from '../../src/providers/dawn'

const drawn = (o: Object3D) => {
  o.updateMatrixWorld(true)
  let n = 0
  o.traverseVisible((x) => x instanceof Mesh && Math.abs(x.matrixWorld.determinant()) > 1e-12 && n++)
  return n
}

beforeAll(async () => {
  await dp.load()
})

describe('Dawn provider in the browser', () => {
  const byId = (id: string) => dp.itemById!(id)!

  it.each([
    ['an animated hat', 'hats/4thJulyHat'],
    ['wings with states', 'wings/angelWings'],
    ['a colour variant', 'wings/springFireWyvernWings'],
    ['an animated AVIF cloak', 'cloaks/amethyst'],
    ['a flat AVIF shield', 'shields/miamiShield'],
    ['an armor trim (3000-frame textures)', 'trim/blazeTrim'],
    ['a pet', 'pets/angelPet'],
  ])('loads %s', async (_, id) => {
    const m = await dp.loadModel(byId(id))
    m.tick(1234)
    expect(drawn(m.object)).toBeGreaterThan(0)
    expect(m.files.length).toBeGreaterThan(0)
    m.dispose()
  })

  it('animated textures decode to several frames', async () => {
    for (const id of ['cloaks/amethyst', 'hats/4thJulyHat', 'trim/blazeTrim']) {
      const m = await dp.loadModel(byId(id))
      expect(m.frames, id).toBeGreaterThan(1)
      m.dispose()
    }
  })

  it('image items come as decodable blob: urls; AVIF dimensions are read from the header', async () => {
    const cape = byId('cloaks/amethyst')
    const img = new Image()
    img.src = await dp.imageUrl(cape)
    await img.decode()
    await dp.ensureDimensions!([cape], () => {}, new AbortController().signal)
    expect([cape.fields.width, cape.fields.height]).toEqual([img.naturalWidth, img.naturalHeight])
    expect(cape.fields.width).toBe(352)
  })
})
