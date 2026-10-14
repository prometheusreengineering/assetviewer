import { Box3, Group, Mesh, Object3D, Vector2, Vector3, type BufferAttribute, type BufferGeometry, type Texture } from 'three'

const _box = new Box3()
const _p = new Vector3()

interface AlphaMask {
  w: number
  h: number
  data: Uint8ClampedArray
}
const masks = new WeakMap<object, AlphaMask | null>()
/** The texture's alpha channel (at most 512 px a side), or null where pixels can't be read (Node, tests). */
function alphaMask(tex: Texture): AlphaMask | null {
  const img = tex.image as { width?: number; height?: number } | undefined
  if (!img?.width || !img.height) return null
  if (masks.has(img)) return masks.get(img)!
  let mask: AlphaMask | null = null
  try {
    const k = Math.min(1, 512 / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * k))
    const h = Math.max(1, Math.round(img.height * k))
    const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
    if (g && typeof g.getImageData === 'function') {
      g.drawImage(img as CanvasImageSource, 0, 0, w, h)
      mask = { w, h, data: g.getImageData(0, 0, w, h).data }
    }
  } catch {
    mask = null
  }
  masks.set(img, mask)
  return mask
}

/**
 * Bounds of the opaque part of a box mesh: each face is sampled over its texture and only texels that pass
 * the alpha test count. Flat wing membranes are big planes with the art in one corner; their whole plane
 * made the wings tiny in the thumbnail. Undefined when the texture can't be read.
 */
function opaqueBox(mesh: Mesh, out: Box3): boolean {
  const geo = mesh.geometry as BufferGeometry
  const map = (mesh.material as { map?: Texture | null }).map
  const pos = geo.getAttribute('position') as BufferAttribute
  const uv = geo.getAttribute('uv') as BufferAttribute | undefined
  const index = geo.getIndex()
  if (!map || !uv || !index || geo.type !== 'BoxGeometry' || pos.count !== 24) return false
  const mask = alphaMask(map)
  if (!mask) return false
  // Animated textures are grids of frames (see rig.ts): a texel counts if it is opaque in any of up to 16 of them.
  const cols = Math.max(1, Math.round(1 / map.repeat.x))
  const rows = Math.max(1, Math.round(1 / map.repeat.y))
  const n = cols * rows
  const cells = Array.from({ length: Math.min(n, 16) }, (_, i) => Math.floor((i * n) / Math.min(n, 16))).map((c) => {
    const row = Math.floor(c / cols)
    return [(c % cols) / cols, map.flipY ? 1 - (row + 1) / rows : row / rows] as const
  })
  const opaque = (u: number, v: number) =>
    cells.some(([ox, oy]) => {
      const tu = u * map.repeat.x + ox
      const tv = v * map.repeat.y + oy
      const x = Math.min(mask.w - 1, Math.max(0, Math.floor(tu * mask.w)))
      const y = Math.min(mask.h - 1, Math.max(0, Math.floor((map.flipY ? 1 - tv : tv) * mask.h)))
      // the material's alpha test is 0.3
      return mask.data[(y * mask.w + x) * 4 + 3]! >= 77
    })
  const kept = new Set<number>()
  for (let i = 0; i < index.count; i++) kept.add(Math.floor(index.getX(i) / 4))
  const corner = (i: number) => new Vector3().fromBufferAttribute(pos, i)
  const cuv = (i: number) => new Vector2().fromBufferAttribute(uv, i)
  const lerp3 = (a: Vector3, b: Vector3, t: number) => a.clone().lerp(b, t)
  for (const f of kept) {
    // BoxGeometry face vertices: top left, top right, bottom left, bottom right
    const [p0, p1, p2, p3] = [0, 1, 2, 3].map((k) => corner(f * 4 + k)) as [Vector3, Vector3, Vector3, Vector3]
    const [t0, t1, t2] = [0, 1, 2].map((k) => cuv(f * 4 + k)) as [Vector2, Vector2, Vector2]
    const nu = Math.min(32, Math.max(2, Math.ceil(Math.abs(t1.x - t0.x) * mask.w)))
    const nv = Math.min(32, Math.max(2, Math.ceil(Math.abs(t2.y - t0.y) * mask.h)))
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const s = (i + 0.5) / nu
        const t = (j + 0.5) / nv
        if (!opaque(t0.x + (t1.x - t0.x) * s, t0.y + (t2.y - t0.y) * t)) continue
        _p.copy(lerp3(p0, p1, s).lerp(lerp3(p2, p3, s), t)).applyMatrix4(mesh.matrixWorld)
        out.expandByPoint(_p)
      }
    }
  }
  return true
}

/**
 * Bounds of what is actually drawn: meshes that are hidden or collapsed by a zero scale are skipped. Pets
 * hide effects that way (a lightning bolt 8 blocks tall, orbiting planets), which made them tiny and
 * off-center when the whole static model was fitted. Where the texture can be read, only opaque texels of
 * box faces count (see opaqueBox).
 */
export function visibleBox(object: Object3D): Box3 {
  object.updateMatrixWorld(true)
  const box = new Box3()
  object.traverseVisible((o) => {
    if (!(o instanceof Mesh) || Math.abs(o.matrixWorld.determinant()) < 1e-12) return
    if (opaqueBox(o, box)) return
    o.geometry.computeBoundingBox()
    box.union(_box.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld))
  })
  return box.isEmpty() ? new Box3().setFromObject(object) : box
}

/** Wraps an object so it is centered at the origin and scaled to fit a cube of `size` (around `box` when given). */
export function fitObject(object: Object3D, size = 1.6, box?: Box3): Group {
  const wrapper = new Group()
  wrapper.add(object)
  wrapper.updateMatrixWorld(true)
  box ??= visibleBox(wrapper)
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
