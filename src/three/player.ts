import { Group, type Material, type MeshLambertMaterial, type SkinnedMesh, type Texture } from 'three'
import { buildSkeleton, poseSkeleton, skinnedMesh, type BobjAction, type BobjFile, type BobjMesh, type BobjSkeleton } from './bobj'
import { disposeObject } from './fit'
import { createMaterial, createTexture } from './geoModel'

/** A skinned Minecraft player built from the emote body (.bobj), in blocks (feet at y=0, 2 tall) like raw cosmetics. */
export interface Player {
  object: Group
  skel: BobjSkeleton
  /** Adds a mesh (an emote prop) skinned to the same skeleton. */
  addMesh(m: BobjMesh, texture: ImageBitmap): SkinnedMesh
  setSkin(bitmap: ImageBitmap): void
  /** Hides skin pixels under worn cosmetics: black pixels of any mask (64x64 skin layout) turn transparent. */
  maskSkin(masks: ImageBitmap[]): Promise<void>
  /** Hides body parts a worn cosmetic replaces (gek `hide_left_arm` etc.): head, body, right_arm, left_arm, right_leg, left_leg. */
  hideParts(parts: string[]): void
  pose(action: BobjAction | undefined, tick: number): void
  dispose(): void
}

const PART_BONES: Record<string, string[]> = {
  head: ['head'],
  body: ['body', 'low_body'],
  right_arm: ['right_arm', 'low_right_arm', 'low_right_arm.end', 'low_right_arm.item'],
  left_arm: ['left_arm', 'low_left_arm', 'low_left_arm.end', 'low_left_arm.item'],
  right_leg: ['right_leg', 'low_leg_right'],
  left_leg: ['left_leg', 'low_left_leg'],
}

/** The skin with every pixel a mask paints black made transparent (Essential skin masks, 64x64 at skin scale). */
export async function maskedSkin(base: ImageBitmap, masks: ImageBitmap[]): Promise<ImageBitmap> {
  const w = base.width
  const h = base.height
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(base, 0, 0)
  const px = g.getImageData(0, 0, w, h)
  // Masks are drawn at the skin's scale (64 px = one skin width; legacy 64x32 skins get the top half).
  const k = w / 64
  const mc = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!
  mc.imageSmoothingEnabled = false
  for (const m of masks) {
    mc.clearRect(0, 0, w, h)
    mc.drawImage(m, 0, 0, m.width * k, m.height * k)
    const md = mc.getImageData(0, 0, w, h).data
    for (let i = 0; i < md.length; i += 4) if (md[i + 3]! > 0 && md[i]! < 128) px.data[i + 3] = 0
  }
  g.putImageData(px, 0, 0)
  return createImageBitmap(canvas)
}

export function createPlayer(body: BobjFile, skin: ImageBitmap): Player {
  const skel = buildSkeleton(body.bones)
  const object = new Group()
  const materials: Material[] = []
  const textures: Texture[] = []
  const material = (bitmap: ImageBitmap) => {
    const tex = createTexture(bitmap)
    const m = createMaterial(tex)
    textures.push(tex)
    materials.push(m)
    return m
  }
  const bodyMat = material(skin)
  // The skin as set, before any masks.
  let base = skin
  const applyTexture = (bitmap: ImageBitmap) => {
    const old = bodyMat.map!
    const tex = createTexture(bitmap)
    ;(bodyMat as MeshLambertMaterial).map = tex
    bodyMat.needsUpdate = true
    textures.push(tex)
    old.dispose()
  }
  const bodyMesh = skinnedMesh(body.meshes.get('body')!, skel, bodyMat)
  for (const r of skel.roots) bodyMesh.add(r)
  object.add(bodyMesh)
  return {
    object,
    skel,
    addMesh(m, texture) {
      const mesh = skinnedMesh(m, skel, material(texture))
      object.add(mesh)
      return mesh
    },
    setSkin(bitmap) {
      base = bitmap
      applyTexture(bitmap)
    },
    async maskSkin(masks) {
      applyTexture(masks.length ? await maskedSkin(base, masks) : base)
    },
    hideParts(parts) {
      const hidden = new Set(parts.flatMap((p) => PART_BONES[p] ?? []))
      const bones = skel.skeleton.bones
      const g = bodyMesh.geometry
      const si = g.getAttribute('skinIndex')
      const n = g.getAttribute('position').count
      // Non-indexed triangles: keep the ones whose first vertex's main bone is still shown.
      const keep: number[] = []
      for (let i = 0; i < n; i += 3) if (!hidden.has(bones[si.getX(i)]!.name)) keep.push(i, i + 1, i + 2)
      g.setIndex(hidden.size ? keep : null)
    },
    pose(action, tick) {
      poseSkeleton(skel, action, tick)
    },
    dispose() {
      disposeObject(object)
      for (const t of textures) t.dispose()
      for (const m of materials) m.dispose()
      skel.skeleton.dispose()
    },
  }
}
