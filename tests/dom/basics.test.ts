import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AppDialog from '../../src/components/AppDialog.vue'
import AnimatedImage from '../../src/components/AnimatedImage.vue'
import ControlsHelp from '../../src/components/ControlsHelp.vue'
import HomeView from '../../src/components/HomeView.vue'
import ProviderSwitch from '../../src/components/ProviderSwitch.vue'
import SideControls from '../../src/components/SideControls.vue'
import { askConfirm, askText, dialog, notify } from '../../src/dialogs'
import { skinName } from '../../src/skin'
import { dark } from '../../src/theme'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'

describe('AppDialog', () => {
  it('renders a confirm request and resolves with the button pressed', async () => {
    const { wrapper } = await mountApp(AppDialog)
    const p = askConfirm({ title: 'Delete it?', message: 'Gone for good', icon: 'pi pi-trash', danger: true, confirmLabel: 'Delete' })
    await settle()
    expect($('.p-dialog')!.textContent).toContain('Delete it?')
    expect($('.p-dialog')!.textContent).toContain('Gone for good')
    expect($('.title .pi-trash')!.classList.contains('danger')).toBe(true)
    press(byText('Delete', 'button'))
    expect(await p).toBe(true)
    await settle()
    expect(dialog.value).toBeUndefined()
    const q = askConfirm({ title: 'Again?' })
    await settle()
    press(byText('Cancel', 'button'))
    expect(await q).toBe(false)
    wrapper.unmount()
  })

  it('text input: prefilled, OK disabled while blank, Enter submits', async () => {
    const { wrapper } = await mountApp(AppDialog)
    const p = askText({ title: 'Name', input: 'Old', placeholder: 'Collection name' })
    await settle()
    const input = $<HTMLInputElement>('.p-dialog input')!
    expect(input.value).toBe('Old')
    expect(input.placeholder).toBe('Collection name')
    expect(input.hasAttribute('autofocus')).toBe(true)
    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(byText('OK', 'button')!.hasAttribute('disabled')).toBe(true)
    input.value = 'New name'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    $('.p-dialog form')!.dispatchEvent(new Event('submit'))
    expect(await p).toBe('New name')
    wrapper.unmount()
  })

  it('"Don\'t ask again" stores the key when confirmed', async () => {
    const { wrapper } = await mountApp(AppDialog)
    const p = askConfirm({ title: 'Open?', remember: 'assetviewer.skipX', warn: true, icon: 'pi pi-exclamation-triangle' })
    await settle()
    expect($('.title .pi')!.classList.contains('warn')).toBe(true)
    press($('.remember input'))
    await nextTick()
    press(byText('OK', 'button'))
    expect(await p).toBe(true)
    expect(localStorage.getItem('assetviewer.skipX')).toBe('1')
    wrapper.unmount()
  })

  it('a notice has no cancel button', async () => {
    const { wrapper } = await mountApp(AppDialog)
    void notify('Saved')
    await settle()
    expect(byText('Cancel', 'button')).toBeUndefined()
    press(byText('OK', 'button'))
    wrapper.unmount()
  })
})

describe('SideControls', () => {
  it('applies the player name on Enter/blur (trimmed) and toggles the theme', async () => {
    skinName.value = ''
    const { wrapper } = await mountApp(SideControls)
    const input = wrapper.find('input')
    await input.setValue('  Steve  ')
    await input.trigger('keyup.enter')
    expect(skinName.value).toBe('Steve')
    skinName.value = 'Alex'
    await nextTick()
    expect((input.element as HTMLInputElement).value).toBe('Alex')
    const before = dark.value
    await wrapper.find('button').trigger('click')
    expect(dark.value).toBe(!before)
    expect(wrapper.find('button').attributes('aria-label')).toBe(dark.value ? 'Light mode' : 'Dark mode')
    wrapper.unmount()
  })
})

describe('ProviderSwitch', () => {
  it('shows the current provider and navigates to another one', async () => {
    const { wrapper, router } = await mountApp(ProviderSwitch, { props: { provider: 'lunar' }, path: '/lunar/hat' })
    expect(wrapper.find('.switch').text()).toContain('Lunar Client')
    await wrapper.find('.switch').trigger('click')
    await settle()
    const opts = $$('.opt')
    expect(opts.map((o) => o.querySelector('strong')!.textContent)).toEqual(['Lunar Client', 'Essential'])
    expect(opts[0]!.classList.contains('on')).toBe(true)
    opts[1]!.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/essential')
    wrapper.unmount()
  })
  it('picking the current provider stays put; unknown providers fall back to the first', async () => {
    const { wrapper, router } = await mountApp(ProviderSwitch, { props: { provider: 'nope' }, path: '/lunar/hat' })
    expect(wrapper.find('.switch').text()).toContain('Lunar Client')
    wrapper.unmount()
    const m = await mountApp(ProviderSwitch, { props: { provider: 'lunar' }, path: '/lunar/hat' })
    await m.wrapper.find('.switch').trigger('click')
    await settle()
    $$('.opt')[0]!.click()
    await settle()
    expect(m.router.currentRoute.value.path).toBe('/lunar/hat')
    void router
    m.wrapper.unmount()
  })
})

describe('HomeView / ControlsHelp', () => {
  it('home describes the provider and links the project', async () => {
    const { wrapper } = await mountApp(HomeView, { props: { name: 'Lunar Client' } })
    expect(wrapper.find('h1').text()).toBe('Asset Viewer')
    expect(wrapper.find('.lead').text()).toContain('Lunar Client cosmetics')
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toContain('https://github.com/prometheusreengineering/assetviewer')
    expect(wrapper.findAll('a').every((a) => a.attributes('rel') === 'noopener')).toBe(true)
  })
  it('the help icon carries the controls tooltip', async () => {
    const { wrapper } = await mountApp(ControlsHelp)
    expect(wrapper.find('i.pi-question-circle').exists()).toBe(true)
  })
})

describe('AnimatedImage', () => {
  // happy-dom doesn't load images: drive Image onload/onerror by hand.
  const images: HTMLImageElement[] = []
  const RealImage = window.Image
  const install = (w: number, h: number) => {
    vi.stubGlobal(
      'Image',
      class extends RealImage {
        constructor() {
          super()
          images.push(this)
          Object.defineProperty(this, 'naturalWidth', { value: w })
          Object.defineProperty(this, 'naturalHeight', { value: h })
        }
      },
    )
  }
  const load = async () => {
    images.at(-1)!.onload!(new Event('load'))
    await nextTick()
  }

  it('a still image once loaded', async () => {
    install(16, 16)
    const { wrapper } = await mountApp(AnimatedImage, { props: { src: 'blob:a' } })
    expect(wrapper.find('img').exists()).toBe(false)
    await load()
    expect(wrapper.find('img').attributes('src')).toBe('blob:a')
  })
  it('stacked frames become a stepped sprite sheet', async () => {
    install(16, 64)
    const { wrapper } = await mountApp(AnimatedImage, { props: { src: 'blob:b', frametimeMs: 100 } })
    await load()
    const style = wrapper.find('.sheet').attributes('style')!
    expect(style).toContain('background-size: 100% 400%')
    expect(style).toContain('400ms')
    expect(style).toContain('steps(4')
  })
  it('explicit frame sizes and oversize frames', async () => {
    install(32, 64)
    const { wrapper } = await mountApp(AnimatedImage, { props: { src: 'blob:c', frametimeMs: 50, frameW: 32, frameH: 16 } })
    await load()
    expect(wrapper.find('.sheet').attributes('style')).toContain('100% 400%')
    install(16, 16)
    const one = await mountApp(AnimatedImage, { props: { src: 'blob:d', frametimeMs: 50, frameW: 99 } })
    await load()
    // a single frame is just an image
    expect(one.wrapper.find('img').exists()).toBe(true)
  })
  it('emits error and reloads when the source changes', async () => {
    install(8, 8)
    const { wrapper } = await mountApp(AnimatedImage, { props: { src: 'blob:e' } })
    images.at(-1)!.onerror!(new Event('error'))
    expect(wrapper.emitted('error')).toHaveLength(1)
    const n = images.length
    await wrapper.setProps({ src: 'blob:f' })
    expect(images.length).toBe(n + 1)
  })
})
