import { Box3, Group, Mesh, Object3D, Vector3 } from 'three'

const _box = new Box3()

/**
 * Bounds of what is actually drawn: meshes that are hidden or collapsed by a zero scale are skipped. Pets
 * hide effects that way (a lightning bolt 8 blocks tall, orbiting planets), which made them tiny and
 * off-center when the whole static model was fitted.
 */
export function visibleBox(object: Object3D): Box3 {
  object.updateMatrixWorld(true)
  const box = new Box3()
  object.traverseVisible((o) => {
    if (!(o instanceof Mesh) || Math.abs(o.matrixWorld.determinant()) < 1e-12) return
    o.geometry.computeBoundingBox()
    box.union(_box.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld))
  })
  return box.isEmpty() ? new Box3().setFromObject(object) : box
}

/** Wraps an object so it is centered at the origin and scaled to fit a cube of `size`. */
export function fitObject(object: Object3D, size = 1.6): Group {
  const wrapper = new Group()
  wrapper.add(object)
  wrapper.updateMatrixWorld(true)
  const box = visibleBox(wrapper)
  const dims = box.getSize(new Vector3())
  const max = Math.max(dims.x, dims.y, dims.z) || 1
  const center = box.getCenter(new Vector3())
  const s = size / max
  object.position.sub(center)
  wrapper.scale.setScalar(s)
  return wrapper
}

export function disposeObject(object: Object3D) {
  object.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose()
  })
}
