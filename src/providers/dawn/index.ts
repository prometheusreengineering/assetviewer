import { Group, type Object3D } from 'three'
import { getUrlBuffer } from '../../cdn'
import { fetchImageSize } from '../../dimensions'
import { decodeFrames, mimeOf } from '../../three/animatedImage'
import type { AnimFile } from '../../three/animation/bedrockAnim'
import type { FnLib } from '../../three/animation/molang'
import { fitObject } from '../../three/fit'
import type { GeoFile } from '../../three/geoModel'
import { buildRig, finish } from '../../three/rig'
import { CAPE_GEO, CAPE_ON_PLAYER, lunarHashOf } from '../lunar'
import { dressPlayer } from '../lunar/dress'
import type { CategoryDef, CosmeticItem, CosmeticProvider, DownloadFile, FieldDef, IndexedFile, LoadedModel } from '../types'
import { DAWN_CATEGORIES, DAWN_RESOURCES, dawnUrl, loadDawnCatalog, type DawnCatalog, type DawnEntry } from './catalog'

export const EVERYTHING = 'everything'
export const OUTFIT = 'outfit'
const KIND_LABELS: Record<string, string> = { geo: 'Model', variant: 'Colour variant', cloak: 'Cloak', shield: 'Flat shield', trim: 'Armor trim', image: 'Image', file: 'File' }
// Dawn uses no custom Molang functions (only math.* and q.anim_time).
const NO_LIB: FnLib = new Map()

let catalog: DawnCatalog | undefined
let byId = new Map<string, DawnEntry>()
let owners = new Map<string, DawnEntry>()
let loading: Promise<void> | undefined
/** Bytes of files fetched so far (the index has no sizes). */
const sizes = new Map<string, number>()

const baseName = (p: string) => p.split('/').pop()!
function hashOf(path: string) {
  const h = catalog!.files.get(path)
  if (!h) throw new Error(`Not in Dawn index: ${path}`)
  return h
}
async function fetchBuf(path: string) {
  const buf = await getUrlBuffer(dawnUrl(path, hashOf(path)))
  sizes.set(path, buf.byteLength)
  return buf
}
const fetchJson = async <T>(path: string) => JSON.parse(new TextDecoder().decode(await fetchBuf(path))) as T

/**
 * GeckoLib names animations `animation.<model>.<state>`; the player and the modal use the state. `null` is
 * GeckoLib's empty "stop" animation (the rest pose), not worth a menu entry.
 */
export function normalizeAnims(file: AnimFile): AnimFile {
  const animations: AnimFile['animations'] = {}
  for (const [k, v] of Object.entries(file.animations ?? {})) {
    const state = k.split('.').pop()!
    if (state !== 'null' && !(state in animations)) animations[state] = v
  }
  return { ...file, animations }
}

/** Several rigs (an armor trim's slot pieces) as one model. */
function combine(models: LoadedModel[], object: Object3D): LoadedModel {
  const first = models[0]!
  return {
    object,
    files: [],
    frames: Math.max(...models.map((m) => m.frames)),
    states: first.states,
    get state() {
      return first.state
    },
    setState: (s) => models.forEach((m) => m.setState(s)),
    tick: (ms) => models.forEach((m) => m.tick(ms)),
    dispose: () => models.forEach((m) => m.dispose()),
  }
}

async function loadParts(e: DawnEntry, raw: boolean): Promise<LoadedModel> {
  const anim = e.anim ? normalizeAnims(await fetchJson<AnimFile>(e.anim)) : undefined
  const parts = await Promise.all(
    e.parts.map(async (p) => {
      const [geo, img] = await Promise.all([fetchJson<GeoFile>(p.geo), fetchBuf(p.texture).then((b) => decodeFrames(b, mimeOf(p.texture)))])
      const rig = buildRig(geo, img.bitmap, img.layout, [], {
        animFile: anim,
        lib: NO_LIB,
        preferred: ['idle'],
        raw: true,
        flipU: true,
        // Bedrock geometry is x-mirrored and faces -z, like Lunar's geks (see loadGek).
        prep: (root) => (raw ? (root.scale.z *= -1) : (root.scale.x *= -1)),
      })
      return finish(rig)
    }),
  )
  const object = new Group()
  for (const m of parts) object.add(m.object)
  // Shields without an anchor bone are held items: dressing puts them in the left hand.
  if (e.item.category === 'shields') object.userData.attachedBone = 'LEFT_HAND'
  return combine(parts, raw ? object : fitObject(object))
}

async function loadCloak(e: DawnEntry, raw: boolean): Promise<LoadedModel> {
  const img = await decodeFrames(await fetchBuf(e.path), mimeOf(e.path))
  // Cloaks use the OptiFine 22x17 layout (at x16): the same cape box as Lunar's.
  return finish(buildRig(raw ? CAPE_ON_PLAYER : CAPE_GEO, img.bitmap, img.layout, [], { raw }))
}

const blobs = new Map<string, Promise<string>>()
/** Images are shown from blob: URLs of the cached bytes (the CDN has no CORS; see lunar blobUrl). */
function blobUrl(path: string): Promise<string> {
  let p = blobs.get(path)
  if (!p) {
    p = fetchBuf(path).then((b) => URL.createObjectURL(new Blob([b], { type: mimeOf(path) })))
    blobs.set(path, p)
  }
  return p
}

/** The item's files plus the shared ones its model is drawn with (a variant's borrowed geometry, the flat shield). */
function sourcePaths(e: DawnEntry): string[] {
  return [...new Set([...e.files, ...e.parts.flatMap((p) => [p.geo, p.texture]), ...(e.anim ? [e.anim] : []), ...(e.meta ? [e.meta] : [])])]
}

// Typical sizes by extension, for the export estimate before anything was downloaded.
const TYPICAL: Record<string, number> = { avif: 150_000, webp: 20_000, json: 8_000 }

function enrich(c: DawnCatalog) {
  for (const e of c.entries) {
    const f = e.item.fields
    f.category = DAWN_CATEGORIES[e.item.category]?.[0] ?? DAWN_RESOURCES[e.item.category]?.[0] ?? e.item.category
    f.type = e.item.render === '3d' ? '3D' : e.item.render === 'image' ? '2D' : 'File'
    f.kind = KIND_LABELS[e.kind] ?? e.kind
    f.path = e.path
    f.folder = e.path.split('/').slice(0, -1).join('/')
    f.ext = e.path.split('.').pop() ?? ''
    f.model = e.item.render === '3d'
    f.hasAnimation = !!e.anim
    if (e.variantOf) f.variantOf = byId.get(e.variantOf)?.item.name ?? e.variantOf
  }
}

/** Items whose main file is an image, measured lazily for width/height. */
const measurable = (e?: DawnEntry) => !!e && e.kind !== 'file' && /\.(webp|avif|png)$/i.test(e.path)

export const dawnProvider: CosmeticProvider = {
  id: 'dawn',
  name: 'Dawn Client',
  available: true,
  about: { host: 'assets.dawn.gg', owner: 'Dawn Client', credits: ['Models are Bedrock geometry with GeckoLib animations; textures are animated WebP/AVIF.'] },

  load() {
    loading ??= loadDawnCatalog()
      .then((c) => {
        catalog = c
        byId = new Map(c.entries.map((e) => [e.item.id, e]))
        owners = new Map(c.entries.flatMap((e) => e.files.map((f) => [f, e] as const)))
        enrich(c)
      })
      .catch((err) => {
        loading = undefined
        throw err
      })
    return loading
  },

  categories(): CategoryDef[] {
    const counts = new Map<string, number>()
    for (const e of catalog!.entries) counts.set(e.item.category, (counts.get(e.item.category) ?? 0) + 1)
    const defs: CategoryDef[] = [{ id: EVERYTHING, count: catalog!.entries.length, label: 'Everything', icon: 'pi-th-large', group: '' }]
    for (const [id, [label, icon]] of Object.entries(DAWN_CATEGORIES)) if (counts.has(id)) defs.push({ id, label, icon, count: counts.get(id)!, group: 'Cosmetics (3D)' })
    for (const [id, [label, icon]] of Object.entries(DAWN_RESOURCES)) if (counts.has(id)) defs.push({ id, label, icon, count: counts.get(id)!, group: 'Resources' })
    const wearable = catalog!.entries.filter((e) => e.item.render === '3d').length
    defs.push({ id: OUTFIT, count: wearable, label: 'Outfit builder', icon: 'pi-user-edit', group: 'Tools' })
    return defs
  },

  fields(category): FieldDef[] {
    const list = dawnProvider.items(category)
    const has = (k: string) => list.some((it) => it.fields[k] !== undefined && it.fields[k] !== '')
    const opts = (k: string) => [...new Set(list.map((it) => it.fields[k]).filter((v) => v !== undefined && v !== '').map(String))].sort()
    const out: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }]
    const add = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}) => has(key) && out.push({ key, label, type, ...extra })
    add('category', 'Category', 'multi', { options: opts('category') })
    add('collection', 'Collection', 'multi', { options: opts('collection') })
    add('kind', 'Kind', 'multi', { options: opts('kind') })
    add('type', 'Type', 'multi', { options: opts('type') })
    add('ext', 'File type', 'multi', { options: opts('ext') })
    add('folder', 'Folder', 'multi', { options: opts('folder') })
    add('path', 'Path', 'text')
    if (list.some((it) => measurable(byId.get(it.id)))) {
      out.push({ key: 'width', label: 'Image width (px)', type: 'number', lazy: true }, { key: 'height', label: 'Image height (px)', type: 'number', lazy: true })
    }
    add('variantOf', 'Variant of', 'text')
    add('hasAnimation', 'Animated model', 'bool')
    add('model', 'Has 3D model', 'bool')
    return out
  },

  items: (category) => catalog!.entries.filter((e) => category === EVERYTHING || e.item.category === category).map((e) => e.item),

  itemById: (id) => byId.get(id)?.item,

  async dressPlayer(items) {
    // The player body and skin are Lunar's (its CDN has the emote armature).
    const hashOf = await lunarHashOf()
    const entries = items.map((it) => byId.get(it.id)).filter((e): e is DawnEntry => !!e && e.item.render === '3d')
    return dressPlayer(entries, undefined, undefined, hashOf, (e) => dawnProvider.loadModel(e.item, { raw: true }))
  },

  imageUrl: (item) => blobUrl(byId.get(item.id)!.path),

  async loadModel(item, opts) {
    const e = byId.get(item.id)!
    const raw = !!opts?.raw
    if (e.kind !== 'cloak' && !e.parts.length) throw new Error(`${item.name} has no 3D model`)
    const [m, files] = await Promise.all([e.kind === 'cloak' ? loadCloak(e, raw) : loadParts(e, raw), dawnProvider.sourceFiles!(item)])
    m.files = files
    return m
  },

  async sourceFiles(item) {
    const e = byId.get(item.id)
    if (!e) return []
    const paths = sourcePaths(e)
    const seen = new Map<string, number>()
    return Promise.all(
      paths.map(async (p) => {
        const name = baseName(p)
        const n = seen.get(name) ?? 0
        seen.set(name, n + 1)
        return { name: n ? name.replace(/(\.[^.]+)?$/, `_${n}$1`) : name, data: new Uint8Array(await fetchBuf(p)) } satisfies DownloadFile
      }),
    )
  },

  estimateSize(item) {
    const e = byId.get(item.id)
    if (!e) return 0
    return sourcePaths(e).reduce((s, p) => s + (sizes.get(p) ?? TYPICAL[p.split('.').pop()!] ?? 10_000), 0)
  },

  async rawFile(item) {
    const e = byId.get(item.id)!
    const buf = await fetchBuf(e.path)
    const text = /\.json$/i.test(e.path) && buf.byteLength < 400_000 ? new TextDecoder().decode(buf) : undefined
    return { name: baseName(e.path), url: await blobUrl(e.path), text, size: buf.byteLength }
  },

  indexedFiles(): IndexedFile[] {
    return [...catalog!.files].map(([path, hash]) => ({ path, hash, size: sizes.get(path) ?? 0, name: owners.get(path)?.item.name ?? baseName(path) }))
  },

  fileItem(path) {
    const owner = owners.get(path)
    if (owner) return owner.item
    const item: CosmeticItem = { id: path, name: baseName(path), category: 'other', render: 'file', fields: { path, ext: path.split('.').pop() ?? '' } }
    return item
  },

  async ensureDimensions(items, onProgress, signal) {
    const todo = items.filter((it) => it.fields.width === undefined && measurable(byId.get(it.id)))
    let done = 0
    onProgress(0, todo.length)
    const queue = [...todo]
    const worker = async () => {
      for (let it = queue.shift(); it && !signal.aborted; it = queue.shift()) {
        try {
          const path = byId.get(it.id)!.path
          // AVIF keeps its size in the 'ispe' box a few hundred bytes in.
          const size = await fetchImageSize(dawnUrl(path, hashOf(path)), signal, path.endsWith('.avif') ? 1024 : 48)
          if (size) [it.fields.width, it.fields.height] = size
          else it.fields.width = it.fields.height = 0
        } catch {
          if (signal.aborted) return
        }
        onProgress(++done, todo.length)
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
  },

  stats: () => ({ items: catalog!.entries.length, files: catalog!.files.size, indexes: catalog!.indexHash ? [catalog!.indexHash] : [] }),

  info(item) {
    const e = byId.get(item.id)
    if (!e) return {}
    const f = item.fields
    const rows: Record<string, string | undefined> = {
      Type: f.type === '3D' ? '3D model' : f.type === '2D' ? '2D image' : 'File',
      Category: String(f.category ?? item.category),
      Collection: f.collection ? String(f.collection) : undefined,
      Kind: f.kind ? String(f.kind) : undefined,
      'Variant of': f.variantOf ? String(f.variantOf) : undefined,
      'Animated model': e.anim ? 'Yes' : undefined,
      'File type': f.ext ? String(f.ext) : undefined,
      Dimensions: typeof f.width === 'number' && f.width ? `${f.width} × ${f.height} px` : undefined,
      Path: e.path,
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rows)) if (v !== undefined) out[k] = v
    return out
  },
}
