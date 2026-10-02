import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import { autoRotate } from '../viewPrefs'

export interface Slot {
  el: HTMLElement
  object: Object3D | null
  tick?: (ms: number) => void
  /** Draw faded to gray (unselected / filtered-out cards). */
  gray?: boolean
}

// Gray slots are rendered to an offscreen target first, then drawn desaturated and translucent.
const GRAY_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }'
const GRAY_FRAG = `
uniform sampler2D map; varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(vec3(l), c.a * 0.4);
  #include <colorspace_fragment>
}`

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
  private grayRt?: WebGLRenderTarget
  private grayScene = new Scene()
  private grayQuad = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: GRAY_VERT, fragmentShader: GRAY_FRAG, transparent: true, depthTest: false }),
  )
  private grayCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
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

    this.grayScene.add(this.grayQuad)
    this.grayQuad.frustumCulled = false
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

  private renderGray(r: WebGLRenderer, w: number, h: number) {
    const pr = r.getPixelRatio()
    const pw = Math.max(1, Math.round(w * pr))
    const ph = Math.max(1, Math.round(h * pr))
    const rt = (this.grayRt ??= new WebGLRenderTarget(pw, ph, { samples: 4 }))
    if (rt.width !== pw || rt.height !== ph) rt.setSize(pw, ph)
    r.setRenderTarget(rt)
    r.setScissorTest(false)
    r.setClearColor(0x000000, 0)
    r.clear()
    r.render(this.scene, this.camera)
    r.setRenderTarget(null)
    r.setScissorTest(true)
    ;(this.grayQuad.material as ShaderMaterial).uniforms.map!.value = rt.texture
    r.render(this.grayScene, this.grayCam)
  }

  private spin = 0
  private lastMs = 0

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame)
    if (!this.container || !this.cssW || !this.cssH) return

    // Accumulated, so re-enabling continues from where the spin stopped.
    if (autoRotate.value) this.spin += Math.min(100, ms - (this.lastMs || ms)) * 0.0008
    this.lastMs = ms
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
      obj.rotation.y = this.spin
      slot.tick?.(ms)
      this.scene.add(obj)
      if (slot.gray) this.renderGray(r, rect.width, rect.height)
      else r.render(this.scene, this.camera)
      // This canvas sits above the cards, so a model would cover the card's checkbox (top left) and bookmark
      // (top right): cut those corners out so the buttons show through.
      for (const [cx, cw] of [[x, 36], [x + rect.width - 56, 56]] as const) {
        r.setScissor(cx, y + rect.height - 40, cw, 40)
        r.clearColor()
      }
      this.scene.remove(obj)
    }
  }
}
