import { DoubleSide, Mesh, MeshBasicMaterial, type Object3D, type Texture } from 'three'
import { createTexture } from './geoModel'

/** A transparent 1x1 bitmap (stand-in texture). The canvas needs a context, or Chrome can't make a bitmap of it. */
export function transparentPixel(): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(1, 1)
  c.getContext('2d')
  return createImageBitmap(c)
}

export interface GlowLayer {
  /** Swaps the glow texture (colour variants); undefined hides the layer. */
  setImage(bitmap: ImageBitmap | undefined): void
  /** Shows the same animation frame as the base texture (stacked frames share one layout). */
  sync(base: Texture): void
  dispose(): void
}

/**
 * Essential's `emissive.png`: drawn full-bright over the model with the same UVs, so the glowing parts (fire,
 * neon, eyes) aren't shaded. Every cube mesh gets an unlit child sharing its geometry, pulled slightly towards
 * the camera so it never z-fights the lit pass under it.
 */
export function addGlowLayer(root: Object3D, bitmap: ImageBitmap): GlowLayer {
  let tex: Texture = createTexture(bitmap)
  const material = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const meshes: Mesh[] = []
  root.traverse((o) => {
    if (o instanceof Mesh && !o.userData.glow) meshes.push(o)
  })
  for (const m of meshes) {
    const g = new Mesh(m.geometry, material)
    g.userData.glow = true
    g.renderOrder = 1
    m.add(g)
  }
  return {
    setImage(next) {
      if (!next) {
        material.visible = false
        return
      }
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.dispose()
      tex = createTexture(next)
      material.map = tex
      material.visible = true
      material.needsUpdate = true
    },
    sync(base) {
      tex.repeat.copy(base.repeat)
      tex.offset.copy(base.offset)
    },
    dispose() {
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.dispose()
      material.dispose()
    },
  }
}
