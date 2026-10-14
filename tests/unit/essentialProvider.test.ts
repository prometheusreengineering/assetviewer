import { Mesh, type Object3D, type Texture } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, essentialProvider as ep, essentialState, forget } from '../../src/providers/essential'
import { memorySource } from '../../src/providers/essential/localData'
import { essentialFixture } from '../fixtures/essential'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installCdn } from '../helpers/cdnMock'
import { LUNAR_FULL } from '../fixtures/lunar'

const fx = essentialFixture()
const item = (id: string) => ep.itemById!(id)!
const meshes = (o: Object3D) => {
  const out: Mesh[] = []
  o.traverse((x) => x instanceof Mesh && out.push(x))
  return out
}
const fetchMock = vi.fn(async (url: string) => {
  const b = fx.remote.get(String(url))
  return b ? new Response(b.slice().buffer as ArrayBuffer) : new Response('', { status: 404 })
})

beforeAll(async () => {
  installBitmapStubs()
  // Lunar's fixture CDN serves the player body for dressing; the rest goes to the Essential "CDN"
  const lunar = installCdn(LUNAR_FULL)
  fetchMock.mockImplementation(async (url: string) => {
    const b = fx.remote.get(String(url))
    if (b) return new Response(b.slice().buffer as ArrayBuffer)
    return (lunar.fetch as unknown as typeof fetch)(url)
  })
  vi.stubGlobal('caches', undefined)
  vi.stubGlobal('fetch', fetchMock)
  await connect({ dumps: memorySource(fx.dumps), cache: memorySource(fx.cache) })
})
afterAll(() => vi.unstubAllGlobals())

describe('connected catalog', () => {
  it('state, categories (emotes are not outfit slots) and stats', () => {
    expect(essentialState.value).toMatchObject({ connected: true, items: 5 })
    expect(ep.setup!.needed()).toBe(false)
    expect(ep.categories().map((c) => [c.id, c.count, c.group])).toEqual([
      ['everything', 5, ''],
      ['hat', 1, 'Cosmetics (3D)'],
      ['top', 1, 'Cosmetics (3D)'],
      ['arms', 1, 'Cosmetics (3D)'],
      ['wings', 1, 'Cosmetics (3D)'],
      ['emote', 1, 'Emotes & effects'],
      ['outfit', 4, 'Tools'],
    ])
    expect(ep.stats!()).toEqual({ items: 5, files: 19, indexes: [] })
  })

  it('fields and info', () => {
    const keys = ep.fields('everything').map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['name', 'category', 'rarity', 'price', 'themes', 'collections', 'variants', 'slots', 'hasAnimation']))
    expect(ep.fields('everything').find((f) => f.key === 'rarity')!.options).toEqual(['Rare', 'Epic'])
    expect(ep.info!(item('TEST_HAT'))).toMatchObject({ Rarity: 'Rare', Price: '600 coins', Themes: 'Spring', Collections: 'January 2026', Variants: 'blue, red', ID: 'TEST_HAT' })
  })

  it('connecting a folder without dumps fails clearly', async () => {
    await expect(connect({})).rejects.toThrow(/No Essential dumps/)
    await expect(connect({ dumps: memorySource({}) })).rejects.toThrow(/no cosmetics/)
    // the previous connection is kept
    expect(ep.items('everything')).toHaveLength(5)
  })
})

describe('models', () => {
  it('a model with variants in settings order and the IDLE-trigger animation', async () => {
    const m = await ep.loadModel(item('TEST_HAT'))
    expect(meshes(m.object)).toHaveLength(2)
    expect(m.variants).toEqual(['blue', 'red'])
    expect(m.variant).toBe('blue')
    expect(m.states.sort()).toEqual(['spin', 'wobble'])
    expect(m.state).toBe('spin')
    m.setState('wobble')
    expect(m.state).toBe('wobble')
    expect(m.files.map((f) => f.name).sort()).toEqual(['animations.json', 'geometry.steve.json', 'settings.json', 'variants_blue_texture.png'])
  })

  it('setVariant swaps the texture image in place', async () => {
    const m = await ep.loadModel(item('TEST_HAT'))
    const tex = (meshes(m.object)[0]!.material as unknown as { map: Texture }).map
    const before = tex.image
    await m.setVariant!('red')
    expect(m.variant).toBe('red')
    expect(tex.image).not.toBe(before)
    await m.setVariant!('nope')
    expect(m.variant).toBe('red')
  })

  it('a texture missing from the cache comes from the URL in the dump', async () => {
    fetchMock.mockClear()
    const m = await ep.loadModel(item('TEST_TOP'))
    expect(meshes(m.object)).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledWith(`https://cdn.example/assets/${fx.hashes.TEST_TOP!['texture.png']}`)
    expect(m.variants).toBeUndefined()
  })

  it('stacked texture frames play at 7 fps; the glow layer follows the frame', async () => {
    const m = await ep.loadModel(item('TEST_WINGS'))
    expect(m.frames).toBe(4)
    const glows: Mesh[] = []
    m.object.traverse((o) => void (o instanceof Mesh && o.userData.glow && glows.push(o)))
    // one glow child per cube
    expect(glows).toHaveLength(2)
    const base = (meshes(m.object).find((x) => !x.userData.glow)!.material as unknown as { map: Texture }).map
    const glow = (glows[0]!.material as unknown as { map: Texture }).map
    m.tick(1000 / 7 + 1)
    expect(base.offset.y).toBeCloseTo(0.25)
    expect(glow.offset.y).toBeCloseTo(0.25)
    expect(glow.repeat.y).toBeCloseTo(0.25)
    m.dispose()
  })

  it('raw models carry their skin mask for dressing', async () => {
    const m = await ep.loadModel(item('TEST_WINGS'), { raw: true })
    expect((m.object.userData.skinMask as ImageBitmap).width).toBe(64)
    expect((await ep.loadModel(item('TEST_WINGS'))).object.userData.skinMask).toBeUndefined()
  })

  it('one-sided cosmetics show the default side (right) and switch sides', async () => {
    const m = await ep.loadModel(item('TEST_BRACELET'))
    expect(m.sides).toEqual(['left', 'right'])
    expect(m.side).toBe('right')
    const shown = () => {
      const out: string[] = []
      m.object.traverse((o) => void (/^side_/.test(o.name) && o.visible && out.push(o.name)))
      return out
    }
    expect(shown()).toEqual(['side_right'])
    m.setSide!('left')
    expect([m.side, shown()]).toEqual(['left', ['side_left']])
    // raw: the side's own skin mask
    const raw = await ep.loadModel(item('TEST_BRACELET'), { raw: true })
    expect((raw.object.userData.skinMask as ImageBitmap).width).toBe(64)
  })

  it('a slim player wears the slim-arm geometry; other views keep the wide one', async () => {
    const armWidth = async (opts: { raw?: boolean; slim?: boolean }) => {
      const m = await ep.loadModel(item('TEST_TOP'), opts)
      let w = 0
      m.object.traverse((o) => {
        if (o.name !== 'arm_right') return
        o.traverse((x) => {
          if (x instanceof Mesh) {
            x.geometry.computeBoundingBox()
            w = Math.round(x.geometry.boundingBox!.max.x - x.geometry.boundingBox!.min.x)
          }
        })
      })
      return w
    }
    expect(await armWidth({ raw: true, slim: true })).toBe(3)
    expect(await armWidth({ raw: true })).toBe(4)
    expect(await armWidth({ slim: true })).toBe(4)
  })

  it('player space keeps blocks and mirrors on z', async () => {
    const m = await ep.loadModel(item('TEST_WINGS'), { raw: true })
    let mirrored = 0
    m.object.traverse((o) => void (o.scale.z < 0 && mirrored++))
    expect(mirrored).toBe(1)
  })

  it('emotes are name tiles without a model', async () => {
    expect(item('TEST_DANCE').thumb).toBe('none')
    await expect(ep.loadModel(item('TEST_DANCE'))).rejects.toThrow(/no 3D model/)
  })

  it('source files: everything the dump lists', async () => {
    const files = await ep.sourceFiles!(item('TEST_HAT'))
    expect(files.map((f) => f.name).sort()).toEqual(['animations.json', 'geometry.steve.json', 'settings.json', 'variants_blue_texture.png', 'variants_red_texture.png'])
    expect(ep.estimateSize!(item('TEST_HAT'))).toBeGreaterThan(0)
  })
})

describe('dressPlayer', () => {
  it('settings rules hide bones of cosmetics worn together', async () => {
    const m = await ep.dressPlayer!([item('TEST_BRACELET'), item('TEST_TOP'), item('TEST_WINGS')])
    const visible = (name: string) => {
      const out: boolean[] = []
      m.object.traverse((o) => void (o.name === name && out.push(o.visible)))
      return out
    }
    // the bracelet's arms hide under the top (COSMETIC_BONE_HIDING); it hides the wings' left wing (EXTERNAL_HIDDEN_BONE)
    expect(visible('wing_left')).toEqual([false])
    expect(visible('wing_right')).toEqual([true])
    expect(visible('side_right')).toEqual([true])
    m.dispose()
    const alone = await ep.dressPlayer!([item('TEST_BRACELET'), item('TEST_WINGS')])
    let leftWing = true
    alone.object.traverse((o) => void (o.name === 'wing_left' && (leftWing = o.visible)))
    expect(leftWing).toBe(false)
    alone.dispose()
  })

  it("socket Essential parts under root to the player's bones; emotes aren't worn", async () => {
    const m = await ep.dressPlayer!([item('TEST_HAT'), item('TEST_TOP'), item('TEST_WINGS'), item('TEST_DANCE')])
    m.object.updateMatrixWorld(true)
    const parentBone = (name: string) => {
      const out: (string | undefined)[] = []
      m.object.traverse((o) => void (o.name === name && out.push(o.parent?.parent?.name)))
      return out
    }
    expect(parentBone('head')).toContain('head')
    expect(parentBone('arm_right')).toEqual(['right_arm'])
    expect(parentBone('arm_left')).toEqual(['left_arm'])
    // the top's body and the wings' body both follow the torso
    expect(parentBone('body').filter((b) => b === 'low_body')).toHaveLength(2)
    m.tick(400)
    m.dispose()
  })
})

describe('forget', () => {
  it('drops the connection', async () => {
    await forget()
    expect(ep.setup!.needed()).toBe(true)
    expect(ep.items('everything')).toEqual([])
    expect(essentialState.value.connected).toBe(false)
  })
})
