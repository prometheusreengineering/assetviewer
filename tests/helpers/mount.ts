import Aura from '@primeuix/themes/aura'
import { flushPromises, mount, type ComponentMountingOptions } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Component } from 'vue'
import ProviderView from '../../src/views/ProviderView.vue'

/** The app's routes on an in-memory history. */
export function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/lunar' },
      { path: '/:provider(lunar|essential)/:category?', component: ProviderView, props: true },
    ],
  })
}

/** Mounts with PrimeVue (Aura) and a router at `path`, attached to the document so teleports work. */
export async function mountApp<C extends Component>(component: C, options: ComponentMountingOptions<C> & { path?: string } = {}) {
  const router = testRouter()
  await router.push(options.path ?? '/lunar/hat')
  await router.isReady()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrapper = mount(component, {
    attachTo: host,
    ...options,
    global: {
      plugins: [[PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } }], router],
      ...options.global,
    },
  } as ComponentMountingOptions<C>)
  await flushPromises()
  return { wrapper, router }
}

/** Waits for promises and a few animation frames / timers. */
export async function settle(ms = 0) {
  await flushPromises()
  if (ms) await new Promise((r) => setTimeout(r, ms))
  await flushPromises()
}

/** Elements anywhere in the document (PrimeVue overlays teleport to body). */
export const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel)
export const $$ = <E extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<E>(sel)]
/** The first element (in the document) whose text includes `text`. */
export function byText(text: string, sel = 'button, a, label, span, li, div') {
  return $$(sel).filter((e) => e.textContent?.includes(text)).sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0]
}
/** PrimeVue listens to pointer/mouse events on some controls; send the whole sequence. */
export function press(el: Element | undefined | null) {
  if (!el) throw new Error('press: no element')
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true }))
  // SVG icons (PrimeVue's chip remove icon) have no click()
  if (el instanceof HTMLElement) el.click()
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
