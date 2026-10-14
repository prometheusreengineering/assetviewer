import type { MeshLambertMaterial, Object3D, Texture } from 'three'
import type { DownloadFile, LoadedModel } from '../providers/types'
import { AnimationPlayer, type AnimFile } from './animation/bedrockAnim'
import type { FnLib } from './animation/molang'
import { disposeObject, fitObject } from './fit'
import { buildGeoRig, createMaterial, createTexture, type Bone, type GeoFile } from './geoModel'

/**
 * Where a texture's animation frames sit: a grid of `cols` x `rows` cells filled row by row from the top
 * (a vertical strip is cols = 1), shown until the cumulative times `ends` (ms).
 */
export interface FrameLayout {
  cols: number
  rows: number
  count: number
  ends: number[]
}

export const singleFrame = (): FrameLayout => ({ cols: 1, rows: 1, count: 1, ends: [Infinity] })
/** `count` stacked frames of equal length (Lunar's mcmeta strips). */
export const stackedFrames = (count: number, frameMs: number): FrameLayout => ({ cols: 1, rows: count, count, ends: Array.from({ length: count }, (_, i) => (i + 1) * frameMs) })

/** Index of the frame showing at `ms` (the layout loops). */
export function frameAt(l: FrameLayout, ms: number): number {
  if (l.count <= 1) return 0
  const total = l.ends[l.count - 1]!
  const t = ((ms % total) + total) % total
  let lo = 0
  let hi = l.count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (l.ends[mid]! > t) hi = mid
    else lo = mid + 1
  }
  return lo
}

export interface Rig {
  object: LoadedModel['object']
  material: MeshLambertMaterial
  bones?: Map<string, Bone>
  /** Geometry locators (particle attachment points) by name. */
  locators?: Map<string, Object3D>
  player?: AnimationPlayer
  layout: FrameLayout
  /** Texture rows run bottom-up (flipY textures, e.g. OBJ hats): frame 0 is the top row in texture space. */
  flipY?: boolean
  files: DownloadFile[]
}

/** Points the texture at one cell of the frame grid. */
export function showFrame(tex: Texture, l: FrameLayout, f: number, flipY = false) {
  const col = f % l.cols
  const row = Math.floor(f / l.cols)
  tex.offset.x = col / l.cols
  tex.offset.y = flipY ? 1 - (row + 1) / l.rows : row / l.rows
}

export function finish(r: Rig): LoadedModel {
  const tex = r.material.map!
  const l = r.layout
  tex.repeat.set(1 / l.cols, 1 / l.rows)
  showFrame(tex, l, 0, r.flipY)
  let last = 0
  let state = r.player?.state ?? ''
  return {
    object: r.object,
    files: r.files,
    frames: l.count,
    states: r.player?.states ?? [],
    get state() {
      return state
    },
    setState(s) {
      r.player?.setState(s)
      state = r.player?.state ?? ''
    },
    tick(ms) {
      r.player?.tick(ms)
      if (l.count <= 1) return
      const f = frameAt(l, ms)
      if (f === last) return
      last = f
      showFrame(tex, l, f, r.flipY)
    },
    dispose() {
      disposeObject(r.object)
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.dispose()
      r.material.dispose()
    },
  }
}

export interface RigOptions {
  animFile?: AnimFile
  lib?: FnLib
  /** Preferred default animation states, in order. */
  preferred?: string[]
  /** Keep player-space coordinates (blocks) for dressing a player instead of fitting the model. */
  raw?: boolean
  /** Runs on the root before animation and fitting (handedness fixes). */
  prep?: (root: Object3D) => void
  /** Mirror each face's u (the whole rig is mirrored by prep). */
  flipU?: boolean
}

/** Geo + texture (+ animation) -> rig. */
export function buildRig(geo: GeoFile, bitmap: ImageBitmap, layout: FrameLayout, files: DownloadFile[], o: RigOptions = {}): Rig {
  const tex = createTexture(bitmap)
  const material = createMaterial(tex)
  const { root, bones, locators } = buildGeoRig(geo, material, o.flipU)
  o.prep?.(root)
  const player = o.animFile && o.lib ? new AnimationPlayer(bones, o.animFile, o.lib, o.preferred) : undefined
  // Fit the first frame of the default animation (parts it hides don't count), not the static model.
  player?.tick(0)
  const object = o.raw ? root : fitObject(root)
  return { object, material, bones, locators, player, layout, files }
}
