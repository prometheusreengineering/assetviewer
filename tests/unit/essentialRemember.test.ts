// "Remember on this device": the picked files are kept in IndexedDB (here an in-memory stand-in) and the next
// load connects them; Disconnect forgets them.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { essentialFixture } from '../fixtures/essential'
import { installBitmapStubs } from '../helpers/bitmaps'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  createStore: () => 'own-store',
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}))
// The first version's database (thousands of separate Blobs in one record).
const legacy = { values: undefined as Map<string, unknown> | undefined, dropped: 0 }
vi.mock('../../src/providers/essential/legacyStore', () => ({
  readLegacy: async () => legacy.values,
  dropLegacy: () => void legacy.dropped++,
}))

const fx = essentialFixture()
/** Files as an <input webkitdirectory> pick gives them: paths start with the picked folder's name. */
const picked = (folder: string, files: Record<string, Uint8Array | string>) =>
  Object.entries(files).map(([path, body]) => {
    const f = new File([typeof body === 'string' ? body : (body.slice().buffer as ArrayBuffer)], path.split('/').pop()!)
    Object.defineProperty(f, 'webkitRelativePath', { value: `${folder}/${path}` })
    return f
  })

beforeAll(() => installBitmapStubs())
beforeEach(() => {
  store.clear()
  legacy.values = undefined
  legacy.dropped = 0
  vi.resetModules()
})

describe('remembered files', () => {
  it('keeps a copy only when asked, restores it on the next load, and Disconnect forgets it', async () => {
    const mod = await import('../../src/providers/essential')
    await mod.connectFiles(picked('dumps', fx.dumps), picked('cosmetic-cache', fx.cache))
    expect(store.size).toBe(0)
    await mod.connectFiles(picked('dumps', fx.dumps), picked('cosmetic-cache', fx.cache), true)
    expect(store.size).toBe(1)
    expect(mod.essentialState.value.remembered).toBe(true)

    // a fresh page: nothing connected until load() restores the copy
    vi.resetModules()
    const fresh = await import('../../src/providers/essential')
    expect(fresh.essentialProvider.setup!.needed()).toBe(true)
    await fresh.essentialProvider.load()
    expect(fresh.essentialProvider.setup!.needed()).toBe(false)
    expect(fresh.essentialProvider.items('everything')).toHaveLength(5)
    // the restored cache serves models
    const m = await fresh.essentialProvider.loadModel(fresh.essentialProvider.itemById!('TEST_HAT')!)
    expect(m.variants).toEqual(['blue', 'red'])

    await fresh.essentialProvider.setup!.disconnect!()
    expect(store.size).toBe(0)
    expect(fresh.essentialProvider.setup!.needed()).toBe(true)
  })

  it('stores each folder as one Blob (thousands of Blobs in a record crash Chrome when it is deleted)', async () => {
    const mod = await import('../../src/providers/essential')
    await mod.connectFiles(picked('dumps', fx.dumps), picked('cosmetic-cache', fx.cache), true)
    const copy = store.get('assetviewer.essential.files') as { dumps: { blob: Blob; index: [string, number, number][] }; cache: { blob: Blob; index: unknown[] } }
    expect(copy.dumps.blob).toBeInstanceOf(Blob)
    expect(copy.cache.blob).toBeInstanceOf(Blob)
    expect(copy.dumps.index).toHaveLength(Object.keys(fx.dumps).length)
    expect(copy.cache.index).toHaveLength(Object.keys(fx.cache).length)
    // the rows cover the blob end to end
    expect(copy.dumps.index.at(-1)![2]).toBe(copy.dumps.blob.size)
    const backwards = [...copy.dumps.index, ...(copy.cache.index as [string, number, number][])].filter(([, s, e]) => e < s)
    expect(backwards).toEqual([])
  })

  it("moves the first version's copy into a packed one and drops the old database", async () => {
    const files = (folder: string, f: Record<string, Uint8Array | string>) =>
      picked(folder, f).map((file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file: new Blob([file]) }))
    legacy.values = new Map<string, unknown>([['assetviewer.essential.files', { dumps: files('dumps', fx.dumps), cache: files('cosmetic-cache', fx.cache) }]])
    const mod = await import('../../src/providers/essential')
    await mod.essentialProvider.load()
    expect(legacy.dropped).toBe(1)
    expect((store.get('assetviewer.essential.files') as { dumps: { blob: Blob } }).dumps.blob).toBeInstanceOf(Blob)
    expect(mod.essentialProvider.items('everything')).toHaveLength(5)
    const m = await mod.essentialProvider.loadModel(mod.essentialProvider.itemById!('TEST_HAT')!)
    expect(m.variants).toEqual(['blue', 'red'])
    // Disconnect also drops it (in case it was never migrated)
    await mod.essentialProvider.setup!.disconnect!()
    expect(legacy.dropped).toBe(2)
  })
})
