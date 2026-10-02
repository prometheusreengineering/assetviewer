// The real app (hash router, PrimeVue, live CDN, WebGL) mounted in Chromium.
import Aura from '@primeuix/themes/aura'
import 'primeicons/primeicons.css'
import PrimeVue from 'primevue/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App as VueApp } from 'vue'
import App from '../../src/App.vue'
import { router } from '../../src/router'
import { dark } from '../../src/theme'
import '../../src/style.css'

let app: VueApp
const $ = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s)
const $$ = <E extends Element = HTMLElement>(s: string) => [...document.querySelectorAll<E>(s)]

beforeAll(async () => {
  const host = document.createElement('div')
  host.id = 'app'
  Object.assign(host.style, { height: '800px', display: 'flex', flexDirection: 'column' })
  document.body.append(host)
  location.hash = '#/lunar/cloak'
  app = createApp(App)
    .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } })
    .use(router)
  app.mount(host)
  await router.isReady()
})
afterAll(() => app.unmount())

describe('app in the browser', () => {
  it('loads the cloak category from the live CDN', async () => {
    await expect.poll(() => $$('.card').length, { timeout: 60_000 }).toBeGreaterThan(10)
    expect(document.title).toBe('Cloaks · Asset Viewer')
    expect($('.foot')!.textContent).toMatch(/Lunar Client: [\d,]+ items/)
    // the shared WebGL canvas sits over the grid
    expect($('.grid-wrap canvas')).toBeTruthy()
  })

  it('search narrows the grid and lands in the URL', async () => {
    const before = $$('.card').length
    const input = $<HTMLInputElement>('input.search')!
    input.value = 'zzzz-not-a-cloak'
    input.dispatchEvent(new Event('input'))
    await expect.poll(() => $$('.card').length).toBe(0)
    await expect.poll(() => location.hash).toContain('q=zzzz-not-a-cloak')
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await expect.poll(() => $$('.card').length).toBe(before)
  })

  it('opening a card shows the 3D preview with a WebGL canvas', async () => {
    $$('.card')[0]!.click()
    await expect.poll(() => $('.p-dialog .canvas canvas'), { timeout: 60_000 }).toBeTruthy()
    await expect.poll(() => location.hash).toContain('item=')
    $('.p-dialog-close-button')!.click()
    await expect.poll(() => $('.p-dialog')).toBeNull()
  })

  it('the theme button flips .app-dark', async () => {
    const was = dark.value
    $('.controls button')!.click()
    await expect.poll(() => document.documentElement.classList.contains('app-dark')).toBe(!was)
    $('.controls button')!.click()
    await expect.poll(() => document.documentElement.classList.contains('app-dark')).toBe(was)
  })

  it('navigates to the home page from the sidebar', async () => {
    const home = $$('.side .p-menu-item-content').find((e) => e.textContent!.trim() === 'Home')!
    home.click()
    await expect.poll(() => $('.home h1')?.textContent).toBe('Asset Viewer')
    await expect.poll(() => location.hash).toBe('#/lunar/home')
  })
})
