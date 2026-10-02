import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CompareDialog from '../../src/components/CompareDialog.vue'
import CosmeticGrid from '../../src/components/CosmeticGrid.vue'
import FileBrowser from '../../src/components/FileBrowser.vue'
import OutfitBuilder from '../../src/components/OutfitBuilder.vue'
import { skinName } from '../../src/skin'
import { freeRotate } from '../../src/viewPrefs'
import type { CategoryDef, CosmeticItem } from '../../src/providers/types'
import { fakeModel, fakeProvider, ITEMS } from '../helpers/fakeProvider'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'
import { FakeIntersectionObserver, FakeWebGLRenderer } from '../helpers/webgl'

vi.mock('three', async (orig) => {
  const three = await orig<typeof import('three')>()
  const { FakeWebGLRenderer } = await import('../helpers/webgl')
  return { ...three, WebGLRenderer: FakeWebGLRenderer }
})

beforeEach(() => {
  FakeWebGLRenderer.instances = []
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

describe('CompareDialog', () => {
  const two = [ITEMS[0]!, ITEMS[1]!]
  it('one renderer for all panes; images and files get their own pane content', async () => {
    const provider = fakeProvider()
    await mountApp(CompareDialog, { props: { provider, items: [...two, ITEMS[2]!], visible: true } })
    await settle(30)
    expect($('.p-dialog-title')!.textContent).toBe('Compare 3 items')
    expect(FakeWebGLRenderer.instances).toHaveLength(1)
    expect($$('.pane')).toHaveLength(3)
    expect($$('.pane .label').map((e) => e.textContent)).toEqual(['Model One', 'Image One', 'File One'])
    expect(provider.loadModel).toHaveBeenCalledTimes(1)
    expect(provider.imageUrl).toHaveBeenCalledWith(ITEMS[1])
    expect($('.pane .file')).toBeTruthy()
  })
  it('a field table marks rows whose values differ', async () => {
    const provider = fakeProvider()
    provider.info = vi.fn((it: CosmeticItem): Record<string, string> => (it.id === 'm1' ? { Type: '3D', Same: 'x', Only: 'here' } : { Type: '2D', Same: 'x' }))
    await mountApp(CompareDialog, { props: { provider, items: two, visible: true } })
    await settle(30)
    const rows = $$('.fields tr').slice(1)
    expect(rows.map((r) => [r.querySelector('th')!.textContent, r.classList.contains('differs')])).toEqual([
      ['Type', true],
      ['Same', false],
      ['Only', true],
    ])
    expect(rows[2]!.textContent).toContain('—')
  })
  it('a pane that fails shows the error; hiding disposes everything', async () => {
    const provider = fakeProvider()
    const ok = fakeModel()
    provider.loadModel = vi.fn().mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error('nope'))
    const { wrapper } = await mountApp(CompareDialog, { props: { provider, items: [ITEMS[0]!, { ...ITEMS[0]!, id: 'm2' }], visible: true } })
    await settle(30)
    expect($('.pane .err')!.textContent).toContain('nope')
    await wrapper.setProps({ visible: false })
    await settle()
    expect(ok.dispose).toHaveBeenCalled()
    expect(FakeWebGLRenderer.instances[0]!.disposed).toBe(true)
  })
  it('the free-rotate preference swaps the controls live', async () => {
    freeRotate.value = false
    await mountApp(CompareDialog, { props: { provider: fakeProvider(), items: two, visible: true } })
    await settle(30)
    freeRotate.value = true
    await nextTick()
    freeRotate.value = false
  })
})

describe('CosmeticGrid', () => {
  const props = (extra: Record<string, unknown> = {}) => ({ provider: fakeProvider(), items: ITEMS, cols: 3, selected: new Set<string>(), passes: null, ...extra })
  it('cards in the requested number of columns, drawn by one shared renderer', async () => {
    const { wrapper } = await mountApp(CosmeticGrid, { props: props() })
    expect(wrapper.findAll('.card')).toHaveLength(4)
    expect(wrapper.find('.grid').attributes('style')).toContain('repeat(3, minmax(0, 1fr))')
    expect(FakeWebGLRenderer.instances).toHaveLength(1)
    expect(wrapper.find('.grid-wrap canvas').exists()).toBe(true)
  })
  it('list view', async () => {
    const { wrapper } = await mountApp(CosmeticGrid, { props: props({ view: 'list' }) })
    expect(wrapper.findAll('.row:not(.head)')).toHaveLength(4)
    expect(wrapper.find('.grid').exists()).toBe(false)
  })
  it('gray states: unselected while selecting, and scope items failing the filter', async () => {
    const a = await mountApp(CosmeticGrid, { props: props({ selected: new Set(['m1', 'i1']), passes: new Set(['m1']) }) })
    const gray = () => a.wrapper.findAll('.card').map((c) => c.classes().includes('gray'))
    expect(gray()).toEqual([false, true, true, true])
    await a.wrapper.setProps({ selected: new Set(), passes: new Set(['m1', 'f1']) })
    expect(gray()).toEqual([false, true, false, true])
    await a.wrapper.setProps({ passes: null })
    expect(gray()).toEqual([false, false, false, false])
  })
  it('clicking a card opens it via ?item=, closing removes it', async () => {
    const { wrapper, router } = await mountApp(CosmeticGrid, { props: props(), path: '/lunar/hat?q=x' })
    await wrapper.findAll('.card')[1]!.trigger('click')
    await settle(30)
    expect(router.currentRoute.value.query).toEqual({ q: 'x', item: 'i1' })
    expect($('.p-dialog-title')!.textContent).toBe('Image One')
    press($('.p-dialog-close-button'))
    await settle()
    expect(router.currentRoute.value.query).toEqual({ q: 'x' })
  })
  it('?cmp= with 2+ known items opens the compare dialog', async () => {
    const { router } = await mountApp(CosmeticGrid, { props: props(), path: '/lunar/hat?cmp=m1,nope,i1' })
    await settle(30)
    expect($('.p-dialog-title')!.textContent).toBe('Compare 2 items')
    press($('.p-dialog-close-button'))
    await settle()
    expect(router.currentRoute.value.query.cmp).toBeUndefined()
  })
  it('select events bubble up', async () => {
    const { wrapper } = await mountApp(CosmeticGrid, { props: props() })
    press(wrapper.findAll('.card .pick input')[2]!.element)
    await nextTick()
    expect(wrapper.emitted('select')![0]).toEqual(['f1'])
  })
  it('unmount detaches the shared renderer', async () => {
    const { wrapper } = await mountApp(CosmeticGrid, { props: props() })
    wrapper.unmount()
    expect(FakeWebGLRenderer.instances[0]!.disposed).toBe(true)
  })
})

describe('OutfitBuilder', () => {
  const HATS: CosmeticItem[] = [
    { id: 'h1', name: 'Hat 1', category: 'hat', render: '3d', fields: {} },
    { id: 'h2', name: 'Hat 2', category: 'hat', render: '3d', fields: {} },
  ]
  const CLOAKS: CosmeticItem[] = [{ id: 'c1', name: 'Cloak 1', category: 'cloak', render: '3d', fields: {} }]
  const EMOTES: CosmeticItem[] = [{ id: 'e1', name: 'Wave', category: 'emotes', render: '3d', fields: {} }]
  const CATS: CategoryDef[] = [
    { id: 'everything', label: 'Everything', icon: 'pi-th', count: 4, group: '' },
    { id: 'hat', label: 'Hats', icon: 'pi-crown', count: 2, group: 'Cosmetics (3D)' },
    { id: 'cloak', label: 'Cloaks', icon: 'pi-bookmark', count: 1, group: 'Cosmetics (3D)' },
    { id: 'emotes', label: 'Emotes', icon: 'pi-video', count: 1, group: 'Cosmetics (3D)' },
    { id: 'badges', label: 'Badges', icon: 'pi-verified', count: 0, group: 'Resources (2D)' },
  ]
  const outfitProvider = () => {
    const p = fakeProvider([...HATS, ...CLOAKS, ...EMOTES])
    p.categories = () => CATS
    p.dressPlayer = vi.fn(async () => fakeModel())
    return p
  }
  it('one slot per wearable category; restores the outfit from the URL and dresses the player', async () => {
    const provider = outfitProvider()
    await mountApp(OutfitBuilder, { props: { provider }, path: '/lunar/outfit?o=hat:h2,cloak:c1&e=e1' })
    await settle(30)
    expect($$('.slot > span').map((s) => s.textContent)).toEqual(['Hats', 'Cloaks'])
    expect(provider.dressPlayer).toHaveBeenLastCalledWith([HATS[1], CLOAKS[0]], EMOTES[0])
    expect($('.count')!.textContent).toBe('2 worn')
    expect(FakeWebGLRenderer.instances).toHaveLength(1)
  })
  it('falls back to the saved outfit; Clear empties it and updates URL and storage', async () => {
    localStorage.setItem('assetviewer.outfit', JSON.stringify({ o: 'hat:h1' }))
    const provider = outfitProvider()
    const { router } = await mountApp(OutfitBuilder, { props: { provider }, path: '/lunar/outfit' })
    await settle(30)
    expect(provider.dressPlayer).toHaveBeenLastCalledWith([HATS[0]], undefined)
    press(byText('Clear', 'button'))
    await settle(30)
    expect(provider.dressPlayer).toHaveBeenLastCalledWith([], undefined)
    expect(router.currentRoute.value.query.o).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('assetviewer.outfit')!)).toEqual({})
  })
  it('Random fills included slots; the dice excludes a slot and is remembered', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const provider = outfitProvider()
    const { router } = await mountApp(OutfitBuilder, { props: { provider }, path: '/lunar/outfit?o=cloak:c1' })
    await settle(30)
    // keep the cloak slot as it is
    press($$('.dice')[1]!)
    await settle()
    expect(JSON.parse(localStorage.getItem('assetviewer.outfit.random')!)).toEqual(['cloak'])
    expect($$('.dice')[1]!.classList.contains('off')).toBe(true)
    press(byText('Random', 'button'))
    await settle(30)
    expect(router.currentRoute.value.query.o).toBe('cloak:c1,hat:h2')
    // excluding every slot disables Random
    press($$('.dice')[0]!)
    await settle()
    expect(byText('Random', 'button')!.hasAttribute('disabled')).toBe(true)
  })
  it('ignores malformed outfit links and storage', async () => {
    localStorage.setItem('assetviewer.outfit', '{bad')
    localStorage.setItem('assetviewer.outfit.random', '"nope"')
    const provider = outfitProvider()
    await mountApp(OutfitBuilder, { props: { provider }, path: '/lunar/outfit?o=hat,:x,cloak:c1,hat:missing' })
    await settle(30)
    // "hat:missing" wins for hat but isn't a known item; the cloak stays
    expect(provider.dressPlayer).toHaveBeenLastCalledWith([CLOAKS[0]], undefined)
  })
  it('a timeline shows play/pause; a dress error is shown; the skin name triggers a rebuild', async () => {
    const provider = outfitProvider()
    const timeline = { duration: 1, time: 0, paused: false, seek: vi.fn() }
    provider.dressPlayer = vi.fn().mockResolvedValueOnce(fakeModel({ timeline })).mockRejectedValueOnce(new Error('dress failed'))
    await mountApp(OutfitBuilder, { props: { provider }, path: '/lunar/outfit?e=e1' })
    await settle(30)
    press($('.controls .pi-pause')!.closest('button'))
    await nextTick()
    expect(timeline.paused).toBe(true)
    skinName.value = 'Notch'
    await settle(30)
    expect($('.err')!.textContent).toContain('dress failed')
    skinName.value = ''
  })
})

describe('FileBrowser', () => {
  it('lists indexed files, filters by name or path and opens the owning item', async () => {
    const provider = fakeProvider()
    provider.indexedFiles = () => [
      { name: 'Crown', path: 'cosmetics/crown.gek.json', hash: 'a', size: 2048 },
      { name: 'Wing (file)', path: 'cosmetics/wings/w.webp', hash: 'b', size: 10 },
    ]
    provider.fileItem = vi.fn(() => ITEMS[2]!)
    const { wrapper } = await mountApp(FileBrowser, { props: { provider } })
    expect(wrapper.find('.count').text()).toBe('2 files')
    await wrapper.find('input').setValue('wings/')
    expect(wrapper.find('.count').text()).toBe('1 files')
    await wrapper.find('input').setValue('CROWN')
    expect(wrapper.find('.count').text()).toBe('1 files')
  })
})
