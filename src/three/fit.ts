import { Box3, Group, Mesh, Object3D, Vector3 } from 'three'

/** Wraps an object so it is centered at the origin and scaled to fit a cube of `size`. */
export function fitObject(object: Object3D, size = 1.6): Group {
  const wrapper = new Group()
  wrapper.add(object)
  wrapper.updateMatrixWorld(true)
  const box = new Box3().setFromObject(wrapper)
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
