import { AmbientLight, DirectionalLight, MOUSE, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import type { LoadedModel } from '../providers/types'

/** One canvas with a model, trackball (free rotate) or orbit (upright) controls, Shift+drag pans, and an optional slow spin. */
export class Viewer {
  autoRotate = true
  onFrame?: (model: LoadedModel) => void
  private renderer = new WebGLRenderer({ antialias: true, alpha: true })
  private scene = new Scene()
  private camera = new PerspectiveCamera(30, 1, 1, 12)
  private controls?: TrackballControls | OrbitControls
  private model?: LoadedModel
  private raf = 0
  private last = 0
  private resize: ResizeObserver

  constructor(host: HTMLElement, freeRotate = false) {
    this.scene.add(new AmbientLight(0xffffff, 2.2))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(-2, 3, -4)
    this.scene.add(key)
    this.camera.position.set(0, 0.5, -4.2)
    const r = this.renderer
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    host.appendChild(r.domElement)
    this.setFreeRotate(freeRotate)
    r.domElement.addEventListener('pointerdown', (e) => this.controls && (this.controls.mouseButtons.LEFT = e.shiftKey ? MOUSE.PAN : MOUSE.ROTATE), { capture: true })
    this.resize = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      r.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      if (this.controls instanceof TrackballControls) this.controls.handleResize()
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
      this.controls?.update()
      r.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** Swaps the controls (shared "Free rotate" preference); the view is reset. */
  setFreeRotate(free: boolean) {
    this.controls?.dispose()
    const el = this.renderer.domElement
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(0, 0.5, -4.2)
    this.camera.lookAt(0, 0, 0)
    if (free) {
      const c = new TrackballControls(this.camera, el)
      c.rotateSpeed = 3
      c.panSpeed = 0.1
      c.dynamicDampingFactor = 0.1
      c.minDistance = 2
      c.maxDistance = 9
      this.controls = c
    } else {
      const c = new OrbitControls(this.camera, el)
      c.enableDamping = true
      c.dampingFactor = 0.1
      c.minDistance = 2
      c.maxDistance = 9
      c.maxPolarAngle = Math.PI * 0.95
      c.minPolarAngle = Math.PI * 0.05
      this.controls = c
    }
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
    this.controls?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
