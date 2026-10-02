import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CollectionPicker from '../../src/components/CollectionPicker.vue'
import CosmeticCard from '../../src/components/CosmeticCard.vue'
import CosmeticList from '../../src/components/CosmeticList.vue'
import ExportButton from '../../src/components/ExportButton.vue'
import { useCollections } from '../../src/collections'
import { dialog } from '../../src/dialogs'
import { fakeProvider, ITEMS } from '../helpers/fakeProvider'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'
import { FakeIntersectionObserver } from '../helpers/webgl'

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  // collections are module state shared across tests: start each test empty
  const c = useCollections('lunar')
  for (const l of [...c.all()]) l.id === 'fav' ? l.items.splice(0) : c.remove(l.id)
})

describe('CollectionPicker', () => {
  it('shows the count and fills the bookmark once saved', async () => {
    const { wrapper } = await mountApp(CollectionPicker, { props: { provider: 'lunar', itemId: 'x' } })
    expect(wrapper.find('.n').text()).toBe('0')
    expect(wrapper.find('i.pi-bookmark').exists()).toBe(true)
    expect(wrapper.find('button').attributes('title')).toBe('Add to a collection')
    useCollections('lunar').toggle('fav', 'x')
    await nextTick()
    expect(wrapper.find('.n').text()).toBe('1')
    expect(wrapper.find('i.pi-bookmark-fill').exists()).toBe(true)
    expect(wrapper.find('button').attributes('title')).toBe('In 1 collection')
  })

  it('lists collections with the saved ones first (fixed while open), searchable, toggleable', async () => {
    const c = useCollections('lunar')
    const a = c.create('Alpha')
    const b = c.create('Beta')
    c.toggle(b.id, 'x')
    const { wrapper } = await mountApp(CollectionPicker, { props: { provider: 'lunar', itemId: 'x' } })
    await wrapper.find('button').trigger('click')
    await settle(10)
    const names = () => $$('.panel .row > span').map((s) => s.textContent)
    expect(names()).toEqual(['Beta', 'Favorites', 'Alpha'])
    // ticking Alpha doesn't reorder while open
    press($$('.panel .row')[2]!.querySelector('input'))
    await settle()
    expect(c.has(a.id, 'x')).toBe(true)
    expect(names()).toEqual(['Beta', 'Favorites', 'Alpha'])
    const q = $<HTMLInputElement>('.panel input[type="text"], .panel input:not([type])')!
    q.value = 'fav'
    q.dispatchEvent(new Event('input'))
    await nextTick()
    expect(names()).toEqual(['Favorites'])
    q.value = 'zzz'
    q.dispatchEvent(new Event('input'))
    await nextTick()
    expect($('.panel .none')!.textContent).toBe('No collections match.')
  })

  it('"New collection…" asks for a name, creates it and adds the item', async () => {
    const { wrapper } = await mountApp(CollectionPicker, { props: { provider: 'lunar', itemId: 'x' } })
    await wrapper.find('button').trigger('click')
    await settle(10)
    press(byText('New collection', 'button'))
    await settle()
    expect(dialog.value!.title).toBe('New collection')
    dialog.value!.resolve('Shiny')
    await settle()
    const c = useCollections('lunar')
    const shiny = c.all().find((x) => x.name === 'Shiny')!
    expect(shiny.items).toEqual(['x'])
    expect(wrapper.find('.n').text()).toBe('1')
  })

  it('cancelling the name creates nothing', async () => {
    const { wrapper } = await mountApp(CollectionPicker, { props: { provider: 'lunar', itemId: 'x' } })
    await wrapper.find('button').trigger('click')
    await settle(10)
    press(byText('New collection', 'button'))
    await settle()
    dialog.value!.resolve(false)
    await settle()
    expect(useCollections('lunar').all()).toHaveLength(1)
  })
})

describe('CosmeticList', () => {
  it('renders a row per item with category, type, ext and size; gray and selected states', async () => {
    const grayOf = (id: string) => id === 'i1'
    const { wrapper } = await mountApp(CosmeticList, { props: { items: ITEMS, selected: new Set(['m1']), grayOf } })
    const rows = wrapper.findAll('.row:not(.head)')
    expect(rows).toHaveLength(4)
    expect([...rows[0]!.element.children].map((s) => s.textContent).slice(1)).toEqual(['Model One', 'Hats', '3D', 'json', '2.00 KB'])
    expect(rows[2]!.find('.num').text()).toBe('')
    expect(rows[0]!.classes()).toContain('selected')
    expect(rows[1]!.classes()).toContain('gray')
    expect(wrapper.find('.head').text()).toContain('Name')
  })
  it('row click opens, checkbox selects without opening', async () => {
    const { wrapper } = await mountApp(CosmeticList, { props: { items: ITEMS, selected: new Set<string>(), grayOf: () => false } })
    await wrapper.findAll('.row:not(.head)')[1]!.trigger('click')
    expect(wrapper.emitted('open')![0]).toEqual([ITEMS[1]])
    press(wrapper.findAll('.row:not(.head)')[2]!.find('input').element)
    await nextTick()
    expect(wrapper.emitted('select')![0]).toEqual(['f1'])
    expect(wrapper.emitted('open')).toHaveLength(1)
  })
})

describe('CosmeticCard', () => {
  const renderer = () => ({ add: vi.fn(), remove: vi.fn() })
  const mountCard = async (item = ITEMS[0]!, props: Record<string, unknown> = {}, provider = fakeProvider()) => {
    const r = renderer()
    const m = await mountApp(CosmeticCard, { props: { provider, item, ...props }, global: { provide: { renderer: r } } })
    return { ...m, r, provider }
  }

  it('loads its 3D model only when visible, into a shared-renderer slot; releases it when hidden', async () => {
    const { wrapper, r, provider } = await mountCard()
    expect(provider.loadModel).not.toHaveBeenCalled()
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    expect(provider.loadModel).toHaveBeenCalledWith(ITEMS[0])
    expect(r.add).toHaveBeenCalledOnce()
    const slot = r.add.mock.calls[0]![0]
    expect(slot.el).toBe(wrapper.find('.view').element)
    const model = await (provider.loadModel as ReturnType<typeof vi.fn>).mock.results[0]!.value
    FakeIntersectionObserver.intersectAll(false)
    await settle()
    expect(r.remove).toHaveBeenCalledWith(slot)
    expect(model.dispose).toHaveBeenCalled()
  })

  it('the gray prop reaches the slot', async () => {
    const { wrapper, r } = await mountCard(ITEMS[0], { gray: true })
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    const slot = r.add.mock.calls[0]![0]
    expect(slot.gray).toBe(true)
    await wrapper.setProps({ gray: false })
    expect(slot.gray).toBe(false)
    expect(wrapper.classes()).not.toContain('gray')
  })

  it('images show via imageUrl with their frames; files and name-only items show a tile', async () => {
    const img = await mountCard(ITEMS[1])
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    expect(img.provider.imageFrames).toHaveBeenCalled()
    expect(img.provider.imageUrl).toHaveBeenCalledWith(ITEMS[1])
    expect(img.wrapper.findComponent({ name: 'AnimatedImage' }).props()).toMatchObject({ src: 'blob:i1', frametimeMs: 100 })
    img.wrapper.unmount()
    const file = await mountCard(ITEMS[2])
    expect(file.wrapper.find('.filetile').text()).toContain('json')
    file.wrapper.unmount()
    const emote = await mountCard(ITEMS[3])
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    expect(emote.wrapper.find('.filetile').text()).toContain('3D')
    expect(emote.provider.loadModel).not.toHaveBeenCalled()
  })

  it('a failed load shows the error icon', async () => {
    const provider = fakeProvider()
    provider.loadModel = vi.fn(async () => {
      throw new Error('bad')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = await mountCard(ITEMS[0], {}, provider)
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    expect(wrapper.find('.pi-exclamation-triangle').exists()).toBe(true)
  })

  it('click opens; the checkbox and bookmark do not', async () => {
    const { wrapper } = await mountCard(ITEMS[0], { selecting: true, selected: true })
    expect(wrapper.classes()).toContain('selected')
    expect(wrapper.find('.pick').classes()).toContain('show')
    await wrapper.find('.card').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    press(wrapper.find('.pick input').element)
    await nextTick()
    expect(wrapper.emitted('select')).toHaveLength(1)
    await wrapper.find('.coll button').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('a saved item keeps its bookmark visible', async () => {
    useCollections('lunar').toggle('fav', 'm1')
    const { wrapper } = await mountCard()
    expect(wrapper.classes()).toContain('saved')
    expect(wrapper.find('.coll').classes()).toContain('show')
  })

  it('unmounting disconnects and releases', async () => {
    const { wrapper, r } = await mountCard()
    FakeIntersectionObserver.intersectAll(true)
    await settle()
    wrapper.unmount()
    expect(r.remove).toHaveBeenCalled()
    expect(FakeIntersectionObserver.instances[0]!.els.size).toBe(0)
  })
})

describe('ExportButton', () => {
  const capture = () => {
    const out: { name: string; blob: Blob }[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      out.push({ name: '', blob: b as Blob })
      return 'blob:zip'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      out.at(-1)!.name = this.download
    })
    return out
  }

  it('is disabled without items and labels the count', async () => {
    const empty = await mountApp(ExportButton, { props: { provider: fakeProvider(), items: [], name: 'x' } })
    expect(empty.wrapper.find('button').attributes('disabled')).toBeDefined()
    expect(empty.wrapper.text()).toContain('Export')
    empty.wrapper.unmount()
    const some = await mountApp(ExportButton, { props: { provider: fakeProvider(), items: ITEMS.slice(0, 2), name: 'x' } })
    expect(some.wrapper.text()).toContain('Export (2)')
  })

  it('zips every item under category/name, stores images uncompressed and downloads', async () => {
    const out = capture()
    const provider = fakeProvider()
    const items = [ITEMS[0]!, ITEMS[1]!, { ...ITEMS[0]!, id: 'm2' }]
    const { wrapper } = await mountApp(ExportButton, { props: { provider, items, name: 'My Hats!' } })
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(out).toHaveLength(1), { timeout: 3000 })
    expect(out[0]!.name).toBe('my_hats.zip')
    const files = unzipSync(new Uint8Array(await out[0]!.blob.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['hat/image_one/i1.png', 'hat/image_one/model.json', 'hat/model_one/m1.png', 'hat/model_one/model.json', 'hat/model_one_m2/m2.png', 'hat/model_one_m2/model.json'])
    await settle()
    expect($('.p-dialog')!.textContent).toContain('Downloaded')
    expect($('.p-dialog')!.textContent).toContain('3 items')
  })

  it('lists items that failed', async () => {
    const out = capture()
    const provider = fakeProvider()
    provider.sourceFiles = vi.fn(async (it) => {
      if (it.id === 'i1') throw new Error('nope')
      return [{ name: 'a.txt', data: new Uint8Array([1]) }]
    })
    const { wrapper } = await mountApp(ExportButton, { props: { provider, items: ITEMS.slice(0, 2), name: 'x' } })
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(out).toHaveLength(1), { timeout: 3000 })
    await settle()
    expect($('.failed summary')!.textContent).toBe('1 item failed')
    expect($('.failed')!.textContent).toContain('Image One: Error: nope')
  })

  it('big exports ask first and can be cancelled', async () => {
    const provider = fakeProvider()
    provider.estimateSize = vi.fn(() => 200e6)
    const { wrapper } = await mountApp(ExportButton, { props: { provider, items: ITEMS.slice(0, 1), name: 'x' } })
    await wrapper.find('button').trigger('click')
    await settle()
    expect($('.p-dialog')!.textContent).toContain('1 items, about 190.73 MB of source files.')
    expect(provider.sourceFiles).not.toHaveBeenCalled()
    press(byText('Cancel', 'button'))
    await settle()
    expect($('.p-dialog')).toBeNull()
    await wrapper.find('button').trigger('click')
    await settle()
    press(byText('Export', '.p-dialog button'))
    await settle()
    expect(provider.sourceFiles).toHaveBeenCalled()
  })
})
