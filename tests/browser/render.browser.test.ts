// Real WebGL in Chromium: the patched material compiles, models draw, and the shared grid renderer cuts its
// corners out and draws gray slots desaturated.
import { BoxGeometry, Mesh, MeshLambertMaterial, type WebGLRenderer } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitObject } from '../../src/three/fit'
import { buildGeoRig, createMaterial, createTexture } from '../../src/three/geoModel'
import { SharedRenderer } from '../../src/three/sharedRenderer'
import { Viewer } from '../../src/three/viewer'
import { CROWN_GEO } from '../fixtures/lunar'
import type { GeoFile } from '../../src/three/geoModel'

/** A solid-colour bitmap. */
async function solid(color: string, w = 32, h = 32) {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  return createImageBitmap(c)
}
/** RGBA of the WebGL drawing buffer at CSS pixel (x, y from the top left); read right after drawing. */
function pixel(r: WebGLRenderer, x: number, y: number) {
  const gl = r.getContext()
  const pr = r.getPixelRatio()
  const out = new Uint8Array(4)
  gl.readPixels(Math.round(x * pr), gl.drawingBufferHeight - 1 - Math.round(y * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
  return [...out]
}
const box = (el: HTMLElement, css: Partial<CSSStyleDeclaration>) => (Object.assign(el.style, css), el)
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((f) => f())
  document.body.innerHTML = ''
})

describe('material and geometry', () => {
  it('the patched Lambert shader compiles without errors and the rig draws', async () => {
    const errors = vi.spyOn(console, 'error')
    const host = box(document.createElement('div'), { width: '200px', height: '200px' })
    document.body.append(host)
    const viewer = new Viewer(host)
    cleanup.push(() => viewer.dispose())
    const mat = createMaterial(createTexture(await solid('#ff0000')))
    const { root } = buildGeoRig(CROWN_GEO as unknown as GeoFile, mat, true)
    root.scale.x *= -1
    const object = fitObject(root)
    viewer.autoRotate = false
    viewer.setModel({ object, files: [], frames: 1, tick: () => {}, states: [], state: '', setState: () => {}, dispose: () => {} })
    const r = (viewer as unknown as { renderer: WebGLRenderer }).renderer
    // let the ResizeObserver size the canvas, then draw a frame ourselves and read it back
    await new Promise((res) => setTimeout(res, 100))
    r.render((viewer as unknown as { scene: never }).scene, (viewer as unknown as { camera: never }).camera)
    const [red, g, b, a] = pixel(r, 100, 100)
    expect(a).toBe(255)
    expect(red).toBeGreaterThan(100)
    expect(g).toBeLessThan(80)
    expect(b).toBeLessThan(80)
    // corners stay transparent
    expect(pixel(r, 2, 2)[3]).toBe(0)
    expect(errors).not.toHaveBeenCalled()
  })

  it('alpha-tested cut-outs leave transparent texels see-through', async () => {
    const c = new OffscreenCanvas(32, 32)
    const g = c.getContext('2d')!
    g.fillStyle = '#00ff00'
    g.fillRect(0, 0, 16, 32)
    const mat = createMaterial(createTexture(await createImageBitmap(c)))
    const host = box(document.createElement('div'), { width: '200px', height: '200px' })
    document.body.append(host)
    const viewer = new Viewer(host)
    cleanup.push(() => viewer.dispose())
    viewer.autoRotate = false
    const plane: GeoFile = { 'minecraft:geometry': [{ description: { texture_width: 32, texture_height: 32 }, bones: [{ name: 'p', cubes: [{ origin: [-16, -16, 0], size: [32, 32, 0], uv: { north: { uv: [0, 0], uv_size: [32, 32] } } }] }] }] }
    const { root } = buildGeoRig(plane, mat)
    viewer.setModel({ object: fitObject(root), files: [], frames: 1, tick: () => {}, states: [], state: '', setState: () => {}, dispose: () => {} })
    const r = (viewer as unknown as { renderer: WebGLRenderer }).renderer
    await new Promise((res) => setTimeout(res, 100))
    r.render((viewer as unknown as { scene: never }).scene, (viewer as unknown as { camera: never }).camera)
    // one half of the plane is opaque green, the other half cut out
    const left = pixel(r, 70, 100)
    const right = pixel(r, 130, 100)
    const alphas = [left[3], right[3]].sort()
    expect(alphas).toEqual([0, 255])
  })
})

describe('SharedRenderer', () => {
  function grid() {
    const container = box(document.createElement('div'), { position: 'relative', width: '400px', height: '200px', overflow: 'auto' })
    const card = (left: number) => box(document.createElement('div'), { position: 'absolute', left: `${left}px`, top: '0', width: '200px', height: '200px' })
    const a = card(0)
    const b = card(200)
    container.append(a, b)
    document.body.append(container)
    const sr = new SharedRenderer()
    sr.attach(container)
    cleanup.push(() => sr.detach())
    const r = (sr as unknown as { renderer: WebGLRenderer }).renderer
    const frame = (ms: number) => (sr as unknown as { frame: (ms: number) => void }).frame(ms)
    return { sr, a, b, r, frame }
  }
  const cube = () => {
    const m = new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new MeshLambertMaterial({ color: 0xff2020 }))
    return m
  }

  it('draws each slot in its own viewport and keeps the button corners clear', () => {
    const { sr, a, r, frame } = grid()
    const tick = vi.fn()
    sr.add({ el: a, object: cube(), tick })
    frame(16)
    expect(tick).toHaveBeenCalledWith(16)
    expect(pixel(r, 100, 100)[3]).toBe(255)
    // the second card is empty
    expect(pixel(r, 300, 100)[3]).toBe(0)
    // top-left 36x40 and top-right 56x40 of the slot are cut out
    const big = new Mesh(new BoxGeometry(3, 3, 3), new MeshLambertMaterial({ color: 0xff2020 }))
    sr.add({ el: a, object: big })
    frame(32)
    expect(pixel(r, 100, 100)[3]).toBe(255)
    expect(pixel(r, 10, 10)[3]).toBe(0)
    expect(pixel(r, 190, 10)[3]).toBe(0)
    expect(pixel(r, 100, 10)[3]).toBe(255)
  })

  it('gray slots are drawn desaturated and translucent', () => {
    const { sr, a, b, r, frame } = grid()
    sr.add({ el: a, object: cube() })
    sr.add({ el: b, object: cube(), gray: true })
    frame(16)
    const [cr, cg, cb, ca] = pixel(r, 100, 100)
    const [gr, gg, gb, ga] = pixel(r, 300, 100)
    expect(ca).toBe(255)
    expect(cr - cg).toBeGreaterThan(60)
    expect(cr - cb).toBeGreaterThan(60)
    expect(ga).toBeGreaterThan(0)
    expect(ga).toBeLessThan(160)
    expect(Math.abs(gr - gg)).toBeLessThan(6)
    expect(Math.abs(gg - gb)).toBeLessThan(6)
  })

  it('removed and off-screen slots are not drawn', () => {
    const { sr, a, r, frame } = grid()
    const slot = { el: a, object: cube() }
    sr.add(slot)
    sr.remove(slot)
    frame(16)
    expect(pixel(r, 100, 100)[3]).toBe(0)
    a.style.top = '1000px'
    sr.add(slot)
    const tick = vi.fn()
    sr.add({ el: a, object: cube(), tick })
    frame(32)
    expect(tick).not.toHaveBeenCalled()
  })
})
