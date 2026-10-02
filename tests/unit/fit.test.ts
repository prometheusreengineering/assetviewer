import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three'
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
