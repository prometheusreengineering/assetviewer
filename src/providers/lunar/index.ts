import { zipSync } from 'fflate'
import type { MeshLambertMaterial } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { fileUrl, getFileBuffer, getFileJson, getFileText } from '../../cdn'
import { AnimationPlayer, type AnimFile } from '../../three/animation/bedrockAnim'
import { parseFunctions, type FnLib } from '../../three/animation/molang'
import { disposeObject, fitObject } from '../../three/fit'
import { buildGeoRig, createMaterial, createTexture, type Bone, type GeoFile } from '../../three/geoModel'
import type { CategoryDef, CosmeticItem, CosmeticProvider, DownloadFile, FieldDef, IndexedFile, LoadedModel } from '../types'
import { LUNAR_INDEXES } from '../../config'
import { fetchImageSize } from '../../dimensions'
import { humanize, loadLunarCatalog, PREFIX, RESOURCE_CATEGORIES, type LunarCatalog, type LunarEntry } from './catalog'

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

let owners: Map<string, LunarEntry> | undefined
/** The catalog entry a file belongs to: the file itself, or a sibling sharing its folder and stem (geo, anim, texture, mcmeta). */
function ownerOf(path: string): LunarEntry | undefined {
  if (!owners) {
    owners = new Map()
    const key = (p: string) => p.replace(/\/(textures|thumbnail)\//, '/').replace(/\.(mcmeta|gek\.json|geo\.json|anim\.json|webp|png|gif|jpe?g)/g, '')
    for (const e of catalog!.entries) {
      owners.set(e.path, e)
      owners.set(key(e.path), e)
    }
  }
  const direct = owners.get(path) ?? owners.get(path.replace(/\.mcmeta$/, ''))
  return direct ?? owners.get(path.replace(/\/(textures|thumbnail)\//, '/').replace(/\.(mcmeta|gek\.json|geo\.json|anim\.json|webp|png|gif|jpe?g)/g, ''))
}

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

// Lunar cloaks use the OptiFine layout: a 22x17 base grid (scaled by any integer), cape box 10x16x1 at uv 0,0.
const CAPE_GEO: GeoFile = {
  'minecraft:geometry': [
    {
      description: { texture_width: 22, texture_height: 17 },
      bones: [{ name: 'cape', pivot: [0, 0, 0], rotation: [0, 180, 0], cubes: [{ origin: [-5, 0, -1], size: [10, 16, 1], uv: [0, 0] }] }],
    },
  ],
}

async function loadCloak(entry: LunarEntry): Promise<LoadedModel> {
  const texBuf = await getFileBuffer(hashOf(entry.path))
  const files: DownloadFile[] = [{ name: baseName(entry.path), data: new Uint8Array(texBuf) }]
  return finish(await buildRig(CAPE_GEO, texBuf, entry.path, undefined, [], files))
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

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const blobs = new Map<string, Promise<string>>()
/** Images are fetched through the CORS-safe hash cache and shown from a blob: URL, so a poisoned browser HTTP cache entry can never break <img>. */
function blobUrl(path: string): Promise<string> {
  let p = blobs.get(path)
  if (!p) {
    const type = MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'
    p = getFileBuffer(hashOf(path)).then((b) => URL.createObjectURL(new Blob([b], { type })))
    blobs.set(path, p)
  }
  return p
}

/** Entries whose main file is an image whose header can be read for width/height. */
const measurable = (e?: LunarEntry) => !!e && e.kind !== 'gek' && e.kind !== 'file' && /\.(webp|png|gif)$/i.test(e.path)

/** Fills the catalog-wide fields (id, size, path, folder, ...) used by the filter and sort bar. */
function enrich(c: LunarCatalog) {
  for (const e of c.entries) {
    const f = e.item.fields
    const ext = e.path.split('.').pop() ?? ''
    if (/^\d+$/.test(e.item.id)) f.id = Number(e.item.id)
    f.path = e.path
    f.folder = e.path.split('/').slice(0, -1).join('/')
    f.ext = ext
    f.size = c.sizes.get(PREFIX + e.path) ?? 0
    f.type = e.item.render === '3d' ? '3D' : e.item.render === 'image' ? '2D' : 'File'
    f.model = e.item.render === '3d'
  }
}

export const lunarProvider: CosmeticProvider = {
  id: 'lunar',
  name: 'Lunar Client',
  available: true,

  load() {
    loading ??= loadLunarCatalog().then((c) => {
      catalog = c
      byId = new Map(c.entries.map((e) => [e.item.id, e]))
      owners = undefined
      enrich(c)
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
      group: 'Cosmetics (3D)',
    }))
    for (const id of RESOURCE_CATEGORIES) {
      if (!counts.has(id)) continue
      defs.push({ id, count: counts.get(id)!, label: RESOURCE_LABELS[id]![0], icon: RESOURCE_LABELS[id]![1], group: 'Resources (2D)' })
    }
    defs.unshift({ id: ALL_FILES, count: catalog!.files.size, label: 'All files', icon: 'pi-folder-open', group: '' })
    return defs
  },

  fields(category): FieldDef[] {
    const list = catalog!.entries.filter((e) => e.item.category === category).map((e) => e.item)
    const has = (k: string) => list.some((it) => it.fields[k] !== undefined && it.fields[k] !== '' && !(Array.isArray(it.fields[k]) && !(it.fields[k] as string[]).length))
    const opts = (k: string) => [...new Set(list.flatMap((it) => (Array.isArray(it.fields[k]) ? (it.fields[k] as string[]) : it.fields[k] ? [String(it.fields[k])] : [])))].sort()
    const out: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }]
    const add = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}) => has(key) && out.push({ key, label, type, ...extra })
    add('id', 'ID', 'number')
    add('released', 'Released', 'date')
    add('themes', 'Theme', 'multi', { options: opts('themes') })
    add('colors', 'Color', 'multi', { options: opts('colors') })
    add('type', 'Type', 'multi', { options: opts('type') })
    add('ext', 'File type', 'multi', { options: opts('ext') })
    add('folder', 'Folder', 'multi', { options: opts('folder') })
    add('path', 'Path', 'text')
    add('size', 'File size (bytes)', 'number')
    if (list.some((it) => measurable(byId.get(it.id)))) {
      out.push({ key: 'width', label: 'Image width (px)', type: 'number', lazy: true }, { key: 'height', label: 'Image height (px)', type: 'number', lazy: true })
    }
    add('animated', 'Animated', 'bool')
    add('special', 'Special', 'bool')
    add('model', 'Has 3D model', 'bool')
    return out
  },

  async ensureDimensions(items, onProgress, signal) {
    const todo = items.filter((it) => it.fields.width === undefined && measurable(byId.get(it.id)))
    let done = 0
    onProgress(0, todo.length)
    const queue = [...todo]
    const worker = async () => {
      for (let it = queue.shift(); it && !signal.aborted; it = queue.shift()) {
        try {
          const size = await fetchImageSize(fileUrl(hashOf(byId.get(it.id)!.path)), signal)
          if (size) [it.fields.width, it.fields.height] = size
          else it.fields.width = it.fields.height = 0
        } catch {
          if (signal.aborted) return
        }
        onProgress(++done, todo.length)
      }
    }
    await Promise.all(Array.from({ length: 12 }, worker))
  },

  items: (category) => catalog!.entries.filter((e) => e.item.category === category).map((e) => e.item),

  async imageUrl(item) {
    const e = byId.get(item.id)!
    return blobUrl(e.path)
  },

  async imageFrames(item) {
    return mcmetaFor(byId.get(item.id)!.path)
  },

  loadModel(item) {
    const e = byId.get(item.id)!
    if (e.kind === 'gek') return loadGek(e)
    if (e.kind === 'wing2d') return loadWing2d(e)
    if (e.kind === 'cloak') return loadCloak(e)
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
    return [...catalog!.files].map(([full, hash]) => {
      const path = full.startsWith(PREFIX) ? full.slice(PREFIX.length) : full
      return { path, hash, size: catalog!.sizes.get(full) ?? 0, name: ownerOf(path)?.item.name ?? `${humanize(path)} (file)` }
    })
  },

  fileItem(path) {
    const owner = ownerOf(path)
    if (owner) return owner.item
    const id = `file:${path}`
    let e = byId.get(id)
    if (!e) {
      const image = /\.(webp|png|gif|jpe?g)$/i.test(path)
      const item: CosmeticItem = {
        id,
        name: `${humanize(path)} (file)`,
        category: ALL_FILES,
        fields: { ext: path.split('.').pop() ?? '', themes: [], colors: [] },
        render: image ? 'image' : 'file',
      }
      e = { item, path, modelKey: '', kind: image ? 'image' : 'file', info: { Path: path } }
      byId.set(id, e)
    }
    return e.item
  },

  stats: () => ({ items: catalog!.entries.length, files: catalog!.files.size, indexes: LUNAR_INDEXES }),

  info: (item) => {
    const e = byId.get(item.id)
    if (!e) return {}
    const f = item.fields
    const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : undefined)
    const yn = (v: unknown) => (v === undefined ? undefined : v ? 'Yes' : 'No')
    const rows: Record<string, string | undefined> = {
      Type: f.type === '3D' ? '3D model' : f.type === '2D' ? '2D image' : 'File',
      Category: (COSMETIC_LABELS[item.category] ?? RESOURCE_LABELS[item.category])?.[0] ?? item.category,
      ID: f.id !== undefined ? String(f.id) : undefined,
      Released: typeof f.released === 'number' ? new Date(f.released).toISOString().slice(0, 10) : undefined,
      Themes: list(f.themes),
      Colors: list(f.colors),
      Animated: yn(f.animated),
      Special: yn(f.special),
      'File type': f.ext ? String(f.ext) : undefined,
      'File size': typeof f.size === 'number' && f.size ? `${f.size.toLocaleString()} bytes` : undefined,
      Dimensions: typeof f.width === 'number' && f.width ? `${f.width} × ${f.height} px` : undefined,
      Folder: f.folder ? String(f.folder) : undefined,
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rows)) if (v !== undefined) out[k] = v
    // catalog extras (description, source path, ...) that aren't already shown
    for (const [k, v] of Object.entries(e.info)) if (!(k in out) && k !== 'ID' && k !== 'Released') out[k] = v
    return out
  },
}

export function zipFiles(files: DownloadFile[]): Uint8Array<ArrayBuffer> {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))) as Uint8Array<ArrayBuffer>
}
