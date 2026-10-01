import { AmbientLight, DirectionalLight, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface Slot {
  el: HTMLElement
  object: Object3D | null
  tick?: (ms: number) => void
}

/**
 * One WebGL context for the whole grid. The canvas floats over a scroll container and each card
 * is drawn into its own scissored viewport, so we never hit the browser's WebGL context limit.
 */
export class SharedRenderer {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(30, 1, 0.1, 50)
  private slots = new Set<Slot>()
  private container: HTMLElement | null = null
  private raf = 0

  constructor() {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      zIndex: '2',
    })
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
    container.appendChild(this.renderer.domElement)
    this.raf = requestAnimationFrame(this.frame)
  }

  detach() {
    cancelAnimationFrame(this.raf)
    this.renderer.domElement.remove()
    this.renderer.dispose()
    this.container = null
  }

  add(slot: Slot) {
    this.slots.add(slot)
  }

  remove(slot: Slot) {
    this.slots.delete(slot)
  }

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const c = this.container
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    const canvas = this.renderer.domElement
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      this.renderer.setSize(w, h)
    }
    canvas.style.transform = `translate(${c.scrollLeft}px, ${c.scrollTop}px)`

    this.renderer.setScissorTest(false)
    this.renderer.clear()
    this.renderer.setScissorTest(true)
    const cr = c.getBoundingClientRect()
    for (const slot of this.slots) {
      const obj = slot.object
      if (!obj) continue
      const r = slot.el.getBoundingClientRect()
      if (r.bottom < cr.top || r.top > cr.bottom || r.right < cr.left || r.left > cr.right) continue
      const x = r.left - cr.left
      const y = cr.bottom - r.bottom
      this.renderer.setViewport(x, y, r.width, r.height)
      this.renderer.setScissor(x, y, r.width, r.height)
      this.camera.aspect = r.width / r.height
      this.camera.updateProjectionMatrix()
      obj.rotation.y = ms * 0.0008
      slot.tick?.(ms)
      this.scene.add(obj)
      this.renderer.render(this.scene, this.camera)
      this.scene.remove(obj)
    }
  }
}
