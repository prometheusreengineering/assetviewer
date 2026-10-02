// Live: the real Lunar CDN. Needs network access.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadLunarCatalog, PREFIX, type LunarCatalog } from '../../../src/providers/lunar/catalog'
import { EVERYTHING, lunarProvider as lp } from '../../../src/providers/lunar'
import { installMemoryCaches } from '../../helpers/memoryCaches'

let cat: LunarCatalog

beforeAll(async () => {
  installMemoryCaches()
  cat = await loadLunarCatalog()
  await lp.load()
})
afterAll(() => vi.unstubAllGlobals())

describe('live catalog', () => {
  it('has thousands of files and items', () => {
    expect(cat.files.size).toBeGreaterThan(5000)
    expect(cat.entries.length).toBeGreaterThan(2000)
    for (const [p, h] of cat.files) {
      expect(p).toMatch(/^\S+$/)
      expect(h).toMatch(/^[0-9a-f]{40}$/)
    }
  })
  it('every item points at a file in the index (emotes: an icon or a name tile)', () => {
    const missing = cat.entries.filter((e) => e.kind !== 'emote' && !cat.files.has(PREFIX + e.path)).map((e) => e.path)
    expect(missing).toEqual([])
    for (const e of cat.entries.filter((x) => x.kind === 'emote')) expect(e.item.thumb).toBe(cat.files.has(PREFIX + e.path) ? 'image' : 'none')
  })
  it('ids are unique', () => {
    const ids = cat.entries.map((e) => e.item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every model kind and the main categories are present', () => {
    const kinds = new Set(cat.entries.map((e) => e.kind))
    for (const k of ['gek', 'obj', 'wing2d', 'cloak', 'emote', 'image', 'file']) expect(kinds).toContain(k)
    const cats = new Set(cat.entries.map((e) => e.item.category))
    for (const c of ['hat', 'cloak', 'dragon_wings', 'pet', 'auras', 'emotes', 'badges', 'sprays']) expect(cats).toContain(c)
  })
  it('OBJ items have their shared model', () => {
    for (const e of cat.entries.filter((x) => x.kind === 'obj')) expect(cat.objs.has(e.modelKey)).toBe(true)
  })
  it('emotes.json is loaded with actions and props', () => {
    expect(cat.emotes!.emotes.length).toBeGreaterThan(50)
    expect(cat.emotes!.actions.length).toBeGreaterThan(0)
    for (const a of cat.emotes!.actions) expect(cat.files.has(PREFIX + a.replace(/^lunar:/, ''))).toBe(true)
  })
  it('the provider builds categories and fields from it', () => {
    const cats = lp.categories()
    expect(cats[0]!.id).toBe(EVERYTHING)
    expect(cats.every((c) => c.count > 0)).toBe(true)
    expect(lp.fields('hat').map((f) => f.key)).toEqual(expect.arrayContaining(['name', 'themes', 'colors', 'released', 'size']))
    expect(lp.stats!().files).toBe(cat.files.size)
    expect(lp.indexedFiles!()).toHaveLength(cat.files.size)
  })
})
