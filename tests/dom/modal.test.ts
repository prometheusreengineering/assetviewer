import { Mesh, type MeshLambertMaterial } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CosmeticModal from '../../src/components/CosmeticModal.vue'
import { playerEmoteId, showOnPlayer } from '../../src/skin'
import { wireframe } from '../../src/viewPrefs'
import { fakeModel, fakeProvider, ITEMS } from '../helpers/fakeProvider'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'
import { FakeWebGLRenderer } from '../helpers/webgl'

vi.mock('three', async (orig) => {
  const three = await orig<typeof import('three')>()
  const { FakeWebGLRenderer } = await import('../helpers/webgl')
  return { ...three, WebGLRenderer: FakeWebGLRenderer }
})

beforeEach(() => {
  FakeWebGLRenderer.instances = []
  showOnPlayer.value = false
  playerEmoteId.value = null
  wireframe.value = false
})

const menuLabels = async () => {
  press(byText('Download', 'button'))
  await settle()
  return $$('.dl-label').map((e) => e.textContent)
}

async function open(item = ITEMS[0]!, provider = fakeProvider()) {
  const m = await mountApp(CosmeticModal, { props: { provider, item: null } })
  await m.wrapper.setProps({ item })
  await settle(30)
  return { ...m, provider }
}

describe('CosmeticModal', () => {
  it('3D: loads the model into its own renderer with info rows and a download menu', async () => {
    const { provider } = await open()
    expect(provider.loadModel).toHaveBeenCalledWith(ITEMS[0])
    expect(provider.ensureDimensions).toHaveBeenCalled()
    expect($('.p-dialog-title')!.textContent).toBe('Model One')
    expect(FakeWebGLRenderer.instances).toHaveLength(1)
    expect($('.canvas canvas')).toBe(FakeWebGLRenderer.instances[0]!.domElement)
    await vi.waitFor(() => expect(FakeWebGLRenderer.instances[0]!.render).toHaveBeenCalled())
    expect($$('.info dt').map((e) => e.textContent)).toEqual(['Type', 'Name'])
    // one source file: offered as is, plus GLB
    expect(await menuLabels()).toEqual(['WEBP (.webp)', 'GLB (.glb)'])
    expect($('.help')).toBeTruthy()
  })

  it('several source files are offered as a ZIP listing their extensions', async () => {
    const provider = fakeProvider()
    provider.loadModel = vi.fn(async () => fakeModel({ files: [{ name: 'a.geo.json', data: new Uint8Array() }, { name: 'a.webp', data: new Uint8Array() }, { name: 'b.json', data: new Uint8Array() }] }))
    await open(ITEMS[0], provider)
    expect(await menuLabels()).toEqual(['ZIP (.json, .webp)', 'GLB (.glb)'])
  })

  it('image items show the image and offer the original file', async () => {
    const { provider } = await open(ITEMS[1])
    expect(provider.imageUrl).toHaveBeenCalledWith(ITEMS[1])
    expect(provider.imageFrames).toHaveBeenCalled()
    expect(FakeWebGLRenderer.instances).toHaveLength(0)
    expect(await menuLabels()).toEqual(['PNG (.png)'])
  })

  it('files show their text (or a binary note)', async () => {
    const { provider } = await open(ITEMS[2])
    expect(provider.rawFile).toHaveBeenCalled()
    expect($('pre.code')!.textContent).toBe('{"hello": 1}')
    expect(await menuLabels()).toEqual(['JSON (.json)'])
    const bin = fakeProvider()
    bin.rawFile = vi.fn(async () => ({ name: 'index', url: 'u', size: 2048 }))
    await open(ITEMS[2], bin)
    expect($$('pre.code').at(-1)!.textContent).toBe('Binary file, 2.00 KB. Use the download button.')
  })

  it('the animation picker shows only with states besides idle/main', async () => {
    const provider = fakeProvider()
    provider.loadModel = vi.fn(async () => fakeModel({ states: ['idle', 'main'], state: 'idle' }))
    const a = await open(ITEMS[0], provider)
    expect($$('.actions .p-select')).toHaveLength(0)
    a.wrapper.unmount()
    const p2 = fakeProvider()
    const model = fakeModel({ states: ['idle', 'elytra'], state: 'idle' })
    p2.loadModel = vi.fn(async () => model)
    await open(ITEMS[0], p2)
    expect($$('.actions .p-select')).toHaveLength(1)
    expect($('.actions .p-select')!.textContent).toContain('idle')
  })

  it('emotes get play/pause and a scrubber driving the timeline', async () => {
    const provider = fakeProvider()
    const timeline = { duration: 2, time: 0, paused: false, seek: vi.fn() }
    provider.loadModel = vi.fn(async () => fakeModel({ timeline }))
    const emote = { ...ITEMS[3]!, thumb: undefined }
    await open(emote, provider)
    expect($('.time')!.textContent).toBe('0.0 / 2.0 s')
    press($('button[title="Pause"]'))
    await nextTick()
    expect(timeline.paused).toBe(true)
    expect($('button[title="Play"]')).toBeTruthy()
    // emotes can't be worn
    expect(byText('Show on player', 'label')).toBeUndefined()
  })

  it('"Show on player" dresses a player instead and offers emote poses', async () => {
    const provider = fakeProvider()
    provider.dressPlayer = vi.fn(async () => fakeModel())
    await open(ITEMS[0], provider)
    expect(byText('Show on player', 'label')).toBeTruthy()
    showOnPlayer.value = true
    await settle(30)
    expect(provider.dressPlayer).toHaveBeenCalledWith([ITEMS[0]], undefined)
    expect($('.pose')).toBeTruthy()
    playerEmoteId.value = 'e1'
    await settle(30)
    expect(provider.dressPlayer).toHaveBeenLastCalledWith([ITEMS[0]], ITEMS[3])
  })

  it('wireframe applies to the model and follows the toggle', async () => {
    const provider = fakeProvider()
    const model = fakeModel()
    provider.loadModel = vi.fn(async () => model)
    wireframe.value = true
    await open(ITEMS[0], provider)
    const mat = (model.object.children[0] as Mesh).material as MeshLambertMaterial
    expect(mat.wireframe).toBe(true)
    wireframe.value = false
    await nextTick()
    expect(mat.wireframe).toBe(false)
  })

  it('pin makes the mask see-through; closing unpins and emits close', async () => {
    const { wrapper } = await open()
    press($('button .pi-thumbtack')!.closest('button'))
    await settle()
    expect($('.p-dialog-mask')!.classList.contains('pin-mask')).toBe(true)
    press($('.p-dialog-close-button'))
    await settle()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('switching items tears down the old model and renderer', async () => {
    const provider = fakeProvider()
    const first = fakeModel()
    provider.loadModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(fakeModel())
    const { wrapper } = await open(ITEMS[0], provider)
    await wrapper.setProps({ item: { ...ITEMS[0]!, id: 'm9', name: 'Other' } })
    await settle(30)
    expect(first.dispose).toHaveBeenCalled()
    expect(FakeWebGLRenderer.instances[0]!.disposed).toBe(true)
    await wrapper.setProps({ item: null })
    await settle()
    expect(FakeWebGLRenderer.instances[1]!.disposed).toBe(true)
  })

  it('a deep-linked item opens on mount; a load error is shown', async () => {
    const provider = fakeProvider()
    provider.loadModel = vi.fn(async () => {
      throw new Error('broken model')
    })
    await mountApp(CosmeticModal, { props: { provider, item: ITEMS[0]! } })
    await settle(30)
    expect(provider.loadModel).toHaveBeenCalled()
    expect($('.err')!.textContent).toContain('broken model')
  })

  it('copy link writes the page url', async () => {
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    await open()
    press(byText('Copy link', 'button'))
    await settle()
    expect(write).toHaveBeenCalledWith(location.href)
    expect(byText('Copied', 'button')).toBeTruthy()
  })
})
