// Essential in the app: the setup panel, then the viewer's own (here: in-memory) files.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import { connect, forget } from '../../src/providers/essential'
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
    expect($('.foot')!.textContent).toContain('Essential: 5 items · 19 files')
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
})
