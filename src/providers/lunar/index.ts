import { zipSync } from 'fflate'
import type { MeshLambertMaterial } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { fileUrl, getFileBuffer, getFileJson, getFileText } from '../../cdn'
import { AnimationPlayer, type AnimFile } from '../../three/animation/bedrockAnim'
import { parseFunctions, type FnLib } from '../../three/animation/molang'
import { disposeObject, fitObject } from '../../three/fit'
import { buildGeoRig, createMaterial, createTexture, type Bone, type GeoFile } from '../../three/geoModel'
import type { CategoryDef, CosmeticProvider, DownloadFile, FilterDef, IndexedFile, LoadedModel } from '../types'
import { loadLunarCatalog, PREFIX, RESOURCE_CATEGORIES, type LunarCatalog, type LunarEntry } from './catalog'

const COSMETIC_LABELS: Record<string, [string, string]> = {
  hat: ['Hats', 'pi-crown'],
  mask: ['Masks', 'pi-face-smile'],
  bandanna: ['Bandannas', 'pi-flag'],
  glasses: ['Glasses', 'pi-eye'],
  dragon_wings: ['Wings', 'pi-send'],
  cloak: ['Cloaks', 'pi-bookmark'],
  pet: ['Pets', 'pi-heart'],
  companion: ['Companions', 'pi-users'],
  suits: ['Suits', 'pi-user'],
  backpack: ['Backpacks', 'pi-briefcase'],
  bodywear: ['Bodywear', 'pi-tag'],
  shoes: ['Shoes', 'pi-arrow-down'],
  neckwear: ['Neckwear', 'pi-link'],
  auras: ['Auras', 'pi-sun'],
  belts: ['Belts', 'pi-minus'],
  shields: ['Shields', 'pi-shield'],
  wristwear: ['Wristwear', 'pi-stopwatch'],
  sword: ['Swords', 'pi-bolt'],
  shovel: ['Shovels', 'pi-wrench'],
  hand: ['Hand items', 'pi-hammer'],
  items: ['Items', 'pi-box'],
}

const RESOURCE_LABELS: Record<string, [string, string]> = {
  badges: ['Badges', 'pi-verified'],
  sprays: ['Sprays', 'pi-palette'],
  emote_icons: ['Emote icons', 'pi-image'],
  emote_textures: ['Emote textures', 'pi-images'],
  emote_data: ['Emote models & data', 'pi-database'],
  particle_textures: ['Particle textures', 'pi-sparkles'],
  particle_data: ['Particle schemes', 'pi-sliders-h'],
  icons: ['Icons', 'pi-th-large'],
  misc: ['Misc images', 'pi-image'],
  data: ['Data & shaders', 'pi-code'],
}

export const ALL_FILES = 'all-files'

let catalog: LunarCatalog | undefined
let byId = new Map<string, LunarEntry>()
let loading: Promise<void> | undefined
let molangLib: Promise<FnLib> | undefined

const stripNs = (p: string) => p.replace(/^lunar:/, '')
const baseName = (p: string) => p.split('/').pop()!
const hashOf = (relPath: string) => {
  const h = catalog!.files.get(PREFIX + stripNs(relPath))
  if (!h) throw new Error(`Not in CDN index: ${relPath}`)
  return h
}
const toBitmap = (buf: ArrayBuffer, flipY: boolean) =>
  createImageBitmap(new Blob([buf]), { imageOrientation: flipY ? 'flipY' : 'none' })

function getLib(): Promise<FnLib> {
  molangLib ??= getFileText(hashOf('cosmetics/functions.molang')).then(parseFunctions)
  return molangLib
}

async function optional(relPath: string): Promise<DownloadFile | undefined> {
  const h = catalog!.files.get(PREFIX + stripNs(relPath))
  return h ? { name: baseName(relPath), data: new Uint8Array(await getFileBuffer(h)) } : undefined
}

interface Mcmeta {
  frameW?: number
  frameH?: number
  frametimeMs: number
}
async function mcmetaFor(relPath: string): Promise<Mcmeta | undefined> {
  const h = catalog!.files.get(PREFIX + stripNs(relPath) + '.mcmeta')
  if (!h) return undefined
  try {
    const a = (await getFileJson<{ animation?: { frametime?: number; width?: number; height?: number } }>(h)).animation ?? {}
    return { frameW: a.width, frameH: a.height, frametimeMs: (a.frametime ?? 1) * 50 }
  } catch {
    return undefined
  }
}

interface Rig {
  object: LoadedModel['object']
  material: MeshLambertMaterial
  bones?: Map<string, Bone>
  player?: AnimationPlayer
  frames: number
  frameMs: number
  /** texture offset.y of frame 0 */
  baseOffset: number
  /** +1 when frames advance upwards in texture space, -1 downwards */
  dir: 1 | -1
  files: DownloadFile[]
}

function finish(r: Rig): LoadedModel {
  const tex = r.material.map!
  let last = -1
  let state = r.player?.state ?? ''
  return {
    object: r.object,
    files: r.files,
    frames: r.frames,
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
      if (r.frames <= 1) return
      const f = Math.floor(ms / r.frameMs) % r.frames
      if (f === last) return
      last = f
      tex.offset.y = r.baseOffset + (r.dir * f) / r.frames
    },
    dispose() {
      disposeObject(r.object)
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.dispose()
      r.material.dispose()
    },
  }
}

/** Shared by gek models and legacy 2D wings: geo + texture (+ animation) -> rig. */
async function buildRig(
  geo: GeoFile,
  texBuf: ArrayBuffer,
  texRel: string,
  animFile: AnimFile | undefined,
  preferred: string[],
  files: DownloadFile[],
): Promise<Rig> {
  const bitmap = await toBitmap(texBuf, false)
  const tex = createTexture(bitmap)
  const d = geo['minecraft:geometry'][0]!.description
  const aspect = (d.texture_height ?? 16) / (d.texture_width ?? 16)
  const mc = await mcmetaFor(texRel)
  const frames = Math.max(1, Math.round(bitmap.height / bitmap.width / aspect))
  tex.repeat.y = 1 / frames
  const material = createMaterial(tex)
  const { root, bones } = buildGeoRig(geo, material)
  const object = fitObject(root)
  const player = animFile ? new AnimationPlayer(bones, animFile, await getLib(), preferred) : undefined
  return { object, material, bones, player, frames, frameMs: mc?.frametimeMs ?? 125, baseOffset: 0, dir: 1, files }
}

async function GREY_PNG(): Promise<ArrayBuffer> {
  const c = new OffscreenCanvas(1, 1)
  const g = c.getContext('2d')!
  g.fillStyle = '#9a9a9a'
  g.fillRect(0, 0, 1, 1)
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()
}

async function loadAnim(path: string | undefined): Promise<{ anim?: AnimFile; file?: DownloadFile }> {
  if (!path || !catalog!.files.has(PREFIX + stripNs(path))) return {}
  const file = await optional(path)
  return { file, anim: JSON.parse(new TextDecoder().decode(file!.data)) as AnimFile }
}

async function loadGek(entry: LunarEntry): Promise<LoadedModel> {
  const gekHash = hashOf(entry.path)
  const raw = await getFileJson<{ model?: string | Record<string, string>; texture?: string; animation?: string }>(gekHash)
  // `model` may map several geometries to conditions (normal / slim arms); use the default one.
  const modelPath = typeof raw.model === 'object' && raw.model ? Object.entries(raw.model).find(([, c]) => !/is_slim/.test(c) || /!/.test(c))?.[0] ?? Object.keys(raw.model)[0] : raw.model
  if (!modelPath || !raw.texture) throw new Error('gek has no model/texture')
  const gek = { model: modelPath, texture: raw.texture, animation: raw.animation }
  const texKnown = catalog!.files.has(PREFIX + stripNs(gek.texture))
  const [geo, texBuf, { anim, file }] = await Promise.all([
    getFileJson<GeoFile>(hashOf(gek.model)),
    // A few items reference a texture that is missing from the CDN; draw them in plain grey.
    texKnown ? getFileBuffer(hashOf(gek.texture)) : GREY_PNG(),
    loadAnim(gek.animation),
  ])
  const files: DownloadFile[] = [
    { name: baseName(entry.path), data: new Uint8Array(await getFileBuffer(gekHash)) },
    { name: baseName(gek.model), data: new TextEncoder().encode(JSON.stringify(geo)) },
    ...(texKnown ? [{ name: baseName(gek.texture), data: new Uint8Array(texBuf) }] : []),
  ]
  if (file) files.push(file)
  return finish(await buildRig(geo, texBuf, stripNs(gek.texture), anim, ['idle'], files))
}

/** Legacy flat wings: a plain webp drawn on the shared simple_2d_wings model. */
async function loadWing2d(entry: LunarEntry): Promise<LoadedModel> {
  const geoRel = 'cosmetics/models/gek/wings/simple_2d_wings.geo.json'
  const animRel = 'cosmetics/models/gek/wings/simple_2d_wings.anim.json'
  const [geo, texBuf, { anim, file }] = await Promise.all([
    getFileJson<GeoFile>(hashOf(geoRel)),
    getFileBuffer(hashOf(entry.path)),
    loadAnim(animRel),
  ])
  const files: DownloadFile[] = [
    { name: baseName(entry.path), data: new Uint8Array(texBuf) },
    { name: baseName(geoRel), data: new TextEncoder().encode(JSON.stringify(geo)) },
  ]
  if (file) files.push(file)
  return finish(await buildRig(geo, texBuf, entry.path, anim, ['main'], files))
}

async function loadObj(entry: LunarEntry): Promise<LoadedModel> {
  const objPath = catalog!.objs.get(entry.modelKey)
  if (!objPath) throw new Error(`No OBJ for ${entry.modelKey}`)
  const [objBuf, texBuf, mc] = await Promise.all([
    getFileBuffer(catalog!.files.get(objPath)!),
    getFileBuffer(hashOf(entry.path)),
    mcmetaFor(entry.path),
  ])
  const bitmap = await toBitmap(texBuf, true)
  const tex = createTexture(bitmap)
  const frames = Math.max(1, Math.round(bitmap.height / bitmap.width))
  tex.repeat.y = 1 / frames
  tex.offset.y = 1 - 1 / frames
  const material = createMaterial(tex)
  const obj = new OBJLoader().parse(new TextDecoder().decode(objBuf))
  obj.traverse((o) => {
    if ('material' in o) (o as unknown as { material: MeshLambertMaterial }).material = material
  })
  const files: DownloadFile[] = [
    { name: baseName(objPath), data: new Uint8Array(objBuf) },
    { name: baseName(entry.path), data: new Uint8Array(texBuf) },
  ]
  return finish({
    object: fitObject(obj),
    material,
    frames,
    frameMs: mc?.frametimeMs ?? 125,
    baseOffset: 1 - 1 / frames,
    dir: -1,
    files,
  })
}

const TEXT_EXT = /\.(json|molang|fsh|vsh|glsl|txt|mcmeta|csv|properties|yml|yaml)$/i

export const lunarProvider: CosmeticProvider = {
  id: 'lunar',
  name: 'Lunar Client',
  available: true,

  load() {
    loading ??= loadLunarCatalog().then((c) => {
      catalog = c
      byId = new Map(c.entries.map((e) => [e.item.id, e]))
    })
    return loading
  },

  categories(): CategoryDef[] {
    const counts = new Map<string, number>()
    for (const e of catalog!.entries) counts.set(e.item.category, (counts.get(e.item.category) ?? 0) + 1)
    const known = Object.keys(COSMETIC_LABELS)
    const cosmetic = [...counts.keys()]
      .filter((id) => !RESOURCE_CATEGORIES.includes(id))
      .sort((a, b) => {
        const ia = known.indexOf(a)
        const ib = known.indexOf(b)
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
      })
    const defs: CategoryDef[] = cosmetic.map((id) => ({
      id,
      count: counts.get(id)!,
      label: COSMETIC_LABELS[id]?.[0] ?? id,
      icon: COSMETIC_LABELS[id]?.[1] ?? 'pi-box',
      group: 'Cosmetics',
    }))
    for (const id of RESOURCE_CATEGORIES) {
      if (!counts.has(id)) continue
      defs.push({ id, count: counts.get(id)!, label: RESOURCE_LABELS[id]![0], icon: RESOURCE_LABELS[id]![1], group: 'Resources' })
    }
    defs.push({ id: ALL_FILES, count: catalog!.files.size, label: 'All files', icon: 'pi-folder-open', group: 'Resources' })
    return defs
  },

  filters(category): FilterDef[] {
    const themes = new Set<string>()
    const colors = new Set<string>()
    let animated = false
    for (const e of catalog!.entries) {
      if (e.item.category !== category) continue
      for (const t of e.item.fields.themes as string[]) themes.add(t)
      for (const c of e.item.fields.colors as string[]) colors.add(c)
      animated ||= e.item.fields.animated === true
    }
    const out: FilterDef[] = []
    if (themes.size) out.push({ key: 'themes', label: 'Theme', type: 'multi', options: [...themes].sort() })
    if (colors.size) out.push({ key: 'colors', label: 'Color', type: 'multi', options: [...colors].sort() })
    if (animated) out.push({ key: 'animated', label: 'Animated', type: 'toggle' })
    return out
  },

  items: (category) => catalog!.entries.filter((e) => e.item.category === category).map((e) => e.item),

  async imageUrl(item) {
    const e = byId.get(item.id)!
    return fileUrl(hashOf(e.path))
  },

  async imageFrames(item) {
    return mcmetaFor(byId.get(item.id)!.path)
  },

  loadModel(item) {
    const e = byId.get(item.id)!
    if (e.kind === 'gek') return loadGek(e)
    if (e.kind === 'wing2d') return loadWing2d(e)
    return loadObj(e)
  },

  async rawFile(item) {
    const e = byId.get(item.id)!
    const url = fileUrl(hashOf(e.path))
    const size = catalog!.sizes.get(PREFIX + e.path) ?? 0
    const text = TEXT_EXT.test(e.path) && size < 400_000 ? await getFileText(hashOf(e.path)) : undefined
    return { name: baseName(e.path), url, text, size }
  },

  indexedFiles(): IndexedFile[] {
    return [...catalog!.files].map(([path, hash]) => ({
      path: path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path,
      hash,
      size: catalog!.sizes.get(path) ?? 0,
    }))
  },

  info: (item) => byId.get(item.id)?.info ?? {},
}

export function zipFiles(files: DownloadFile[]): Uint8Array<ArrayBuffer> {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))) as Uint8Array<ArrayBuffer>
}
