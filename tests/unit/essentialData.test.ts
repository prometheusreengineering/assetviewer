import { describe, expect, it, vi } from 'vitest'
import { buildEssentialCatalog, humanize, orderVariants } from '../../src/providers/essential/catalog'
import { assetBytes, cachePath, listingSource, memorySource, readDumps, resolveFolders, sha256, subSource } from '../../src/providers/essential/localData'
import { essentialFixture } from '../fixtures/essential'

const prefixed = (prefix: string, files: Record<string, Uint8Array | string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [prefix + k, v]))

describe('sources', () => {
  it('lists folders (with a trailing slash) and files, and reads files', async () => {
    const src = memorySource({ 'a/b/c.txt': 'hi', 'a/d.txt': 'yo', 'e.txt': 'x' })
    expect((await src.list('')).sort()).toEqual(['a/', 'e.txt'])
    expect((await src.list('a')).sort()).toEqual(['b/', 'd.txt'])
    expect(new TextDecoder().decode(await src.read('a/b/c.txt'))).toBe('hi')
    expect(await src.read('nope')).toBeUndefined()
    const sub = subSource(src, 'a/b')
    expect(await sub.list('')).toEqual(['c.txt'])
    expect(new TextDecoder().decode(await sub.read('/c.txt'))).toBe('hi')
  })

  it('cache paths shard by the first two hex digits', () => {
    expect(cachePath('abcdef0123')).toBe('a/b/cdef0123')
  })

  it('finds the dumps and the cache under .minecraft, its subfolders, or the folders themselves', async () => {
    const fx = essentialFixture()
    const mc = memorySource({ ...prefixed('prometheus/essential/dumps/', fx.dumps), ...prefixed('essential/cosmetic-cache/', fx.cache), 'options.txt': '' })
    const both = await resolveFolders(mc)
    expect(await both.dumps!.list('')).toContain('HAT/')
    expect((await both.cache!.list('')).length).toBeGreaterThan(0)
    expect((await resolveFolders(memorySource(fx.dumps))).dumps).toBeDefined()
    const cacheOnly = await resolveFolders(memorySource(fx.cache))
    expect([!!cacheOnly.dumps, !!cacheOnly.cache]).toEqual([false, true])
    expect(await resolveFolders(memorySource({ 'random.txt': '' }))).toEqual({})
  })

  it('reads every dump and skips broken files', async () => {
    const dumps = await readDumps(memorySource(essentialFixture().dumps))
    expect(dumps.map((d) => (d as { a: string }).a).sort()).toEqual(['TEST_DANCE', 'TEST_HAT', 'TEST_TOP', 'TEST_WINGS'])
  })

  it('a listing source is what <input webkitdirectory> builds on', async () => {
    const src = listingSource(['x/y.json'], async (p) => (p === 'x/y.json' ? new ArrayBuffer(3) : undefined))
    expect(await src.list('x')).toEqual(['y.json'])
    expect((await src.read('x/y.json'))!.byteLength).toBe(3)
  })
})

describe('assetBytes', () => {
  const fx = essentialFixture()
  const folders = { dumps: memorySource(fx.dumps), cache: memorySource(fx.cache) }

  it('reads the local cache without touching the network', async () => {
    const h = fx.hashes.TEST_HAT!['geometry.steve.json']!
    const download = vi.fn()
    const buf = await assetBytes(folders, { url: `https://cdn.example/assets/${h}`, sha256: h }, download)
    expect(await sha256(buf)).toBe(h)
    expect(download).not.toHaveBeenCalled()
  })

  it("downloads what the cache lacks from the dump's URL and checks its sha256", async () => {
    const h = fx.hashes.TEST_TOP!['texture.png']!
    const url = `https://cdn.example/assets/${h}`
    const download = vi.fn(async (u: string) => fx.remote.get(u)!.slice().buffer as ArrayBuffer)
    expect(await sha256(await assetBytes(folders, { url, sha256: h }, download))).toBe(h)
    expect(download).toHaveBeenCalledWith(url)
    await expect(assetBytes(folders, { url, sha256: 'f'.repeat(64) }, download)).rejects.toThrow('Checksum mismatch')
    await expect(assetBytes(folders, { url: '', sha256: 'f'.repeat(64) }, download)).rejects.toThrow('Not in the local cache')
    await expect(assetBytes({ dumps: folders.dumps }, { url: 'http://insecure/x', sha256: h }, download)).rejects.toThrow()
  })
})

describe('catalog', () => {
  const build = async () => buildEssentialCatalog(await readDumps(memorySource(essentialFixture().dumps)))

  it('items with names, categories and filter fields', async () => {
    const c = await build()
    expect(c.entries.map((e) => e.item.name)).toEqual(['Test Dance', 'Test Hat', 'Test Top', 'Test Wings'])
    const hat = c.entries.find((e) => e.item.id === 'TEST_HAT')!
    expect(hat.item).toMatchObject({ category: 'hat', render: '3d', thumb: undefined })
    expect(hat.item.fields).toMatchObject({ category: 'Hats', rarity: 'Rare', price: 600, themes: ['Spring'], collections: ['January 2026'], flags: ['Previously Unpopular'], slots: ['Hat'], variants: ['blue', 'red'], hasAnimation: true, files: 5 })
    expect(hat).toMatchObject({ geometry: 'geometry.steve.json', animations: 'animations.json', settings: 'settings.json' })
    // no name: the id, humanized
    expect(c.entries.find((e) => e.item.id === 'TEST_TOP')!.item.name).toBe('Test Top')
    expect(c.files).toBe(5 + 2 + 2 + 2)
  })

  it('textures: the plain texture first, else the colour variants', async () => {
    const c = await build()
    expect(c.entries.find((e) => e.item.id === 'TEST_WINGS')!.textures).toEqual([{ name: 'default', path: 'texture.png' }])
    expect(c.entries.find((e) => e.item.id === 'TEST_HAT')!.textures.map((t) => t.name)).toEqual(['blue', 'red'])
  })

  it('emotes and items without a model are name tiles', async () => {
    const c = await build()
    expect(c.entries.find((e) => e.item.id === 'TEST_DANCE')!.item.thumb).toBe('none')
  })

  it('skips malformed and duplicate dumps', () => {
    const c = buildEssentialCatalog([null, { a: 1 }, { a: 'X', b: 'HAT', q: { 'texture.png': { a: 'u', b: 'not-a-hash' } } }, { a: 'X', b: 'HAT' }])
    expect(c.entries).toHaveLength(1)
    expect(c.entries[0]!.files.size).toBe(0)
    expect(c.entries[0]!.item.thumb).toBe('none')
  })

  it('variant order comes from settings.json', () => {
    const t = ['blue', 'default', 'green', 'red'].map((name) => ({ name, path: name }))
    const s = [{ type: 'OTHER' }, { type: 'VARIANTS', data: { variants: [{ name: 'red' }, { name: 'blue' }] } }]
    expect(orderVariants(t, s).map((x) => x.name)).toEqual(['red', 'blue', 'default', 'green'])
    expect(orderVariants(t, undefined).map((x) => x.name)).toEqual(['default', 'blue', 'green', 'red'])
  })

  it.each([
    ['THEME_BUG', 'Bug'],
    ['COLLECTION_DECEMBER2025', 'December 2025'],
    ['BLING_CHAIN', 'Bling Chain'],
    ['FULL_BODY', 'Full Body'],
  ])('humanize %s', (raw, out) => expect(humanize(raw)).toBe(out))
})
