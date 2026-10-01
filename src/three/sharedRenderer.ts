import { AmbientLight, DirectionalLight, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface Slot {
  el: HTMLElement
  object: Object3D | null
  tick?: (ms: number) => void
}

/**
 * One WebGL context for the whole grid. A zero-height sticky wrapper keeps the canvas pinned over
 * the scroll container's viewport (compositor-driven, so it never lags the cards), and each card
 * is drawn into its own scissored viewport.
 */
export class SharedRenderer {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(30, 1, 1, 12)
  private slots = new Set<Slot>()
  private container: HTMLElement | null = null
  private wrapper: HTMLElement
  private resizeObserver?: ResizeObserver
  private raf = 0
  private cssW = 0
  private cssH = 0

  constructor() {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.wrapper = document.createElement('div')
    Object.assign(this.wrapper.style, { position: 'sticky', top: '0', left: '0', height: '0', width: '100%', zIndex: '2', pointerEvents: 'none' })
    Object.assign(this.renderer.domElement.style, { position: 'absolute', top: '0', left: '0', display: 'block' })
    this.wrapper.appendChild(this.renderer.domElement)

    this.scene.add(new AmbientLight(0xffffff, 2.2))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(-2, 3, -4)
    this.scene.add(key)
    // Models face -z, so look at them from the front.
    this.camera.position.set(0, 0.5, -4.2)
    this.camera.lookAt(0, 0, 0)
  }

  attach(container: HTMLElement) {
    this.container = container
    container.prepend(this.wrapper)
    this.resize()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.raf = requestAnimationFrame(this.frame)
  }

  detach() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.wrapper.remove()
    this.renderer.dispose()
    this.container = null
  }

  add(slot: Slot) {
    this.slots.add(slot)
  }

  remove(slot: Slot) {
    this.slots.delete(slot)
  }

  private resize() {
    const c = this.container
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    if (w === this.cssW && h === this.cssH) return
    this.cssW = w
    this.cssH = h
    this.renderer.setSize(w, h)
  }

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame)
    if (!this.container || !this.cssW || !this.cssH) return

    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const r = this.renderer
    r.setScissorTest(false)
    r.clear()
    r.setScissorTest(true)
    for (const slot of this.slots) {
      const obj = slot.object
      if (!obj) continue
      const rect = slot.el.getBoundingClientRect()
      if (rect.bottom < canvasRect.top || rect.top > canvasRect.bottom || rect.right < canvasRect.left || rect.left > canvasRect.right) continue
      const x = rect.left - canvasRect.left
      const y = canvasRect.bottom - rect.bottom
      r.setViewport(x, y, rect.width, rect.height)
      r.setScissor(x, y, rect.width, rect.height)
      this.camera.aspect = rect.width / rect.height
      this.camera.updateProjectionMatrix()
      obj.rotation.y = ms * 0.0008
      slot.tick?.(ms)
      this.scene.add(obj)
      r.render(this.scene, this.camera)
      this.scene.remove(obj)
    }
  }
}
