// The whole app (App + ProviderView + the real Lunar provider) on the fixture CDN.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import { clearSelection } from '../../src/selection'
import { useCollections } from '../../src/collections'
import { dialog } from '../../src/dialogs'
import { stats } from '../../src/stats'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installCdn } from '../helpers/cdnMock'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'
import { FakeIntersectionObserver, FakeWebGLRenderer } from '../helpers/webgl'
import { LUNAR_FULL } from '../fixtures/lunar'

vi.mock('three', async (orig) => {
  const three = await orig<typeof import('three')>()
  const { FakeWebGLRenderer } = await import('../helpers/webgl')
  return { ...three, WebGLRenderer: FakeWebGLRenderer }
})

let files: ReturnType<typeof installCdn>
beforeAll(() => {
  files = installCdn(LUNAR_FULL)
})
beforeEach(() => {
  // the dom setup unstubs globals after every test
  vi.stubGlobal('fetch', files.fetch)
  installBitmapStubs()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  FakeWebGLRenderer.instances = []
  FakeIntersectionObserver.instances = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  clearSelection()
  const c = useCollections('lunar')
  for (const l of [...c.all()]) l.id === 'fav' ? l.items.splice(0) : c.remove(l.id)
})

const open = async (path: string) => {
  const m = await mountApp(App, { path })
  await settle(20)
  return m
}
const menu = () => $$('.side .p-menu-item-label').map((e) => e.textContent!.trim())
const menuItem = (label: string) => $$('.side .p-menu-item-content').find((e) => e.textContent!.trim().startsWith(label))!
const count = () => $('.toolbar .count')!.textContent
const cards = () => $$('.card .name').map((e) => e.textContent)

describe('app shell', () => {
  it('/lunar goes home; the sidebar lists Home, Everything, cosmetics, resources, collections, tools', async () => {
    const { router } = await open('/lunar')
    expect(router.currentRoute.value.path).toBe('/lunar/home')
    expect($('.home h1')!.textContent).toBe('Asset Viewer')
    const m = menu()
    expect(m.slice(0, 3)).toEqual(['Home', 'Everything (47)', 'Hats (3)'])
    expect(m).toContain('Favorites (0)')
    expect(m).toContain('New collection')
    expect(m.at(-1)).toBe('Outfit builder')
    expect($$('.side .p-menu-submenu-label').map((e) => e.textContent)).toEqual(['', 'Cosmetics (3D)', 'Resources (2D)', 'Collections', 'Tools'])
    expect(document.title).toBe('Asset Viewer – Lunar Client cosmetics viewer')
  })

  it('footer: disclaimer, catalog stats with both index hashes, GitHub', async () => {
    await open('/lunar/home')
    expect(stats.value).toMatchObject({ name: 'Lunar Client', items: 47 })
    const foot = $('.foot')!.textContent!
    expect(foot).toContain('Not affiliated with Lunar Client')
    expect(foot).toContain('Lunar Client: 47 items')
    expect($$('.foot code').map((c) => c.textContent)).toEqual(['8a23771', 'fd50b83'])
    expect($('.foot a')!.getAttribute('href')).toBe('https://github.com/prometheusreengineering/assetviewer')
  })

  it('essential is a coming-soon page', async () => {
    await open('/essential')
    expect($('.center h2')!.textContent).toBe('Essential is coming soon')
    expect(document.title).toBe('Essential · Asset Viewer')
  })

  it('old all-files links redirect to everything', async () => {
    const { router } = await open('/lunar/all-files')
    expect(router.currentRoute.value.path).toBe('/lunar/everything')
  })
})

describe('category grid', () => {
  it('shows the category items with a count and a page title', async () => {
    await open('/lunar/cloak')
    expect(count()).toBe('3 items')
    expect(cards()).toEqual(['Blue Cloak', '12', 'Unl'])
    expect(document.title).toBe('Cloaks · Asset Viewer')
    expect(menuItem('Cloaks').closest('.cat-active')).toBeTruthy()
  })

  it('search hides items and is mirrored to ?q=', async () => {
    const { router } = await open('/lunar/cloak')
    const input = $<HTMLInputElement>('input.search')!
    input.value = 'blue'
    input.dispatchEvent(new Event('input'))
    await settle()
    expect(cards()).toEqual(['Blue Cloak'])
    expect(count()).toBe('1 item')
    expect(router.currentRoute.value.query.q).toBe('blue')
  })

  it('a linked filter grays failing items and moves passing ones first; a linked sort orders them', async () => {
    const f = btoa(JSON.stringify([['animated', 'is', true]])).replace(/=+$/, '')
    await open(`/lunar/cloak?f=${f}&s=name:desc`)
    expect(cards()).toEqual(['Unl', 'Blue Cloak', '12'])
    expect($$('.card').map((c) => c.classList.contains('gray'))).toEqual([false, false, true])
    expect($('.chip .lbl')!.textContent).toContain('Animated: yes')
  })

  it('the sort is remembered per category', async () => {
    localStorage.setItem('assetviewer.sort.lunar.cloak', JSON.stringify([{ field: 'name', dir: 'desc' }]))
    await open('/lunar/cloak')
    expect(cards()).toEqual(['Unl', 'Blue Cloak', '12'])
    expect($('.sortchip')!.textContent).toContain('Name ↓')
  })

  it('selecting cards: count, Clear, Compare (2-4) opens ?cmp=', async () => {
    const { router } = await open('/lunar/cloak')
    const ticks = () => $$('.card .pick input')
    expect(byText('Compare', 'button')!.hasAttribute('disabled')).toBe(true)
    press(ticks()[0])
    await settle()
    expect($('.selcount')!.textContent).toBe('1 selected')
    expect(byText('Compare', 'button')!.hasAttribute('disabled')).toBe(true)
    expect($$('.card').map((c) => c.classList.contains('gray'))).toEqual([false, true, true])
    press(ticks()[2])
    await settle()
    expect(byText('Compare', 'button')!.hasAttribute('disabled')).toBe(false)
    expect(byText('Export (2)', 'button')).toBeTruthy()
    press(byText('Compare', 'button'))
    await settle(20)
    expect(router.currentRoute.value.query.cmp).toBe('3,unlisted:cosmetics/cloaks/unl.webp')
    expect($('.p-dialog-title')!.textContent).toBe('Compare 2 items')
  })

  it('Select all / Deselect all; changing category clears the selection', async () => {
    const { router } = await open('/lunar/cloak')
    press(byText('Select all', 'button'))
    await settle()
    expect($('.selcount')!.textContent).toBe('3 selected')
    press(byText('Deselect all', 'button'))
    await settle()
    expect($('.selcount')).toBeNull()
    press(byText('Select all', 'button'))
    await settle()
    await router.push('/lunar/hat')
    await settle(20)
    expect($('.selcount')).toBeNull()
  })

  it('list view is remembered and hides the zoom controls', async () => {
    await open('/lunar/cloak')
    expect($('.zoom')).toBeTruthy()
    press($$('.p-selectbutton .p-togglebutton')[1]!)
    await settle()
    expect(localStorage.getItem('assetviewer.view')).toBe('list')
    expect($$('.list .row:not(.head)')).toHaveLength(3)
    expect($('.zoom')).toBeNull()
  })

  it('opening a card puts it in the URL and shows the modal with info', async () => {
    const { router } = await open('/lunar/cloak')
    press($$('.card')[0]!)
    await settle(30)
    expect(router.currentRoute.value.query.item).toBe('3')
    expect($('.p-dialog-title')!.textContent).toBe('Blue Cloak')
    expect($('.info')!.textContent).toContain('Cloaks')
  })

  it('a deep link opens the modal directly', async () => {
    await open('/lunar/hat?item=1')
    expect($('.p-dialog-title')!.textContent).toBe('Crown')
  })

  it('3D cards load their models through the shared renderer once visible', async () => {
    await open('/lunar/cloak')
    FakeIntersectionObserver.intersectAll(true)
    await settle(50)
    expect($$('.card .pi-exclamation-triangle')).toHaveLength(0)
    expect(FakeWebGLRenderer.instances.length).toBeGreaterThan(0)
  })
})

describe('Everything and collections', () => {
  it('Everything asks first; remembering skips the question', async () => {
    const { router } = await open('/lunar/home')
    press(menuItem('Everything'))
    await settle()
    expect(dialog.value!.title).toBe('Open Everything?')
    expect(dialog.value!.message).toContain('all 47 items')
    dialog.value!.resolve(false)
    await settle()
    expect(router.currentRoute.value.path).toBe('/lunar/home')
    localStorage.setItem('assetviewer.skipEverythingWarning', '1')
    press(menuItem('Everything'))
    await settle(20)
    expect(router.currentRoute.value.path).toBe('/lunar/everything')
    expect(count()).toBe('47 items')
  })

  it('a collection page shows its items with a header bar; Favorites cannot be deleted', async () => {
    const c = useCollections('lunar')
    c.toggle('fav', '1')
    c.toggle('fav', '3')
    await open('/lunar/col-fav')
    expect($('.collname')!.textContent).toBe('Favorites')
    expect($('.collcount')!.textContent).toBe('2 items')
    expect(cards()).toEqual(['Crown', 'Blue Cloak'])
    expect(byText('Delete', '.collactions button')).toBeUndefined()
    expect(document.title).toBe('Favorites · Asset Viewer')
    // union of the fields of both categories
    press(byText('Filter', 'button'))
    await settle(10)
  })

  it('new collection from the sidebar; rename; delete goes back to Favorites', async () => {
    const { router } = await open('/lunar/home')
    press(menuItem('New collection'))
    await settle()
    dialog.value!.resolve('Mine')
    await settle(20)
    const mine = useCollections('lunar').all().find((x) => x.name === 'Mine')!
    expect(router.currentRoute.value.path).toBe(`/lunar/col-${mine.id}`)
    press(byText('Rename', 'button'))
    await settle()
    expect(dialog.value!.input).toBe('Mine')
    dialog.value!.resolve('Ours')
    await settle()
    expect($('.collname')!.textContent).toBe('Ours')
    press(byText('Delete', '.collactions button'))
    await settle()
    expect(dialog.value!.danger).toBe(true)
    dialog.value!.resolve(true)
    await settle(20)
    expect(router.currentRoute.value.path).toBe('/lunar/col-fav')
    expect(useCollections('lunar').get(mine.id)).toBeUndefined()
  })

  it('export downloads the collection JSON; import merges a file and reports it', async () => {
    useCollections('lunar').toggle('fav', '1')
    let blob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'))
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    await open('/lunar/col-fav')
    press(byText('Export', '.collactions button'))
    expect(clicked).toEqual(['favorites.json'])
    expect(JSON.parse(await blob!.text()).collections[0]).toEqual({ name: 'Favorites', items: [{ id: '1', name: 'Crown' }] })
    const input = $<HTMLInputElement>('.collactions input[type=file]')!
    const file = new File([JSON.stringify({ collections: [{ name: 'Favorites', items: ['3', '1'] }] })], 'c.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await settle(20)
    expect(dialog.value!.title).toBe('Import finished')
    expect(dialog.value!.message).toBe('Imported 1 item.')
    dialog.value!.resolve(true)
    Object.defineProperty(input, 'files', { value: [new File(['nope'], 'bad.json')], configurable: true })
    input.dispatchEvent(new Event('change'))
    await settle(20)
    expect(dialog.value!.title).toBe('Import failed')
  })

  it('the outfit builder page', async () => {
    await open('/lunar/outfit')
    expect($$('.slot > span').map((s) => s.textContent)).toContain('Hats')
    expect($('.toolbar')).toBeNull()
  })
})
