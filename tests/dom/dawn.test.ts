// The whole app on the Dawn fixture CDN (the real Dawn provider).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import { stats } from '../../src/stats'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installDawnCdn } from '../helpers/cdnMock'
import { $, $$, mountApp, settle } from '../helpers/mount'
import { FakeIntersectionObserver, FakeWebGLRenderer } from '../helpers/webgl'
import { DAWN_FILES } from '../fixtures/dawn'

vi.mock('three', async (orig) => {
  const three = await orig<typeof import('three')>()
  const { FakeWebGLRenderer } = await import('../helpers/webgl')
  return { ...three, WebGLRenderer: FakeWebGLRenderer }
})

let cdn: ReturnType<typeof installDawnCdn>
beforeAll(() => {
  cdn = installDawnCdn(DAWN_FILES)
})
beforeEach(() => {
  vi.stubGlobal('fetch', cdn.fetch)
  installBitmapStubs()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  FakeWebGLRenderer.instances = []
  FakeIntersectionObserver.instances = []
})

const open = async (path: string) => {
  const m = await mountApp(App, { path })
  await settle(20)
  return m
}
const menu = () => $$('.side .p-menu-item-label').map((e) => e.textContent!.trim())

describe('Dawn in the app', () => {
  it('/dawn goes home with Dawn credits; the sidebar lists the Dawn categories', async () => {
    const { router } = await open('/dawn')
    expect(router.currentRoute.value.path).toBe('/dawn/home')
    expect($('.home .lead')!.textContent).toContain('Dawn Client cosmetics')
    expect($('.home')!.textContent).toContain('assets.dawn.gg')
    expect(menu().slice(0, 4)).toEqual(['Home', 'Everything (15)', 'Hats (3)', 'Wings (1)'])
    expect(menu()).toContain('Armor trims (1)')
    expect(menu()).toContain('Language files (1)')
    expect(document.title).toBe('Asset Viewer – Dawn Client cosmetics viewer')
  })

  it('footer names Dawn and its index hash', async () => {
    await open('/dawn/home')
    expect(stats.value).toMatchObject({ name: 'Dawn Client', items: 15, files: DAWN_FILES.length })
    expect($('.foot')!.textContent).toContain('Not affiliated with Dawn Client. Assets are served from assets.dawn.gg.')
    expect($$('.foot code')).toHaveLength(1)
  })

  it('a category grid shows its cards', async () => {
    await open('/dawn/hats')
    FakeIntersectionObserver.intersectAll()
    await settle(20)
    expect($$('.card .name').map((e) => e.textContent)).toEqual(['Test Crown', 'Test Hat', 'Test Hat Blue'])
    expect($('.toolbar .count')!.textContent).toContain('3 items')
  })
})
