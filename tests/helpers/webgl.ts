import { vi } from 'vitest'

/**
 * Stand-in for three's WebGLRenderer in happy-dom (no WebGL). Records render calls so components can be
 * tested for what they draw; real rendering is covered by the browser project. It must not import three:
 * it is loaded from inside the vi.mock('three') factory.
 */
export class FakeWebGLRenderer {
  static instances: FakeWebGLRenderer[] = []
  domElement = document.createElement('canvas')
  renders: { scene: unknown; camera: unknown }[] = []
  size = { x: 0, y: 0 }
  pixelRatio = 1
  disposed = false
  setPixelRatio = vi.fn((r: number) => void (this.pixelRatio = r))
  getPixelRatio = () => this.pixelRatio
  setSize = vi.fn((w: number, h: number) => void Object.assign(this.size, { x: w, y: h }))
  getSize = <V extends { set(x: number, y: number): V }>(v: V) => v.set(this.size.x, this.size.y)
  setClearColor = vi.fn()
  setScissorTest = vi.fn()
  setScissor = vi.fn()
  setViewport = vi.fn()
  setRenderTarget = vi.fn()
  clear = vi.fn()
  clearColor = vi.fn()
  render = vi.fn((scene: unknown, camera: unknown) => void this.renders.push({ scene, camera }))
  dispose = vi.fn(() => void (this.disposed = true))
  constructor() {
    FakeWebGLRenderer.instances.push(this)
  }
}

/** A controllable IntersectionObserver: `intersect(el)` reports an element as (in)visible. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  els = new Set<Element>()
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) {
    this.els.add(el)
  }
  unobserve(el: Element) {
    this.els.delete(el)
  }
  disconnect() {
    this.els.clear()
  }
  takeRecords() {
    return []
  }
  static intersectAll(visible = true) {
    for (const o of this.instances) for (const el of o.els) o.cb([{ isIntersecting: visible, target: el } as IntersectionObserverEntry], o as unknown as IntersectionObserver)
  }
}
