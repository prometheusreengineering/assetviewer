import { unzipSync } from 'fflate'
import { Mesh, SkinnedMesh, Vector3, type Object3D } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PREFIX } from '../../src/providers/lunar/catalog'
import { ALL_FILES, CAPE_GEO, CAPE_ON_PLAYER, COSMETIC_LABELS, dragonWingGeo, EVERYTHING, lunarProvider as lp, measurable, OUTFIT, ownerOf, RESOURCE_LABELS, zipFiles } from '../../src/providers/lunar'
import { visibleBox } from '../../src/three/fit'
import type { CosmeticItem } from '../../src/providers/types'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installCdn, type FakeCdn } from '../helpers/cdnMock'
import { CROWN_GEK, LUNAR_FILES, LUNAR_FULL } from '../fixtures/lunar'

let cdn: FakeCdn
const item = (id: string) => lp.itemById!(id)!
const meshes = (o: Object3D) => {
  const out: Mesh[] = []
  o.traverse((x) => x instanceof Mesh && out.push(x))
  return out
}

beforeAll(async () => {
  cdn = installCdn(LUNAR_FULL)
  installBitmapStubs()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await lp.load()
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('load', () => {
  it('loads once', async () => {
    const n = cdn.requests.length
    await lp.load()
    await lp.load()
    expect(cdn.requests.length).toBe(n)
  })
  it('stats', () => {
    const s = lp.stats!()
    expect(s.files).toBe(LUNAR_FILES.length)
    expect(s.items).toBe(lp.items(EVERYTHING).length)
    expect(s.indexes).toHaveLength(2)
  })
})

describe('enrich', () => {
  it('adds id, path, folder, ext, size, type and model fields', () => {
    const crown = item('1')
    expect(crown.fields).toMatchObject({
      category: 'Hats',
      id: 1,
      path: 'cosmetics/models/gek/hats/crown/crown.gek.json',
      folder: 'cosmetics/models/gek/hats/crown',
      ext: 'json',
      type: '3D',
      model: true,
    })
    expect(crown.fields.size).toBe(JSON.stringify(CROWN_GEK).length)
    expect(item('5').fields).toMatchObject({ type: '2D', model: false, ext: 'webp' })
    expect(item('res:cosmetics.json').fields).toMatchObject({ type: 'File', model: false, category: 'Data & shaders' })
  })
  it('non-numeric ids get no id field; unknown categories keep their id as label', () => {
    expect(item('unlisted:cosmetics/models/gek/pets/dog/dog.gek.json').fields.id).toBeUndefined()
    expect(item('unlisted:cosmetics/models/gek/weird/thing/thing.gek.json').fields.category).toBe('weird')
  })
  it('emotes only get a type (their files are shared)', () => {
    const f = item('emote:1').fields
    expect(f.type).toBe('3D')
    expect(f.category).toBe('Emotes')
    expect(f.path).toBeUndefined()
    expect(f.size).toBeUndefined()
  })
})

describe('categories', () => {
  const cats = () => lp.categories()
  it('starts with Everything and the outfit builder', () => {
    const [all, outfit] = cats()
    expect(all).toMatchObject({ id: EVERYTHING, label: 'Everything', group: '', count: lp.items(EVERYTHING).length })
    expect(outfit).toMatchObject({ id: OUTFIT, label: 'Outfit builder', group: 'Tools', count: 4 })
  })
  it('orders cosmetics by the label table, unknown ones last, then visible resource categories', () => {
    const c = cats()
    const cosmetic = c.filter((x) => x.group === 'Cosmetics (3D)').map((x) => x.id)
    expect(cosmetic).toEqual(['hat', 'mask', 'bandanna', 'dragon_wings', 'cloak', 'pet', 'bodywear', 'emotes', 'weird'])
    const res = c.filter((x) => x.group === 'Resources (2D)').map((x) => x.id)
    expect(res).toEqual(['badges', 'sprays', 'particle_textures', 'particle_data', 'icons', 'misc', 'data'])
    expect(c.find((x) => x.id === 'weird')).toMatchObject({ label: 'weird', icon: 'pi-box' })
    expect(c.find((x) => x.id === 'hat')).toMatchObject({ label: 'Hats', icon: 'pi-crown', count: 3 })
  })
  it('hides the emote resource categories', () => {
    const ids = cats().map((x) => x.id)
    for (const h of ['emote_icons', 'emote_textures', 'emote_data']) expect(ids).not.toContain(h)
  })
  it('label tables cover every resource category', () => {
    expect(Object.keys(RESOURCE_LABELS)).toHaveLength(10)
    expect(COSMETIC_LABELS.dragon_wings![0]).toBe('Wings')
  })
})

describe('items / fields', () => {
  it('items by category and everything', () => {
    expect(lp.items('cloak').map((i) => i.id)).toEqual(['3', '12', 'unlisted:cosmetics/cloaks/unl.webp'])
    expect(lp.items('nope')).toEqual([])
    expect(lp.items(EVERYTHING).some((i) => i.category === 'emote_icons')).toBe(true)
  })
  it('only lists fields some item in the category has, with sorted options', () => {
    const keys = (c: string) => lp.fields(c).map((f) => f.key)
    expect(keys('hat')).toEqual(['name', 'category', 'id', 'released', 'themes', 'colors', 'type', 'ext', 'folder', 'path', 'size', 'width', 'height', 'animated', 'special', 'model'])
    const themes = lp.fields('hat').find((f) => f.key === 'themes')!
    expect(themes).toMatchObject({ type: 'multi', options: ['CLASSIC', 'FANCY', 'UNLISTED'] })
    expect(lp.fields('hat').find((f) => f.key === 'width')).toMatchObject({ type: 'number', lazy: true })
    expect(keys('emotes')).toEqual(['name', 'category', 'id', 'type', 'duration', 'looping', 'author', 'props', 'morph'])
    expect(lp.fields('emotes').find((f) => f.key === 'author')!.options).toEqual(['Bob'])
  })
  it('no width/height when nothing is measurable (geks only)', () => {
    expect(lp.fields('pet').map((f) => f.key)).not.toContain('width')
  })
  it('measurable: image-backed entries only', () => {
    expect(measurable(undefined)).toBe(false)
    expect(measurable({ kind: 'gek', path: 'a.webp' } as never)).toBe(false)
    expect(measurable({ kind: 'emote', path: 'a.webp' } as never)).toBe(false)
    expect(measurable({ kind: 'cloak', path: 'a.webp' } as never)).toBe(true)
    expect(measurable({ kind: 'image', path: 'a.jpg' } as never)).toBe(false)
    expect(measurable({ kind: 'image', path: 'a.GIF' } as never)).toBe(true)
  })
})

describe('info', () => {
  it('formats the item fields and appends catalog extras', () => {
    const rows = lp.info!(item('1'))
    expect(rows).toEqual({
      Type: '3D model',
      Category: 'Hats',
      ID: '1',
      Released: '2023-05-01',
      Themes: 'FANCY',
      Colors: 'GOLD',
      Animated: 'No',
      Special: 'Yes',
      'File type': 'json',
      'File size': `${JSON.stringify(CROWN_GEK).length} B`,
      Folder: 'cosmetics/models/gek/hats/crown',
      Source: 'cosmetics/models/gek/hats/crown/crown.gek.json',
    })
  })
  it('emotes and resources', () => {
    expect(lp.info!(item('emote:1'))).toMatchObject({ Type: '3D model', Category: 'Emotes', ID: '1', Duration: '2.5 s', Looping: 'Yes', Author: 'Bob', Props: 'hat_prop', Morph: 'sparkle', Action: 'emote_wave_hello' })
    expect(lp.info!(item('res:badges/gold.png'))).toMatchObject({ Type: '2D image', Category: 'Badges', Description: 'Shiny', Path: 'badges/gold.png' })
    expect(lp.info!(item('res:badges/gold.png')).ID).toBeUndefined()
    expect(lp.info!(item('res:cosmetics.json')).Type).toBe('File')
  })
  it('shows dimensions once measured, and nothing for unknown items', () => {
    const it1 = { ...item('5'), fields: { ...item('5').fields, width: 8, height: 4 } }
    expect(lp.info!(it1).Dimensions).toBe('8 × 4 px')
    expect(lp.info!({ id: 'x', name: 'x', category: 'x', fields: {}, render: 'file' })).toEqual({})
  })
})

describe('ownerOf / fileItem / indexedFiles', () => {
  it('maps a file to the item it belongs to', () => {
    const owner = (p: string) => ownerOf(p)?.item.id
    expect(owner('cosmetics/models/gek/hats/crown/crown.gek.json')).toBe('1')
    expect(owner('cosmetics/models/gek/hats/crown/crown.geo.json')).toBe('1')
    expect(owner('cosmetics/models/gek/hats/crown/crown.anim.json')).toBe('1')
    expect(owner('cosmetics/models/gek/hats/crown/textures/crown.webp')).toBe('1')
    expect(owner('cosmetics/cloaks/blue.webp.mcmeta')).toBe('3')
    expect(owner('cosmetics/wings/thumbnail/red.webp')).toBe('2')
    expect(owner('cosmetics/models/gek/hats/crown/textures/glow.webp')).toBeUndefined()
  })
  it('fileItem returns the owner or a cached synthetic file item', () => {
    expect(lp.fileItem!('cosmetics/models/gek/hats/crown/crown.geo.json').id).toBe('1')
    const f = lp.fileItem!('cosmetics/models/gek/hats/crown/textures/glow.webp')
    expect(f).toMatchObject({ id: 'file:cosmetics/models/gek/hats/crown/textures/glow.webp', name: 'Glow (file)', category: ALL_FILES, render: 'image', fields: { ext: 'webp' } })
    expect(lp.fileItem!('cosmetics/models/gek/hats/crown/textures/glow.webp')).toBe(f)
    expect(lp.itemById!(f.id)).toBe(f)
    expect(lp.fileItem!('cosmetics/models/gek/pets/dog/dog_slim.geo.json').render).toBe('file')
  })
  it('indexedFiles lists every file with its owner name', () => {
    const files = lp.indexedFiles!()
    expect(files).toHaveLength(LUNAR_FILES.length)
    const geo = files.find((f) => f.path === 'cosmetics/models/gek/hats/crown/crown.geo.json')!
    expect(geo.name).toBe('Crown')
    expect(geo.hash).toBe(cdn.hashes.get(PREFIX + geo.path))
    expect(files.find((f) => f.path === 'cosmetics/models/gek/hats/crown/textures/glow.webp')!.name).toBe('Glow (file)')
  })
})

describe('sizes and source files', () => {
  it('estimateSize: gek folder sum, emote constant, file size, 0 for unknown', () => {
    const crownDir = LUNAR_FULL.filter(([p]) => p.startsWith(PREFIX + 'cosmetics/models/gek/hats/crown/'))
    const sum = crownDir.reduce((n, [p]) => n + cdn.bodies.get(cdn.hashes.get(p)!)!.length, 0)
    expect(lp.estimateSize!(item('1'))).toBe(sum)
    expect(lp.estimateSize!(item('emote:1'))).toBe(600_000)
    expect(lp.estimateSize!(item('3'))).toBe(cdn.bodies.get(cdn.hashes.get(PREFIX + 'cosmetics/cloaks/blue.webp')!)!.length)
    expect(lp.estimateSize!({ id: 'nope' } as CosmeticItem)).toBe(0)
  })
  it('gek: the gek and every lunar: reference that exists', async () => {
    const names = (await lp.sourceFiles!(item('1'))).map((f) => f.name)
    expect(names).toEqual(['crown.gek.json', 'crown.geo.json', 'crown.webp', 'crown.anim.json', 'glow.webp'])
  })
  it('cloak with its .mcmeta; OBJ with its model; unknown item: nothing', async () => {
    expect((await lp.sourceFiles!(item('3'))).map((f) => f.name)).toEqual(['blue.webp', 'blue.webp.mcmeta'])
    expect((await lp.sourceFiles!(item('4'))).map((f) => f.name)).toEqual(['black.webp', 'tophat.obj'])
    expect(await lp.sourceFiles!({ id: 'nope' } as CosmeticItem)).toEqual([])
  })
  it('emote: body, action block, prop and its texture', async () => {
    const files = await lp.sourceFiles!(item('emote:1'))
    expect(files.map((f) => f.name)).toEqual(['default.bobj', 'wave_hello.bobj', 'hat_prop.bobj', 'prop.webp'])
    const action = new TextDecoder().decode(files[1]!.data)
    expect(action.startsWith('an emote_wave_hello\n')).toBe(true)
    expect(action).not.toContain('emote_dance')
  })
  // A gek's `model` map has the geometry paths as keys.
  it('gek with a model map: includes its geometries', async () => {
    const files = await lp.sourceFiles!(item('unlisted:cosmetics/models/gek/pets/dog/dog.gek.json'))
    expect(files.map((f) => f.name)).toEqual(['dog.gek.json', 'dog.geo.json', 'dog_slim.geo.json'])
  })
  it('zipFiles round-trips', () => {
    const z = zipFiles([
      { name: 'a.txt', data: new TextEncoder().encode('A') },
      { name: 'b.bin', data: new Uint8Array([1, 2, 3]) },
    ])
    const out = unzipSync(z)
    expect(Object.keys(out)).toEqual(['a.txt', 'b.bin'])
    expect([...out['b.bin']!]).toEqual([1, 2, 3])
  })
})

describe('rawFile / imageUrl / imageFrames', () => {
  it('text files under 400 kB come with their text', async () => {
    const f = await lp.rawFile!(item('res:cosmetics/functions.molang'))
    expect(f.name).toBe('functions.molang')
    expect(f.text).toContain('lunar.double')
    expect(f.url).toBe(`https://textures.lunarclientcdn.com/file/${cdn.hashes.get(PREFIX + 'cosmetics/functions.molang')}`)
    expect((await lp.rawFile!(item('res:emotes/models/entity/default.bobj'))).text).toBeUndefined()
  })
  it('imageUrl gives a cached blob: url of the right type', async () => {
    const u = await lp.imageUrl(item('res:badges/gold.png'))
    expect(u).toMatch(/^blob:/)
    expect(await lp.imageUrl(item('res:badges/gold.png'))).toBe(u)
  })
  it('imageFrames reads .mcmeta (frametime in ticks -> ms)', async () => {
    expect(await lp.imageFrames!(item('3'))).toEqual({ frameW: undefined, frameH: undefined, frametimeMs: 100 })
    expect(await lp.imageFrames!(item('unlisted:cosmetics/cloaks/unl.webp'))).toEqual({ frameW: undefined, frameH: undefined, frametimeMs: 50 })
    expect(await lp.imageFrames!(item('5'))).toBeUndefined()
  })
})

describe('ensureDimensions', () => {
  it('measures images with Range requests and reports progress', async () => {
    const items = [item('3'), item('5'), item('1'), item('res:sprays/heart.gif')]
    const progress: [number, number][] = []
    await lp.ensureDimensions!(items, (d, t) => progress.push([d, t]), new AbortController().signal)
    expect(item('3').fields).toMatchObject({ width: 44, height: 68 })
    expect(item('5').fields).toMatchObject({ width: 8, height: 8 })
    expect(item('res:sprays/heart.gif').fields).toMatchObject({ width: 32, height: 32 })
    expect(item('1').fields.width).toBeUndefined()
    expect(progress[0]).toEqual([0, 3])
    expect(progress.at(-1)).toEqual([3, 3])
  })
  it('skips measured items; unreadable headers become 0', async () => {
    const jpg = item('res:misc/y.jpg')
    expect(measurable({ kind: 'image', path: 'misc/y.jpg' } as never)).toBe(false)
    const unl = item('unlisted:cosmetics/cloaks/unl.webp')
    const progress: number[] = []
    await lp.ensureDimensions!([item('3'), unl, jpg], (_, t) => progress.push(t), new AbortController().signal)
    expect(progress[0]).toBe(1)
    expect(unl.fields.width).toBe(22)
  })
  it('stops when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const it1 = item('res:icons/x.png')
    await lp.ensureDimensions!([it1], () => {}, ctrl.signal)
    expect(it1.fields.width).toBeUndefined()
  })
})

describe('loadModel', () => {
  const size = (o: Object3D) => visibleBox(o).getSize(new Vector3())

  it('gek: fitted, animated, with its default state from the state machine', async () => {
    const m = await lp.loadModel(item('1'))
    expect(m.states).toEqual(['gui', 'spin'])
    expect(m.state).toBe('spin')
    expect(Math.max(...size(m.object).toArray())).toBeCloseTo(1.6)
    expect(m.files.map((f) => f.name)).toEqual(['crown.gek.json', 'crown.geo.json', 'crown.webp', 'crown.anim.json'])
    expect(m.frames).toBe(1)
    m.tick(500)
    m.setState('gui')
    expect(m.state).toBe('gui')
    m.setState('nope')
    expect(m.state).toBe('gui')
    m.dispose()
  })

  it('gek in player space: z-mirrored, rotate transformations, attached bone and hidden parts', async () => {
    const m = await lp.loadModel(item('1'), { raw: true })
    const root = m.object
    expect(root.scale.z).toBeCloseTo(-1 / 16)
    expect(root.scale.x).toBeCloseTo(1 / 16)
    // 180 deg about y
    expect(Math.abs(root.quaternion.y)).toBeCloseTo(1)
    expect(root.userData.attachedBone).toBe('HEAD')
    expect(root.userData.hideParts).toEqual(['body'])
  })

  it('gek with a model map and a missing texture: default geometry, grey texture', async () => {
    const m = await lp.loadModel(item('unlisted:cosmetics/models/gek/pets/dog/dog.gek.json'))
    expect(m.states).toEqual([])
    expect(m.files.map((f) => f.name)).toEqual(['dog.gek.json', 'dog.geo.json'])
    expect(meshes(m.object)).toHaveLength(1)
  })

  it('a gek without model/texture is an error', async () => {
    await expect(lp.loadModel(item('unlisted:cosmetics/models/gek/weird/thing/thing.gek.json'))).rejects.toThrow()
  })

  it('dragon wings: the built-in wing model with a flap', async () => {
    const m = await lp.loadModel(item('2'))
    expect(m.states).toEqual(['main'])
    expect(meshes(m.object).length).toBe(8)
    const before = m.object.getObjectByName('right_wing')!.rotation.clone()
    m.tick(300)
    expect(m.object.getObjectByName('right_wing')!.rotation.equals(before)).toBe(false)
  })

  it('cloak: two stacked frames advance with the .mcmeta frame time', async () => {
    const m = await lp.loadModel(item('3'))
    expect(m.frames).toBe(2)
    const tex = (meshes(m.object)[0]!.material as unknown as { map: { offset: { y: number }; repeat: { y: number } } }).map
    expect(tex.repeat.y).toBe(0.5)
    m.tick(0)
    expect(tex.offset.y).toBe(0)
    m.tick(100)
    expect(tex.offset.y).toBe(0.5)
    m.tick(200)
    expect(tex.offset.y).toBe(0)
    const raw = await lp.loadModel(item('3'), { raw: true })
    expect(raw.object.getObjectByName('bipedBody')).toBeDefined()
  })

  it('OBJ: the shared model with the item texture, space detected from its center', async () => {
    const m = await lp.loadModel(item('4'), { raw: true })
    expect(m.object.userData).toMatchObject({ objSpace: 'local', objBody: false, objFolder: 'tophat' })
    expect(m.files.map((f) => f.name)).toEqual(['tophat.obj', 'black.webp'])
    const fitted = await lp.loadModel(item('4'))
    expect(Math.max(...size(fitted.object).toArray())).toBeCloseTo(1.6)
    // the mask is not flipped
    const mask = await lp.loadModel(item('10'), { raw: true })
    expect(mask.object.children[0]!.rotation.z).toBe(0)
    expect(m.object.children[0]!.rotation.z).toBeCloseTo(Math.PI)
  })

  it('emote: a skinned player on a timeline, props appearing at show_at', async () => {
    const m = await lp.loadModel(item('emote:1'))
    expect(m.timeline).toBeDefined()
    expect(m.timeline!.duration).toBe(2.5)
    const skinned: SkinnedMesh[] = []
    m.object.traverse((o) => o instanceof SkinnedMesh && skinned.push(o))
    expect(skinned.map((s) => s.name)).toEqual(['body', 'hat_prop'])
    const prop = skinned[1]!
    m.timeline!.seek(0)
    expect(prop.visible).toBe(false)
    m.timeline!.seek(0.5)
    expect(prop.visible).toBe(true)
    expect(m.files.map((f) => f.name)).toEqual(['default.bobj', 'wave_hello.bobj', 'hat_prop.bobj', 'prop.webp'])
    m.dispose()
  })

  it('emote whose particle scheme is missing still loads (without the effect)', async () => {
    const m = await lp.loadModel(item('emote:4'))
    expect(m.timeline!.duration).toBe(0.5)
  })

  it('emote with only a particle effect and no action', async () => {
    const m = await lp.loadModel(item('emote:3'))
    // duration 0 -> 1 tick
    expect(m.timeline!.duration).toBe(0.05)
    m.tick(0)
    m.tick(50)
    m.dispose()
  })
})

describe('dressPlayer', () => {
  it('dresses a player with cosmetics and plays an emote', async () => {
    const m = await lp.dressPlayer!([item('1'), item('3'), item('4'), item('5'), item('emote:2')], item('emote:2'))
    expect(m.timeline!.duration).toBe(1.5)
    // crown + cloak + top hat; the image item and the emote are not worn
    expect(m.files.map((f) => f.name)).toEqual(['crown.gek.json', 'crown.geo.json', 'crown.webp', 'crown.anim.json', 'blue.webp', 'tophat.obj', 'black.webp'])
    expect(m.states).toEqual([])
    m.tick(0)
    m.tick(500)
    m.dispose()
  })
  it('a single cosmetic keeps its animation states', async () => {
    const m = await lp.dressPlayer!([item('1')])
    expect(m.states).toEqual(['gui', 'spin'])
    expect(m.state).toBe('spin')
    m.setState('gui')
    expect(m.state).toBe('gui')
    expect(m.timeline).toBeUndefined()
  })
  it('a cosmetic that fails to load is skipped', async () => {
    const m = await lp.dressPlayer!([item('unlisted:cosmetics/models/gek/weird/thing/thing.gek.json')])
    expect(m.files).toEqual([])
  })
})

describe('built-in geometry', () => {
  it('dragon wing rig: wings, tips, both sides', () => {
    const g = dragonWingGeo()['minecraft:geometry'][0]!
    expect(g.bones.map((b) => b.name)).toEqual(['wings', 'right_wing', 'right_tip', 'left_wing', 'left_tip'])
    expect(g.description).toEqual({ texture_width: 256, texture_height: 256 })
  })
  it('cape: OptiFine 22x17 layout, player version hangs from the body', () => {
    expect(CAPE_GEO['minecraft:geometry'][0]!.description).toEqual({ texture_width: 22, texture_height: 17 })
    expect(CAPE_ON_PLAYER['minecraft:geometry'][0]!.bones[0]!.name).toBe('bipedBody')
  })
})
