import { Mesh, type Object3D } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dawnProvider as dp, EVERYTHING, normalizeAnims } from '../../src/providers/dawn'
import { FLAT_SHIELD } from '../../src/providers/dawn/catalog'
import { visibleBox } from '../../src/three/fit'
import { DAWN_FILES, G, HAT_ANIM } from '../fixtures/dawn'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installDawnCdn, type FakeCdn } from '../helpers/cdnMock'

let cdn: FakeCdn
const item = (id: string) => dp.itemById!(id)!
const meshes = (o: Object3D) => {
  const out: Mesh[] = []
  o.traverse((x) => x instanceof Mesh && out.push(x))
  return out
}

beforeAll(async () => {
  cdn = installDawnCdn(DAWN_FILES)
  installBitmapStubs()
  await dp.load()
})
afterAll(() => vi.unstubAllGlobals())

describe('catalog in the UI', () => {
  it('categories: Everything, cosmetics in sidebar order, then resources', () => {
    const cats = dp.categories()
    expect(cats.map((c) => c.id)).toEqual(['everything', 'hats', 'wings', 'auras', 'cloaks', 'shields', 'boots', 'trim', 'models', 'lang'])
    expect(cats.find((c) => c.id === 'hats')).toMatchObject({ label: 'Hats', count: 3, group: 'Cosmetics (3D)' })
    expect(cats.find((c) => c.id === 'lang')).toMatchObject({ label: 'Language files', group: 'Resources' })
    expect(cats[0]!.count).toBe(dp.items(EVERYTHING).length)
  })

  it('enriches fields for filtering', () => {
    expect(item('hats/testHat').fields).toMatchObject({ category: 'Hats', collection: 'Test', kind: 'Model', type: '3D', ext: 'webp', hasAnimation: true, model: true })
    expect(item('hats/testHatBlue').fields).toMatchObject({ kind: 'Colour variant', variantOf: 'Test Hat', hasAnimation: true })
    expect(item('boots/lonelyBoots').fields).toMatchObject({ type: '2D', model: false })
    // `animated` would make the UI read stacked-frame layouts; Dawn images animate natively
    expect(item('cloaks/testCape').fields.animated).toBeUndefined()
  })

  it('fields only offer what the category has', () => {
    const keys = (c: string) => dp.fields(c).map((f) => f.key)
    expect(keys('hats')).toEqual(expect.arrayContaining(['name', 'category', 'collection', 'kind', 'width', 'height', 'variantOf', 'hasAnimation']))
    expect(keys('lang')).not.toContain('width')
    expect(dp.fields('hats').find((f) => f.key === 'kind')!.options).toEqual(['Colour variant', 'Model'])
  })

  it('info rows', () => {
    expect(dp.info!(item('hats/testHatBlue'))).toMatchObject({ Type: '3D model', Category: 'Hats', Collection: 'Test', 'Variant of': 'Test Hat', 'Animated model': 'Yes', Path: `${G}hats/testHatBlue.webp` })
  })

  it('stats, indexed files and their owners', () => {
    expect(dp.stats!()).toMatchObject({ items: dp.items(EVERYTHING).length, files: DAWN_FILES.length })
    expect(dp.stats!().indexes[0]).toMatch(/^[0-9a-f]{40}$/)
    const files = dp.indexedFiles!()
    expect(files.find((f) => f.path === `${G}pets/strayAura.webp`)!.name).toBe('Stray Aura')
    expect(dp.fileItem!(`${G}hats/testHat.meta.json`).id).toBe('hats/testHat')
    expect(dp.fileItem!('nowhere/x.bin')).toMatchObject({ render: 'file', category: 'other' })
  })
})

describe('normalizeAnims', () => {
  it('names states by the last part of the GeckoLib key and drops the empty null animation', () => {
    expect(Object.keys(normalizeAnims(HAT_ANIM as never).animations)).toEqual(['idle'])
  })
})

describe('models', () => {
  it('a model with its own animation states, fitted for the plain view and mirrored back', async () => {
    const m = await dp.loadModel(item('hats/testHat'))
    expect(m.states).toEqual(['idle'])
    expect(m.state).toBe('idle')
    expect(meshes(m.object).length).toBe(2)
    const box = visibleBox(m.object)
    expect(Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)).toBeCloseTo(1.6, 1)
    // the geometry root is mirrored on x (Bedrock is x-mirrored); in player space on z instead
    const mirrored = (o: Object3D, axis: 'x' | 'z') => {
      let n = 0
      o.traverse((x) => void (x.scale[axis] < 0 && n++))
      return n
    }
    expect([mirrored(m.object, 'x'), mirrored(m.object, 'z')]).toEqual([1, 0])
    const raw = await dp.loadModel(item('hats/testHat'), { raw: true })
    expect([mirrored(raw.object, 'x'), mirrored(raw.object, 'z')]).toEqual([0, 1])
    m.tick(1000)
    m.dispose()
  })

  it('downloads carry the model, texture, animation and meta', async () => {
    const m = await dp.loadModel(item('hats/testHat'))
    expect(m.files.map((f) => f.name).sort()).toEqual(['testHat.animation.json', 'testHat.geo.json', 'testHat.meta.json', 'testHat.webp'])
  })

  it('a variant draws its own texture on the borrowed model', async () => {
    cdn.requests.length = 0
    const m = await dp.loadModel(item('hats/testHatBlue'))
    expect(meshes(m.object).length).toBe(2)
    expect(cdn.requests.some((u) => u.includes('hats/testHatBlue.webp'))).toBe(true)
    expect(cdn.requests.some((u) => u.includes('hats/testHat.geo.json'))).toBe(true)
    expect((await dp.sourceFiles!(item('hats/testHatBlue'))).map((f) => f.name).sort()).toEqual(['testHat.animation.json', 'testHat.geo.json', 'testHat.meta.json', 'testHatBlue.webp'])
  })

  it('wings have several states', async () => {
    const m = await dp.loadModel(item('wings/testWings'))
    expect(m.states).toEqual(['idle', 'fly'])
    m.setState('fly')
    expect(m.state).toBe('fly')
  })

  it('an armor trim draws each slot piece with its own texture', async () => {
    const m = await dp.loadModel(item('trim/glowTrim'))
    expect(meshes(m.object).length).toBe(3)
    const maps = new Set(meshes(m.object).map((x) => (x.material as { map: unknown }).map))
    expect(maps.size).toBe(2)
    expect(m.files.map((f) => f.name).sort()).toEqual(['chest.geo.json', 'glowTrim_chest.webp', 'glowTrim_head.webp', 'head.geo.json'])
  })

  it('cloaks on the OptiFine cape box, flat shields on the shared model', async () => {
    const cape = await dp.loadModel(item('cloaks/testCape'))
    expect(meshes(cape.object).length).toBe(1)
    expect(cape.files.map((f) => f.name)).toEqual(['testCape.avif'])
    const shield = await dp.loadModel(item('shields/testShield'))
    expect(meshes(shield.object).length).toBe(1)
    expect(shield.files.map((f) => f.name).sort()).toEqual([FLAT_SHIELD.split('/').pop(), 'testShield.avif'].sort())
  })

  it('images have no model; their url is a blob of the cached bytes', async () => {
    await expect(dp.loadModel(item('boots/lonelyBoots'))).rejects.toThrow('no 3D model')
    const url = await dp.imageUrl(item('boots/lonelyBoots'))
    expect(url).toMatch(/^blob:/)
    expect(await dp.imageUrl(item('boots/lonelyBoots'))).toBe(url)
  })

  it('raw files show their text', async () => {
    const r = await dp.rawFile!(item('game/lang/en_us.json'))
    expect(r).toMatchObject({ name: 'en_us.json', size: r.text!.length })
    expect(JSON.parse(r.text!)).toEqual({ 'feather.modulename.cosmetic': 'Cosmetics' })
    expect(r.url).toMatch(/^blob:/)
  })

  it('estimates sizes from fetched files, else typical sizes', () => {
    expect(dp.estimateSize!(item('hats/testHat'))).toBeGreaterThan(0)
    expect(dp.estimateSize!(item('cloaks/plainCloak'))).toBe(20_000)
  })
})

describe('dimensions', () => {
  it('reads WebP and AVIF headers with Range requests', async () => {
    const items = [item('cloaks/testCape'), item('cloaks/plainCloak'), item('game/lang/en_us.json')]
    const progress: number[] = []
    await dp.ensureDimensions!(items, (d) => progress.push(d), new AbortController().signal)
    expect(item('cloaks/testCape').fields).toMatchObject({ width: 352, height: 272 })
    expect(item('cloaks/plainCloak').fields).toMatchObject({ width: 22, height: 17 })
    expect(item('game/lang/en_us.json').fields.width).toBeUndefined()
    expect(progress.at(-1)).toBe(2)
  })
})
