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
  pose(action: BobjAction | undefined, tick: number): void
  dispose(): void
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
      const old = bodyMat.map!
      const tex = createTexture(bitmap)
      ;(bodyMat as MeshLambertMaterial).map = tex
      bodyMat.needsUpdate = true
      textures.push(tex)
      old.dispose()
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
