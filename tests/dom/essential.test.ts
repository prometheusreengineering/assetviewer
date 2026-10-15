// Essential in the app: the setup panel, then the viewer's own (here: in-memory) files.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import { Group } from 'three'
import { connect, essentialProvider, forget } from '../../src/providers/essential'
import { memorySource } from '../../src/providers/essential/localData'
import { essentialFixture } from '../fixtures/essential'
import { installBitmapStubs } from '../helpers/bitmaps'
import { $, $$, byText, mountApp, settle } from '../helpers/mount'
import { FakeIntersectionObserver, FakeWebGLRenderer } from '../helpers/webgl'

vi.mock('three', async (orig) => {
  const three = await orig<typeof import('three')>()
  const { FakeWebGLRenderer } = await import('../helpers/webgl')
  return { ...three, WebGLRenderer: FakeWebGLRenderer }
})

const fx = essentialFixture()
beforeEach(async () => {
  installBitmapStubs()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('caches', undefined)
  FakeWebGLRenderer.instances = []
  FakeIntersectionObserver.instances = []
  await forget()
})

describe('Essential setup', () => {
  it('shows the folder setup, then the catalog once the files are connected', async () => {
    const { router } = await mountApp(App, { path: '/essential/hat' })
    await settle(20)
    expect($('.setup')).not.toBeNull()
    expect($$('.card')).toHaveLength(0)
    await connect({ dumps: memorySource(fx.dumps), cache: memorySource(fx.cache) })
    await settle(30)
    expect($('.setup')).toBeNull()
    expect(router.currentRoute.value.path).toBe('/essential/hat')
    FakeIntersectionObserver.intersectAll()
    await settle(20)
    expect($$('.card .name').map((e) => e.textContent)).toEqual(['Test Hat'])
    expect($('.foot')!.textContent).toContain('Essential: 5 items · 22 files')
    expect($('.foot')!.textContent).not.toContain('index')
  })

  it('the two folder fields connect the dumps and the cache (Chrome refuses AppData in its folder picker)', async () => {
    await mountApp(App, { path: '/essential/hat' })
    await settle(20)
    expect($('.setup .path')!.textContent).toBe('%APPDATA%\\.minecraft\\prometheus\\essential\\dumps')
    // a folder pick: files with paths relative to the parent of the chosen folder
    const pick = (input: HTMLInputElement, folder: string, files: Record<string, Uint8Array | string>) => {
      const list = Object.entries(files).map(([path, body]) => {
        const f = new File([typeof body === 'string' ? body : (body.slice().buffer as ArrayBuffer)], path.split('/').pop()!)
        Object.defineProperty(f, 'webkitRelativePath', { value: `${folder}/${path}` })
        return f
      })
      Object.defineProperty(input, 'files', { value: list, configurable: true })
      input.dispatchEvent(new Event('change'))
    }
    const [dumpsInput, cacheInput] = $$<HTMLInputElement>('.setup input[type=file]')
    expect(byText('Show my cosmetics', 'button')!.hasAttribute('disabled')).toBe(true)
    pick(dumpsInput!, 'dumps', fx.dumps)
    await settle()
    // Both folders are needed.
    expect(byText('Show my cosmetics', 'button')!.hasAttribute('disabled')).toBe(true)
    pick(cacheInput!, 'cosmetic-cache', fx.cache)
    await settle()
    expect($('.setup .picked')!.textContent).toContain('6 files')
    byText('Show my cosmetics', 'button')!.click()
    await settle(40)
    expect($('.setup')).toBeNull()
    FakeIntersectionObserver.intersectAll()
    await settle(20)
    expect($$('.card .name').map((e) => e.textContent)).toEqual(['Test Hat'])
  })

  it('the modal offers the colour variants', async () => {
    await connect({ dumps: memorySource(fx.dumps), cache: memorySource(fx.cache) })
    await mountApp(App, { path: '/essential/hat?item=TEST_HAT' })
    await settle(60)
    const sel = $('.p-dialog .variant')
    expect(sel).not.toBeNull()
    expect(sel!.textContent).toContain('blue')
  })

  it('outfit builder: Essential emotes as poses, armor pieces and mode, and mutually exclusive slots', async () => {
    await connect({ dumps: memorySource(fx.dumps), cache: memorySource(fx.cache) })
    const blank = () => ({ object: new Group(), files: [], frames: 1, states: [], state: '', setState() {}, tick() {}, dispose() {} })
    const dress = vi.spyOn(essentialProvider, 'dressPlayer').mockImplementation(async () => blank())
    localStorage.removeItem('assetviewer.outfit.armor.essential')
    await mountApp(App, { path: '/essential/outfit?o=hat:TEST_HAT' })
    await settle(30)
    // the pose picker lists Essential's emote category
    expect($('.controls .pose')).not.toBeNull()
    expect(dress).toHaveBeenLastCalledWith([essentialProvider.itemById!('TEST_HAT')], undefined, { armor: [], armorMode: 'armor' })
    byText('Helmet', 'button')!.click()
    byText('Boots', 'button')!.click()
    await settle(10)
    expect(dress).toHaveBeenLastCalledWith(expect.any(Array), undefined, { armor: ['helmet', 'boots'], armorMode: 'armor' })
    expect(JSON.parse(localStorage.getItem('assetviewer.outfit.armor.essential')!)).toEqual({ pieces: ['helmet', 'boots'], mode: 'armor' })
    // Random fills every slot; the wings can't be worn with the hat (the hat's slot is kept: its dice is on too, it comes first)
    byText('Random', 'button')!.click()
    await settle(20)
    expect($('.note')!.textContent).toContain("Test Wings (can't be worn with Test Hat)")
    const worn = (dress.mock.lastCall![0] as { id: string }[]).map((i) => i.id).sort()
    expect(worn).toContain('TEST_HAT')
    expect(worn).not.toContain('TEST_WINGS')
    dress.mockRestore()
  })
})
