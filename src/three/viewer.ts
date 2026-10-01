import { AmbientLight, DirectionalLight, MOUSE, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import type { LoadedModel } from '../providers/types'

/** One canvas with a model, free-rotate trackball controls (Shift+drag pans) and an optional slow spin. */
export class Viewer {
  autoRotate = true
  onFrame?: (model: LoadedModel) => void
  private renderer = new WebGLRenderer({ antialias: true, alpha: true })
  private scene = new Scene()
  private camera = new PerspectiveCamera(30, 1, 1, 12)
  private controls: TrackballControls
  private model?: LoadedModel
  private raf = 0
  private last = 0
  private resize: ResizeObserver

  constructor(host: HTMLElement) {
    this.scene.add(new AmbientLight(0xffffff, 2.2))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(-2, 3, -4)
    this.scene.add(key)
    this.camera.position.set(0, 0.5, -4.2)
    const r = this.renderer
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    host.appendChild(r.domElement)
    const c = (this.controls = new TrackballControls(this.camera, r.domElement))
    c.rotateSpeed = 3
    c.panSpeed = 0.1
    c.dynamicDampingFactor = 0.1
    c.minDistance = 2
    c.maxDistance = 9
    r.domElement.addEventListener('pointerdown', (e) => (c.mouseButtons.LEFT = e.shiftKey ? MOUSE.PAN : MOUSE.ROTATE), { capture: true })
    this.resize = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      r.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      c.handleResize()
    })
    this.resize.observe(host)
    const loop = (ms: number) => {
      this.raf = requestAnimationFrame(loop)
      const m = this.model
      if (m) {
        if (this.autoRotate && this.last) m.object.rotation.y += Math.min(ms - this.last, 100) * 0.0002
        m.tick(ms)
        this.onFrame?.(m)
      }
      this.last = ms
      c.update()
      r.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** Shows `model` (keeping the current spin angle); the previous one is disposed. */
  setModel(model: LoadedModel | undefined) {
    const old = this.model
    if (old) {
      if (model) model.object.rotation.y = old.object.rotation.y
      this.scene.remove(old.object)
      old.dispose()
    }
    this.model = model
    if (model) this.scene.add(model.object)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resize.disconnect()
    this.setModel(undefined)
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
