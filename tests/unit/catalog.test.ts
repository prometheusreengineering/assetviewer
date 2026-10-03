import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GEK_CATEGORY, humanize, loadLunarCatalog, PREFIX, RESOURCE_CATEGORIES, resourceCategory, type LunarCatalog } from '../../src/providers/lunar/catalog'
import { installCdn } from '../helpers/cdnMock'
import { LUNAR_FILES, LUNAR_FULL, P } from '../fixtures/lunar'

let cat: LunarCatalog
const byId = (id: string) => cat.entries.find((e) => e.item.id === id)!

beforeAll(async () => {
  installCdn(LUNAR_FULL)
  cat = await loadLunarCatalog()
})
afterAll(() => vi.unstubAllGlobals())

describe('humanize', () => {
  it.each([
    ['cosmetics/models/gek/pets/dog/dog.gek.json', 'Dog'],
    ['a/b/red_scarf.webp', 'Red Scarf'],
    ['a/blue-bandanna.webp', 'Blue Bandanna'],
    ['x/__under--score__.png', ' Under Score '],
    ['noext', 'Noext'],
    ['x/crown.geo.json', 'Crown.Geo'],
  ])('%s -> %s', (p, want) => expect(humanize(p)).toBe(want))
})

describe('resourceCategory', () => {
  it.each([
    ['badges/a.png', 'badges'],
    ['sprays/a.gif', 'sprays'],
    ['emotes/icons/1.webp', 'emote_icons'],
    ['emotes/textures/x.webp', 'emote_textures'],
    ['emotes/emotes.json', 'emote_data'],
    ['particles/textures/p.webp', 'particle_textures'],
    ['particles/schemes/x.json', 'particle_data'],
    ['icons/i.png', 'icons'],
    ['misc/m.png', 'misc'],
    ['cosmetics.json', 'data'],
    ['shaders/x.vsh', 'data'],
  ])('%s -> %s', (p, want) => expect(resourceCategory(p)).toBe(want))
  it('every result is a known resource category', () => {
    for (const p of ['badges/', 'sprays/', 'emotes/icons/', 'emotes/textures/', 'emotes/', 'particles/textures/', 'particles/', 'icons/', 'misc/', 'x']) expect(RESOURCE_CATEGORIES).toContain(resourceCategory(p))
  })
  it('maps gek folders to category ids', () => {
    expect(GEK_CATEGORY.wings).toBe('dragon_wings')
    expect(GEK_CATEGORY.pets).toBe('pet')
    expect(GEK_CATEGORY.hats).toBe('hat')
  })
})

describe('loadLunarCatalog: file map', () => {
  it('merges both indexes with hashes and sizes, skipping blank and malformed lines', () => {
    expect(cat.files.size).toBe(LUNAR_FILES.length)
    expect(cat.files.has('lonely-path')).toBe(false)
    expect(cat.files.get(P + 'cosmetics.json')).toMatch(/^[0-9a-f]{40}$/)
    expect(cat.sizes.get(P + 'cosmetics/functions.molang')).toBe('lunar.double(a.x): |-\n  return a.x * 2;\n'.length)
    expect(PREFIX).toBe(P)
  })
  it('finds OBJ models by folder', () => {
    expect([...cat.objs.keys()].sort()).toEqual(['bandanna', 'mask', 'tophat'])
    expect(cat.objs.get('tophat')).toBe(P + 'cosmetics/models/hats/tophat/tophat.obj')
  })
  it('keeps emotes.json', () => {
    expect(cat.emotes!.emotes.map((e) => e.name)).toEqual(['wave_hello', 'dance', 'ghost', 'broken'])
  })
})

describe('loadLunarCatalog: cosmetics.json', () => {
  it('a gek item', () => {
    const e = byId('1')
    expect(e.kind).toBe('gek')
    expect(e.path).toBe('cosmetics/models/gek/hats/crown/crown.gek.json')
    expect(e.modelKey).toBe('')
    expect(e.item).toMatchObject({ name: 'Crown', category: 'hat', render: '3d' })
    expect(e.item.fields).toEqual({ themes: ['FANCY'], colors: ['GOLD'], animated: false, special: true, released: Date.parse('2023-05-01T12:00:00Z') })
    expect(e.info).toEqual({ ID: '1', Released: '2023-05-01', Source: e.path })
  })
  it('dragon wings, cloaks (animated via .mcmeta) and OBJ hats', () => {
    expect(byId('2').kind).toBe('wing2d')
    const cloak = byId('3')
    expect(cloak.kind).toBe('cloak')
    expect(cloak.item.fields.animated).toBe(true)
    expect(cloak.modelKey).toBe('')
    const hat = byId('4')
    expect(hat.kind).toBe('obj')
    expect(hat.modelKey).toBe('tophat')
  })
  it('an item without a usable model is an image; empty name/tags/colors and bad dates are handled', () => {
    const e = byId('5')
    expect(e.kind).toBe('image')
    expect(e.item.render).toBe('image')
    expect(e.item.name).toBe('5')
    expect(e.modelKey).toBe('nomodel')
    expect(e.item.fields).toEqual({ themes: [], colors: [], animated: true, special: false })
    // the raw string still shows as "Released"
    expect(e.info.Released).toBe('not a date')
  })
})

describe('loadLunarCatalog: legacy CSV', () => {
  it('adds rows the JSON lacks, only for files on the CDN', () => {
    const ids = cat.entries.map((e) => e.item.id)
    expect(ids.filter((i) => i === '1')).toHaveLength(1)
    expect(ids).not.toContain('11')
    expect(ids).not.toContain('short')
    const mask = byId('10')
    expect(mask).toMatchObject({ kind: 'obj', modelKey: 'mask', path: 'cosmetics/models/hats/mask/textures/old.webp', info: { ID: '10', Source: 'cosmetics/models/hats/mask/textures/old.webp' } })
    expect(mask.item).toMatchObject({ name: 'Old Mask', category: 'mask', render: '3d' })
    expect(mask.item.fields).toEqual({ themes: ['SPOOKY', 'DARK'], colors: ['BLACK'], animated: false })
    const legacy = byId('12')
    // a shader cloak's texture sits in a subfolder (next to its .fsh) and is still a 3D cape
    expect(legacy).toMatchObject({ kind: 'cloak', modelKey: '' })
    expect(legacy.item.name).toBe('12')
    expect(legacy.item.fields.themes).toEqual([])
  })
})

describe('loadLunarCatalog: unlisted cosmetics', () => {
  const un = (rel: string) => byId('unlisted:' + rel)
  it('gek files by folder', () => {
    expect(un('cosmetics/models/gek/pets/dog/dog.gek.json')).toMatchObject({ kind: 'gek', item: { name: 'Dog', category: 'pet', render: '3d', fields: { themes: ['UNLISTED'], colors: [], animated: false } } })
    expect(un('cosmetics/models/gek/weird/thing/thing.gek.json').item.category).toBe('weird')
    expect(un('cosmetics/models/gek/pets/dog/dog.gek.json').info).toEqual({ Source: 'cosmetics/models/gek/pets/dog/dog.gek.json', Note: 'Present on the CDN but not in any catalog' })
  })
  it('hat/bodywear textures: on their OBJ when the folder has one, else images', () => {
    expect(un('cosmetics/models/bodywear/scarf/textures/red_scarf.webp')).toMatchObject({ kind: 'image', modelKey: '', item: { category: 'bodywear', render: 'image', name: 'Red Scarf' } })
    expect(un('cosmetics/models/hats/bandanna/textures/blue-bandanna.webp')).toMatchObject({ kind: 'obj', modelKey: 'bandanna', item: { category: 'bandanna' } })
    expect(un('cosmetics/models/hats/mask/textures/new.webp')).toMatchObject({ kind: 'obj', modelKey: 'mask', item: { category: 'mask' } })
    expect(un('cosmetics/models/hats/plain/textures/cap.webp')).toMatchObject({ kind: 'image', item: { category: 'hat' } })
  })
  it('wings, wing thumbnails without a wing, and cloaks', () => {
    expect(un('cosmetics/wings/green.webp')).toMatchObject({ kind: 'wing2d', item: { category: 'dragon_wings' } })
    expect(un('cosmetics/wings/thumbnail/lonely.webp')).toMatchObject({ kind: 'image', item: { category: 'dragon_wings', render: 'image' } })
    expect(un('cosmetics/cloaks/unl.webp')).toMatchObject({ kind: 'cloak', item: { fields: { animated: true } } })
  })
  it('thumbnails of listed wings and model dependencies are not items', () => {
    const ids = cat.entries.map((e) => e.item.id)
    for (const rel of ['cosmetics/wings/thumbnail/red.webp', 'cosmetics/wings/thumbnail/green.webp', 'cosmetics/models/gek/hats/crown/crown.geo.json', 'cosmetics/models/gek/hats/crown/textures/crown.webp', 'cosmetics/models/gek/pets/dog/dog.geo.json']) {
      expect(ids).not.toContain('unlisted:' + rel)
      expect(ids).not.toContain('res:' + rel)
    }
  })
})

describe('loadLunarCatalog: resources', () => {
  const res = (rel: string) => byId('res:' + rel)
  it('badges and sprays take names and info from their json', () => {
    expect(res('badges/gold.png')).toMatchObject({ kind: 'image', item: { name: 'Gold Badge', category: 'badges', render: 'image', fields: { ext: 'png', animated: false } } })
    expect(res('badges/gold.png').info).toEqual({ ID: '7', Description: 'Shiny', Released: '2022-01-02', Path: 'badges/gold.png' })
    expect(res('sprays/heart.gif').item).toMatchObject({ name: 'Heart', fields: { animated: true } })
    expect(res('sprays/plain.webp').item.name).toBe('Plain')
  })
  it('categorises everything outside the cosmetic trees', () => {
    const cats = Object.fromEntries(
      ['emotes/icons/1.webp', 'emotes/textures/prop.webp', 'emotes/emotes.json', 'emotes/models/entity/default.bobj', 'particles/textures/default_particles.webp', 'particles/configuration.json', 'icons/x.png', 'misc/y.jpg', 'shaders/glint.vsh', 'cosmetics.json', 'badges.json'].map((r) => [r, res(r).item.category]),
    )
    expect(cats).toEqual({
      'emotes/icons/1.webp': 'emote_icons',
      'emotes/textures/prop.webp': 'emote_textures',
      'emotes/emotes.json': 'emote_data',
      'emotes/models/entity/default.bobj': 'emote_data',
      'particles/textures/default_particles.webp': 'particle_textures',
      'particles/configuration.json': 'particle_data',
      'icons/x.png': 'icons',
      'misc/y.jpg': 'misc',
      'shaders/glint.vsh': 'data',
      'cosmetics.json': 'data',
      'badges.json': 'data',
    })
    expect(res('misc/y.jpg').item.render).toBe('image')
    expect(res('cosmetics.json')).toMatchObject({ kind: 'file', item: { render: 'file', name: 'Cosmetics', fields: { ext: 'json' } } })
  })
  it('lists extras from the cosmetic trees: shaders, OBJ files and cloak subfolders', () => {
    expect(res('cosmetics/models/gek/hats/crown/crown.fsh').kind).toBe('file')
    expect(res('cosmetics/models/hats/tophat/tophat.obj').kind).toBe('file')
    expect(res('cosmetics/cloaks/blue/extra.webp')).toMatchObject({ kind: 'image', item: { category: 'data' } })
  })
  it('a file without an extension gets its whole path as "ext" (known quirk)', () => {
    expect(res('cosmetics/index').item.fields.ext).toBe('cosmetics/index')
  })
  it('.mcmeta files are never items', () => {
    expect(cat.entries.some((e) => e.path.endsWith('.mcmeta'))).toBe(false)
  })
})

describe('loadLunarCatalog: emotes', () => {
  it('adds one item per emote, with an icon thumbnail when there is one', () => {
    const wave = byId('emote:1')
    expect(wave).toMatchObject({ kind: 'emote', path: 'emotes/icons/1.webp', modelKey: '', info: { Action: 'emote_wave_hello' } })
    expect(wave.item).toMatchObject({ name: 'Wave Hello', category: 'emotes', render: '3d', thumb: 'image' })
    expect(wave.item.fields).toEqual({ themes: [], colors: [], id: 1, duration: 2.5, looping: true, author: 'Bob', props: ['hat_prop'], morph: 'sparkle' })
    const dance = byId('emote:2')
    expect(dance.item.thumb).toBe('none')
    expect(dance.item.fields).toEqual({ themes: [], colors: [], id: 2, duration: 1, looping: false, author: '', props: [] })
  })
  it('emote files stay listed as resources', () => {
    expect(byId('res:emotes/icons/1.webp')).toBeDefined()
  })
  it('ids are unique and every item has a category', () => {
    const ids = cat.entries.map((e) => e.item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of cat.entries) expect(e.item.category).toBeTruthy()
  })
})

describe('loadLunarCatalog: optional files', () => {
  it('works without the CSV, badge/spray json and emotes', async () => {
    installCdn(LUNAR_FULL.filter(([p]) => !/cosmetics\/index$|badges\.json|sprays\.json|emotes\.json/.test(p)))
    const c = await loadLunarCatalog()
    expect(c.emotes).toBeUndefined()
    expect(c.entries.find((e) => e.item.id === '10')).toBeUndefined()
    expect(c.entries.find((e) => e.item.id === 'res:badges/gold.png')!.item.name).toBe('Gold')
    expect(c.entries.some((e) => e.kind === 'emote')).toBe(false)
  })
})
