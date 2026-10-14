// "Remember on this device": the picked files are kept in IndexedDB (here an in-memory stand-in) and the next
// load connects them; Disconnect forgets them.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { essentialFixture } from '../fixtures/essential'
import { installBitmapStubs } from '../helpers/bitmaps'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
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
})
