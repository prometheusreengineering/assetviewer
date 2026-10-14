import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Texture, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { disposeObject, fitObject, visibleBox } from '../../src/three/fit'

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial())
  m.position.set(x, y, z)
  return m
}
const round = (v: Vector3) => v.toArray().map((n) => Math.round(n * 1000) / 1000)

describe('visibleBox', () => {
  it('unions visible meshes in world space', () => {
    const g = new Group()
    g.add(box(2, 2, 2, 0, 1, 0), box(2, 2, 2, 4, 1, 0))
    g.position.set(10, 0, 0)
    const b = visibleBox(g)
    expect(round(b.min)).toEqual([9, 0, -1])
    expect(round(b.max)).toEqual([15, 2, 1])
  })
  it('skips hidden meshes, hidden parents and meshes collapsed to scale 0', () => {
    const g = new Group()
    const hidden = box(100, 100, 100)
    hidden.visible = false
    const collapsed = box(100, 100, 100)
    collapsed.scale.set(0, 1, 1)
    const parent = new Group()
    parent.visible = false
    parent.add(box(50, 50, 50))
    g.add(box(1, 1, 1), hidden, collapsed, parent)
    expect(round(visibleBox(g).getSize(new Vector3()))).toEqual([1, 1, 1])
  })
  it('falls back to the full bounds when nothing visible is left', () => {
    const g = new Group()
    const m = box(3, 3, 3)
    m.scale.setScalar(0)
    m.position.set(2, 0, 0)
    g.add(m)
    // Box3.setFromObject: the collapsed mesh's (degenerate) bounds at its position
    const b = visibleBox(g)
    expect(b.isEmpty()).toBe(false)
    expect(round(b.getCenter(new Vector3()))).toEqual([2, 0, 0])
    expect(round(b.getSize(new Vector3()))).toEqual([0, 0, 0])
  })
})

describe('visibleBox: opaque texels only', () => {
  /** An OffscreenCanvas whose pixels are opaque where `opaque(x, y)` (in the drawn size). */
  function stubCanvas(opaque: (x: number, y: number, w: number, h: number) => boolean) {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        w: number
        h: number
        constructor(w: number, h: number) {
          this.w = w
          this.h = h
        }
        getContext() {
          const { w, h } = this
          return {
            drawImage() {},
            getImageData: () => ({ data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 && opaque(Math.floor(i / 4) % w, Math.floor(i / 4 / w), w, h) ? 255 : 0)) }),
          }
        }
      },
    )
  }
  const plane = (image: object) => {
    const tex = new Texture(image as never)
    tex.flipY = false
    const geo = new BoxGeometry(4, 4, 0)
    // only the +z face, like buildCube keeps for a flat plane textured on one side
    geo.setIndex(Array.from({ length: 6 }, (_, k) => geo.getIndex()!.getX(4 * 6 + k)))
    return new Mesh(geo, new MeshBasicMaterial({ map: tex }))
  }

  it('a plane counts only where its texture is opaque', () => {
    // opaque in the left half of the image
    stubCanvas((x, _y, w) => x < w / 2)
    const b = visibleBox(plane({ width: 16, height: 16 }))
    expect(round(b.min)[0]).toBeCloseTo(-2, 0)
    expect(round(b.max)[0]).toBeLessThan(0.3)
    expect(round(b.max)[1]).toBeGreaterThan(1.5)
    vi.unstubAllGlobals()
  })

  it('animated grids count a texel opaque in any frame', () => {
    // two frames side by side: frame 0 opaque on its left quarter, frame 1 on its right quarter
    stubCanvas((x, _y, w) => x < w / 8 || x >= (w * 7) / 8)
    const m = plane({ width: 32, height: 16 })
    m.material.map!.repeat.set(0.5, 1)
    const b = visibleBox(m)
    expect(round(b.min)[0]).toBeLessThan(-1.5)
    expect(round(b.max)[0]).toBeGreaterThan(1.5)
    vi.unstubAllGlobals()
  })

  it('falls back to the geometry when pixels cannot be read', () => {
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() {
        return { drawImage() {} }
      }
    })
    expect(round(visibleBox(plane({ width: 8, height: 8 })).getSize(new Vector3()))).toEqual([4, 4, 0])
    vi.unstubAllGlobals()
  })
})

describe('fitObject', () => {
  it('centers the object and scales its largest side to `size`', () => {
    const o = box(4, 2, 1, 5, 5, 5)
    const w = fitObject(o, 2)
    expect(w.children[0]).toBe(o)
    expect(w.scale.x).toBeCloseTo(0.5)
    w.updateMatrixWorld(true)
    const b = visibleBox(w)
    expect(round(b.getCenter(new Vector3()))).toEqual([0, 0, 0])
    expect(round(b.getSize(new Vector3()))).toEqual([2, 1, 0.5])
  })
  it('defaults to 1.6 and survives an empty object', () => {
    expect(fitObject(box(8, 1, 1)).scale.x).toBeCloseTo(0.2)
    const w = fitObject(new Object3D())
    expect(Number.isFinite(w.scale.x)).toBe(true)
  })
})

describe('disposeObject', () => {
  it('disposes every mesh geometry in the tree', () => {
    const a = box(1, 1, 1)
    const b = box(1, 1, 1)
    const g = new Group()
    const inner = new Group()
    inner.add(b)
    g.add(a, inner)
    const sa = vi.spyOn(a.geometry, 'dispose')
    const sb = vi.spyOn(b.geometry, 'dispose')
    disposeObject(g)
    expect(sa).toHaveBeenCalledOnce()
    expect(sb).toHaveBeenCalledOnce()
  })
})
