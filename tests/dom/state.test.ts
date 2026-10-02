import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// These modules read localStorage when imported, so each test imports a fresh copy.
const fresh = async <T>(path: string): Promise<T> => {
  vi.resetModules()
  return (await import(/* @vite-ignore */ path)) as T
}
type Collections = typeof import('../../src/collections')
type ViewPrefs = typeof import('../../src/viewPrefs')
type Theme = typeof import('../../src/theme')
type Skin = typeof import('../../src/skin')
type Dialogs = typeof import('../../src/dialogs')

describe('collections', () => {
  const KEY = 'assetviewer.collections.lunar'
  it('always has Favorites and persists changes', async () => {
    const { useCollections, FAV, COLLECTION_PREFIX } = await fresh<Collections>('../../src/collections')
    expect(FAV).toBe('fav')
    expect(COLLECTION_PREFIX).toBe('col-')
    const c = useCollections('lunar')
    expect(c.all()).toEqual([{ id: 'fav', name: 'Favorites', items: [] }])
    c.toggle('fav', 'a')
    await nextTick()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([{ id: 'fav', name: 'Favorites', items: ['a'] }])
  })
  it('toggle, set, has and of', async () => {
    const { useCollections } = await fresh<Collections>('../../src/collections')
    const c = useCollections('lunar')
    const l = c.create('  Mine ')
    expect(l.name).toBe('Mine')
    expect(l.id).toMatch(/^[a-z0-9]{1,6}$/)
    c.toggle(l.id, 'x')
    c.toggle('fav', 'x')
    expect(c.has(l.id, 'x')).toBe(true)
    expect(c.of('x')).toEqual(['fav', l.id])
    c.toggle(l.id, 'x')
    expect(c.has(l.id, 'x')).toBe(false)
    c.set('fav', 'y', true)
    c.set('fav', 'y', true)
    expect(c.get('fav')!.items).toEqual(['x', 'y'])
    c.set('fav', 'x', false)
    c.set('fav', 'x', false)
    expect(c.get('fav')!.items).toEqual(['y'])
    // unknown lists are ignored
    c.toggle('nope', 'z')
    c.set('nope', 'z', true)
    expect(c.has('nope', 'z')).toBe(false)
  })
  it('create defaults the name; rename trims and ignores blanks; Favorites cannot be removed', async () => {
    const { useCollections } = await fresh<Collections>('../../src/collections')
    const c = useCollections('lunar')
    const l = c.create('   ')
    expect(l.name).toBe('Untitled')
    c.rename(l.id, '  Renamed  ')
    expect(c.get(l.id)!.name).toBe('Renamed')
    c.rename(l.id, '   ')
    expect(c.get(l.id)!.name).toBe('Renamed')
    c.rename('nope', 'x')
    c.remove('fav')
    c.remove('nope')
    expect(c.all().map((x) => x.id)).toEqual(['fav', l.id])
    c.remove(l.id)
    expect(c.all().map((x) => x.id)).toEqual(['fav'])
  })
  it('loads saved lists, drops malformed ones and adds Favorites when missing', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'k', name: 'Kept', items: ['1'] }, { id: 3, name: 'bad' }, null, { id: 'n', name: 'No items' }]))
    const { useCollections } = await fresh<Collections>('../../src/collections')
    expect(useCollections('lunar').all()).toEqual([
      { id: 'fav', name: 'Favorites', items: [] },
      { id: 'k', name: 'Kept', items: ['1'] },
    ])
  })
  it('ignores corrupt storage and keeps providers separate', async () => {
    localStorage.setItem(KEY, '{not json')
    localStorage.setItem('assetviewer.collections.essential', JSON.stringify({ not: 'an array' }))
    const { useCollections } = await fresh<Collections>('../../src/collections')
    useCollections('lunar').toggle('fav', 'a')
    expect(useCollections('essential').has('fav', 'a')).toBe(false)
    expect(useCollections('lunar').has('fav', 'a')).toBe(true)
    // the same state for every caller
    expect(useCollections('lunar').all()).toBe(useCollections('lunar').all())
  })
  it('export includes names; import merges by name and counts new items', async () => {
    const { useCollections } = await fresh<Collections>('../../src/collections')
    const c = useCollections('lunar')
    c.toggle('fav', '1')
    const l = c.create('Hats')
    c.toggle(l.id, '2')
    const json = JSON.parse(c.exportJson(['fav', l.id], (id) => (id === '1' ? 'One' : undefined)))
    expect(json).toEqual({
      app: 'assetviewer',
      provider: 'lunar',
      collections: [
        { name: 'Favorites', items: [{ id: '1', name: 'One' }] },
        { name: 'Hats', items: [{ id: '2' }] },
      ],
    })
    const added = c.importJson(JSON.stringify({ collections: [{ name: 'Hats', items: [{ id: '2' }, { id: '3' }, '4', {}] }, { name: 'New', items: ['5'] }, { items: ['6'] }] }))
    expect(added).toBe(4)
    expect(c.get(l.id)!.items).toEqual(['2', '3', '4'])
    expect(c.all().map((x) => x.name)).toEqual(['Favorites', 'Hats', 'New', 'Imported'])
  })
  it('import rejects files that are not collections', async () => {
    const { useCollections } = await fresh<Collections>('../../src/collections')
    const c = useCollections('lunar')
    expect(() => c.importJson('{"a":1}')).toThrow('Not an Asset Viewer collections file')
    expect(() => c.importJson('nope')).toThrow(SyntaxError)
  })
  it('survives a localStorage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { useCollections } = await fresh<Collections>('../../src/collections')
    const c = useCollections('lunar')
    c.toggle('fav', 'a')
    await nextTick()
    expect(c.has('fav', 'a')).toBe(true)
  })
})

describe('selection', () => {
  it('toggles in pick order, sets and clears', async () => {
    const s = await fresh<typeof import('../../src/selection')>('../../src/selection')
    expect(s.MAX_COMPARE).toBe(4)
    s.toggleSelected('a')
    s.toggleSelected('b')
    s.toggleSelected('c')
    s.toggleSelected('a')
    expect(s.selection.value).toEqual(['b', 'c'])
    const ids = ['x', 'y']
    s.setSelection(ids)
    expect(s.selection.value).toEqual(ids)
    expect(s.selection.value).not.toBe(ids)
    s.clearSelection()
    expect(s.selection.value).toEqual([])
  })
})

describe('viewPrefs', () => {
  it('defaults: auto-rotate on, wireframe and free rotate off', async () => {
    const p = await fresh<ViewPrefs>('../../src/viewPrefs')
    expect([p.autoRotate.value, p.wireframe.value, p.freeRotate.value]).toEqual([true, false, false])
  })
  it('reads and writes 1/0', async () => {
    localStorage.setItem('assetviewer.autoRotate', '0')
    localStorage.setItem('assetviewer.wireframe', '1')
    const p = await fresh<ViewPrefs>('../../src/viewPrefs')
    expect(p.autoRotate.value).toBe(false)
    expect(p.wireframe.value).toBe(true)
    p.freeRotate.value = true
    await nextTick()
    expect(localStorage.getItem('assetviewer.freeRotate')).toBe('1')
  })
  it('follows changes made in another tab', async () => {
    const p = await fresh<ViewPrefs>('../../src/viewPrefs')
    window.dispatchEvent(new StorageEvent('storage', { key: 'assetviewer.wireframe', newValue: '1' }))
    expect(p.wireframe.value).toBe(true)
    window.dispatchEvent(new StorageEvent('storage', { key: 'assetviewer.wireframe', newValue: null }))
    expect(p.wireframe.value).toBe(true)
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '0' }))
    expect(p.wireframe.value).toBe(true)
  })
})

describe('theme', () => {
  const html = document.documentElement
  it('follows the OS preference when nothing is saved', async () => {
    const mm = vi.spyOn(window, 'matchMedia')
    mm.mockImplementation((q: string) => ({ matches: q.includes('light') }) as MediaQueryList)
    const light = await fresh<Theme>('../../src/theme')
    expect(light.dark.value).toBe(false)
    expect(html.classList.contains('app-dark')).toBe(false)
    // the immediate watch already saved the resolved choice
    expect(localStorage.getItem('assetviewer.theme')).toBe('light')
    localStorage.clear()
    mm.mockImplementation(() => ({ matches: false }) as MediaQueryList)
    const dark = await fresh<Theme>('../../src/theme')
    expect(dark.dark.value).toBe(true)
    expect(html.classList.contains('app-dark')).toBe(true)
  })
  it('a saved choice wins, and toggling updates the class and storage', async () => {
    localStorage.setItem('assetviewer.theme', 'light')
    const t = await fresh<Theme>('../../src/theme')
    expect(t.dark.value).toBe(false)
    t.dark.value = true
    await nextTick()
    expect(html.classList.contains('app-dark')).toBe(true)
    expect(localStorage.getItem('assetviewer.theme')).toBe('dark')
  })
  it('defaults to dark when matchMedia is missing', async () => {
    const saved = window.matchMedia
    // @ts-expect-error simulating a browser without matchMedia
    window.matchMedia = undefined
    const t = await fresh<Theme>('../../src/theme').finally(() => (window.matchMedia = saved))
    expect(t.dark.value).toBe(true)
  })
})

describe('skin', () => {
  const ctx = () => {
    const calls: unknown[][] = []
    return { calls, fillStyle: '', fillRect: (...a: unknown[]) => calls.push(['fillRect', ...a]), drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a]) }
  }
  const stubCanvas = () => {
    const canvases: { w: number; h: number; ctx: ReturnType<typeof ctx> }[] = []
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number
        height: number
        c = ctx()
        constructor(w: number, h: number) {
          this.width = w
          this.height = h
          canvases.push({ w, h, ctx: this.c })
        }
        getContext() {
          return this.c
        }
      },
    )
    return canvases
  }
  const bitmap = (w: number, h: number) => ({ width: w, height: h })

  it('remembers the player name', async () => {
    localStorage.setItem('assetviewer.skin', 'Notch')
    const s = await fresh<Skin>('../../src/skin')
    expect(s.skinName.value).toBe('Notch')
    s.skinName.value = 'jeb_'
    await nextTick()
    expect(localStorage.getItem('assetviewer.skin')).toBe('jeb_')
    expect(s.showOnPlayer.value).toBe(false)
    expect(s.playerEmoteId.value).toBeNull()
  })
  it('no name: a drawn 64x64 placeholder, cached', async () => {
    const canvases = stubCanvas()
    const create = vi.fn(async (src: { width: number; height: number }) => bitmap(src.width, src.height))
    vi.stubGlobal('createImageBitmap', create)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const s = await fresh<Skin>('../../src/skin')
    const a = s.skinBitmap()
    expect(s.skinBitmap('')).toBe(a)
    expect(await a).toEqual({ width: 64, height: 64 })
    expect(canvases[0]).toMatchObject({ w: 64, h: 64 })
    expect(canvases[0]!.ctx.calls.length).toBeGreaterThan(10)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('a name loads that skin from mc-heads.net', async () => {
    stubCanvas()
    vi.stubGlobal('createImageBitmap', async () => bitmap(64, 64))
    const fetch = vi.fn(async () => new Response(new Blob(['png'])))
    vi.stubGlobal('fetch', fetch)
    const s = await fresh<Skin>('../../src/skin')
    expect(await s.skinBitmap('A B')).toEqual({ width: 64, height: 64 })
    expect(fetch).toHaveBeenCalledWith('https://mc-heads.net/skin/A%20B')
  })
  it('legacy 64x32 skins are expanded, copying the right limbs to the left', async () => {
    const canvases = stubCanvas()
    let n = 0
    vi.stubGlobal('createImageBitmap', async () => (n++ ? bitmap(64, 64) : bitmap(64, 32)))
    vi.stubGlobal('fetch', async () => new Response(new Blob(['png'])))
    const s = await fresh<Skin>('../../src/skin')
    expect(await s.skinBitmap('old')).toEqual({ width: 64, height: 64 })
    const draws = canvases[0]!.ctx.calls.filter((c) => c[0] === 'drawImage').map((c) => c.slice(2))
    expect(draws).toEqual([[0, 0], [0, 16, 16, 16, 16, 48, 16, 16], [40, 16, 16, 16, 32, 48, 16, 16]])
  })
  it('a failed lookup falls back to the placeholder and is retried next time', async () => {
    stubCanvas()
    vi.stubGlobal('createImageBitmap', async (src: { width: number; height: number }) => bitmap(src.width, src.height))
    const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = await fresh<Skin>('../../src/skin')
    expect(await s.skinBitmap('ghost')).toEqual({ width: 64, height: 64 })
    await s.skinBitmap('ghost')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('dialogs', () => {
  it('askConfirm resolves with the answer; remember skips it once stored', async () => {
    const d = await fresh<Dialogs>('../../src/dialogs')
    const p = d.askConfirm({ title: 'Sure?', remember: 'k' })
    expect(d.dialog.value).toMatchObject({ title: 'Sure?', remember: 'k' })
    d.dialog.value!.resolve(true)
    expect(await p).toBe(true)
    const no = d.askConfirm({ title: 'Sure?' })
    d.dialog.value!.resolve(false)
    expect(await no).toBe(false)
    localStorage.setItem('k', '1')
    d.dialog.value = undefined
    expect(await d.askConfirm({ title: 'Sure?', remember: 'k' })).toBe(true)
    expect(d.dialog.value).toBeUndefined()
  })
  it('a new dialog cancels the open one', async () => {
    const d = await fresh<Dialogs>('../../src/dialogs')
    const first = d.askConfirm({ title: 'one' })
    const second = d.askText({ title: 'two' })
    expect(await first).toBe(false)
    expect(d.dialog.value).toMatchObject({ title: 'two', input: '' })
    d.dialog.value!.resolve('  hi  ')
    expect(await second).toBe('hi')
  })
  it('askText: blank, cancelled and initial input', async () => {
    const d = await fresh<Dialogs>('../../src/dialogs')
    const blank = d.askText({ title: 't', input: 'start' })
    expect(d.dialog.value!.input).toBe('start')
    d.dialog.value!.resolve('   ')
    expect(await blank).toBeUndefined()
    const cancelled = d.askText({ title: 't' })
    d.dialog.value!.resolve(false)
    expect(await cancelled).toBeUndefined()
  })
  it('notify is an OK-only dialog', async () => {
    const d = await fresh<Dialogs>('../../src/dialogs')
    const p = d.notify('Done', 'All good')
    expect(d.dialog.value).toMatchObject({ title: 'Done', message: 'All good', icon: 'pi pi-info-circle', confirmLabel: 'OK', cancelLabel: false })
    d.dialog.value!.resolve(true)
    await expect(p).resolves.toBeUndefined()
  })
})

describe('download / stats / router', () => {
  it('download clicks a temporary link and revokes it later', async () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const clicks: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })
    const { download } = await fresh<typeof import('../../src/download')>('../../src/download')
    download('a.txt', 'hello', 'text/plain')
    expect(clicks[0]!.download).toBe('a.txt')
    expect(clicks[0]!.href).toBe('blob:x')
    expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('text/plain')
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith('blob:x')
    vi.useRealTimers()
  })
  it('stats starts empty', async () => {
    const { stats } = await fresh<typeof import('../../src/stats')>('../../src/stats')
    expect(stats.value).toBeUndefined()
  })
  it('router: / redirects to lunar; provider and category params', async () => {
    const { router } = await fresh<typeof import('../../src/router')>('../../src/router')
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/lunar')
    await router.push('/lunar/cloak?q=x')
    expect(router.currentRoute.value.params).toEqual({ provider: 'lunar', category: 'cloak' })
    await router.push('/essential')
    expect(router.currentRoute.value.params.provider).toBe('essential')
    expect(router.resolve('/other/x').matched).toHaveLength(0)
  })
})
