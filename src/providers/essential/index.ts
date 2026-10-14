import { del, get, set } from 'idb-keyval'
import { Group } from 'three'
import { ref } from 'vue'
import { getUrlBuffer } from '../../cdn'
import { decodeFrames } from '../../three/animatedImage'
import { normalizeAnims, type AnimFile } from '../../three/animation/bedrockAnim'
import { fitObject } from '../../three/fit'
import type { GeoFile } from '../../three/geoModel'
import { addGlowLayer } from '../../three/glow'
import { buildRig, finish, stackedFrames } from '../../three/rig'
import { lunarHashOf } from '../lunar'
import { dressPlayer } from '../lunar/dress'
import type { CategoryDef, CosmeticItem, CosmeticProvider, DownloadFile, FieldDef, LoadedModel } from '../types'
import { buildEssentialCatalog, categoryId, ESSENTIAL_CATEGORIES, orderVariants, type EssentialCatalog, type EssentialEntry } from './catalog'
import { boneSide, defaultSide, hiddenBones, sidesOf } from './rules'
import { assetBytes, filesSource, handleSource, listingSource, readDumps, resolveFolders, subSource, type EssentialFolders } from './localData'

export const EVERYTHING = 'everything'
export const OUTFIT = 'outfit'
const HANDLE_KEY = 'assetviewer.essential.dir'
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
// Essential's BedrockModel.TEXTURE_ANIMATION_FPS
const TEXTURE_FPS = 7
const TILE_CATEGORIES = new Set(['EMOTE', 'EFFECT', 'ICON'])

let folders: EssentialFolders | undefined
let catalog: EssentialCatalog | undefined
let byId = new Map<string, EssentialEntry>()

/** Connection state for the setup panel. */
export const essentialState = ref<{ connected: boolean; storedHandle: boolean; items: number; files: number; error?: string }>({ connected: false, storedHandle: false, items: 0, files: 0 })

/** Reads the dumps of `f` and makes them the catalog. */
export async function connect(f: Partial<EssentialFolders>): Promise<void> {
  if (!f.dumps) throw new Error('No Essential dumps found in that folder (expected prometheus/essential/dumps).')
  const c = buildEssentialCatalog(await readDumps(f.dumps))
  if (!c.entries.length) throw new Error('The dumps folder has no cosmetics.')
  folders = { dumps: f.dumps, cache: f.cache }
  catalog = c
  byId = new Map(c.entries.map((e) => [e.item.id, e]))
  essentialState.value = { ...essentialState.value, connected: true, items: c.entries.length, files: c.files, error: undefined }
}

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>
}

/** Folder picker (Chromium): the user picks `.minecraft`; the handle is remembered for the next visit. */
export async function pickFolder(): Promise<void> {
  const pick = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> }).showDirectoryPicker
  if (!pick) throw new Error('This browser cannot open folders; use the two folder fields instead.')
  const handle = await pick({ id: 'essential', mode: 'read' })
  await connect(await resolveFolders(handleSource(handle)))
  try {
    await set(HANDLE_KEY, handle)
  } catch {}
}

/** Re-opens the remembered folder; asks for permission again when the browser wants a click for it. */
export async function reconnect(ask: boolean): Promise<boolean> {
  let handle: DirHandle | undefined
  try {
    handle = await get<DirHandle>(HANDLE_KEY)
  } catch {
    return false
  }
  if (!handle) return false
  essentialState.value = { ...essentialState.value, storedHandle: true }
  let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
  if (perm !== 'granted' && ask) perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
  if (perm !== 'granted') return false
  await connect(await resolveFolders(handleSource(handle)))
  return true
}

/** `<input webkitdirectory>` fallback: the dumps folder and (optionally) Essential's cosmetic-cache folder. */
export async function connectFiles(dumps: Iterable<File>, cache?: Iterable<File>): Promise<void> {
  await connect({ dumps: filesSource(dumps), cache: cache ? filesSource(cache) : undefined })
}

export async function forget(): Promise<void> {
  try {
    await del(HANDLE_KEY)
  } catch {}
  folders = undefined
  catalog = undefined
  byId = new Map()
  essentialState.value = { connected: false, storedHandle: false, items: 0, files: 0 }
}

const download = (url: string) => getUrlBuffer(url)
async function bytes(e: EssentialEntry, path: string): Promise<ArrayBuffer> {
  const ref = e.files.get(path)
  if (!ref) throw new Error(`${e.item.name} has no ${path}`)
  return assetBytes(folders!, ref, download)
}
const json = async <T>(e: EssentialEntry, path: string) => JSON.parse(new TextDecoder().decode(await bytes(e, path))) as T
const optionalJson = async <T>(e: EssentialEntry, path: string | undefined) => (path ? json<T>(e, path).catch(() => undefined) : undefined)

// A transparent 1x1 stand-in when the default variant has no glow but another one does.
async function blankBitmap() {
  return createImageBitmap(new OffscreenCanvas(1, 1))
}

interface EssentialAnimFile extends AnimFile {
  triggers?: { type?: string; name?: string }[]
}

async function loadModel(e: EssentialEntry, raw: boolean): Promise<LoadedModel> {
  if (!e.geometry || !e.textures.length) throw new Error(`${e.item.name} has no 3D model`)
  const [geo, anim, settings] = await Promise.all([json<GeoFile>(e, e.geometry), optionalJson<EssentialAnimFile>(e, e.animations), optionalJson<unknown>(e, e.settings)])
  const textures = orderVariants(e.textures, settings)
  const decode = async (path: string) => decodeFrames(await bytes(e, path), 'image/png')
  const img = await decode(textures[0]!.path)
  // Animated textures are frames stacked vertically (e.g. 64x1024 for a 64x64 model), played at 7 fps.
  const d = geo['minecraft:geometry']?.[0]?.description
  const aspect = (d?.texture_height ?? 64) / (d?.texture_width ?? 64)
  const stacked = Math.round(img.bitmap.height / img.bitmap.width / aspect)
  if (img.layout.count <= 1 && stacked > 1) img.layout = stackedFrames(stacked, 1000 / TEXTURE_FPS)
  // The animation the IDLE trigger plays is the resting state.
  const idle = anim?.triggers?.find((t) => t.type === 'IDLE')?.name?.split('.').pop()
  const rig = buildRig(geo, img.bitmap, img.layout, [], {
    animFile: anim ? normalizeAnims(anim) : undefined,
    lib: new Map(),
    preferred: [...(idle ? [idle] : []), 'idle'],
    raw: true,
    flipU: true,
    // Bedrock geometry is x-mirrored and faces -z, like Lunar's geks (see loadGek).
    prep: (root) => (raw ? (root.scale.z *= -1) : (root.scale.x *= -1)),
  })
  const model = finish(rig)
  // Glow layer (emissive.png), drawn full-bright over the lit model.
  const glowOf = async (t: (typeof textures)[number]) => (t.emissive ? (await decode(t.emissive).catch(() => undefined))?.bitmap : undefined)
  const firstGlow = await glowOf(textures[0]!)
  const glow = textures.some((t) => t.emissive) ? addGlowLayer(rig.object, firstGlow ?? (await blankBitmap())) : undefined
  if (glow && !firstGlow) glow.setImage(undefined)
  glow?.sync(rig.material.map!)
  const object = new Group()
  object.add(model.object)
  // One-sided cosmetics: bones tagged side_left/side_right/... show only for the chosen side.
  const sides = sidesOf(rig.bones?.keys() ?? [], e.files.keys())
  let side = defaultSide(sides, settings)
  const applySide = () => {
    for (const [name, b] of rig.bones ?? []) {
      const s = boneSide(name)
      if (s) b.group.visible = s === side
    }
  }
  applySide()
  // Raw (on a player): the skin mask hides skin pixels under the cosmetic (per side when it has sides);
  // dressPlayer combines the worn ones and applies the settings' hiding rules through the bones.
  if (raw) {
    const sideMask = side && e.files.has(`skin_mask.steve.${side}.png`) ? `skin_mask.steve.${side}.png` : undefined
    const maskPath = sideMask ?? e.skinMask?.steve
    if (maskPath) {
      object.userData.skinMask = await bytes(e, maskPath)
        .then((b) => createImageBitmap(new Blob([b], { type: 'image/png' })))
        .catch(() => undefined)
    }
    object.userData.essential = { id: e.item.id, settings, bones: rig.bones }
  }
  const out: LoadedModel = {
    ...model,
    tick(ms) {
      model.tick(ms)
      if (glow) glow.sync(rig.material.map!)
    },
    object: raw ? object : fitObject(object),
    dispose() {
      model.dispose()
      glow?.dispose()
      ;(object.userData.skinMask as ImageBitmap | undefined)?.close?.()
    },
  }
  // `state` is a getter on the finished model; keep it live.
  Object.defineProperty(out, 'state', { get: () => model.state })
  const files: DownloadFile[] = []
  for (const p of [e.geometry, textures[0]!.path, e.animations, e.settings]) {
    if (!p) continue
    try {
      files.push({ name: p.replace(/\//g, '_'), data: new Uint8Array(await bytes(e, p)) })
    } catch {}
  }
  out.files = files
  if (sides.length > 1) {
    out.sides = sides
    out.side = side
    out.setSide = (s) => {
      if (!sides.includes(s as never)) return
      side = s as typeof side
      out.side = s
      applySide()
    }
  }
  if (textures.length > 1) {
    out.variants = textures.map((t) => t.name)
    out.variant = textures[0]!.name
    out.setVariant = async (name) => {
      const t = textures.find((x) => x.name === name)
      if (!t || name === out.variant) return
      const next = await decode(t.path)
      const tex = rig.material.map!
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.image = next.bitmap
      tex.needsUpdate = true
      glow?.setImage(await glowOf(t))
      out.variant = name
    }
  }
  return out
}

export const essentialProvider: CosmeticProvider = {
  id: 'essential',
  name: 'Essential',
  available: true,
  about: { host: 'your own Essential files (nothing is hosted here)', owner: 'Essential or ModCore' },
  setup: { needed: () => !catalog },

  async load() {
    if (catalog) return
    try {
      await reconnect(false)
    } catch (err) {
      essentialState.value = { ...essentialState.value, error: String(err) }
    }
  },

  categories(): CategoryDef[] {
    if (!catalog) return []
    const counts = new Map<string, number>()
    for (const e of catalog.entries) counts.set(e.item.category, (counts.get(e.item.category) ?? 0) + 1)
    const defs: CategoryDef[] = [{ id: EVERYTHING, count: catalog.entries.length, label: 'Everything', icon: 'pi-th-large', group: '' }]
    for (const [b, [label, icon]] of Object.entries(ESSENTIAL_CATEGORIES)) {
      const id = categoryId(b)
      // Emotes, effects and icons aren't wearable models (yet), so they are not outfit slots.
      if (counts.has(id)) defs.push({ id, label, icon, count: counts.get(id)!, group: TILE_CATEGORIES.has(b) ? 'Emotes & effects' : 'Cosmetics (3D)' })
    }
    const wearable = catalog.entries.filter((e) => !e.item.thumb).length
    defs.push({ id: OUTFIT, count: wearable, label: 'Outfit builder', icon: 'pi-user-edit', group: 'Tools' })
    return defs
  },

  fields(category): FieldDef[] {
    const list = essentialProvider.items(category)
    const opts = (k: string) => [...new Set(list.flatMap((it) => (Array.isArray(it.fields[k]) ? (it.fields[k] as string[]) : it.fields[k] ? [String(it.fields[k])] : [])))].sort()
    const has = (k: string) => list.some((it) => it.fields[k] !== undefined && it.fields[k] !== '' && !(Array.isArray(it.fields[k]) && !(it.fields[k] as string[]).length))
    const out: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }]
    const add = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}) => has(key) && out.push({ key, label, type, ...extra })
    add('category', 'Category', 'multi', { options: opts('category') })
    add('rarity', 'Rarity', 'multi', { options: RARITIES.filter((r) => opts('rarity').includes(r)) })
    add('price', 'Price (coins)', 'number')
    add('themes', 'Theme', 'multi', { options: opts('themes') })
    add('collections', 'Collection', 'multi', { options: opts('collections') })
    add('variants', 'Variant', 'multi', { options: opts('variants') })
    add('slots', 'Slot', 'multi', { options: opts('slots') })
    add('flags', 'Flags', 'multi', { options: opts('flags') })
    add('hasAnimation', 'Animated', 'bool')
    add('files', 'Files', 'number')
    return out
  },

  items: (category) => (catalog?.entries ?? []).filter((e) => category === EVERYTHING || e.item.category === category).map((e) => e.item),

  itemById: (id) => byId.get(id)?.item,

  async dressPlayer(items) {
    // The player body and skin are Lunar's (its CDN has the emote armature), like Dawn's outfits.
    const hashOf = await lunarHashOf()
    const worn = items.map((it) => byId.get(it.id)).filter((e): e is EssentialEntry => !!e && !e.item.thumb).map((e) => ({ kind: 'essential', item: e.item }))
    const loaded: LoadedModel[] = []
    const dressed = await dressPlayer(worn, undefined, undefined, hashOf, async (w) => {
      const m = await essentialProvider.loadModel(w.item, { raw: true })
      loaded.push(m)
      return m
    })
    // settings.json rules between the worn cosmetics (bones keep their identity after being socketed).
    type Info = { id: string; settings: unknown; bones?: Map<string, { group: { visible: boolean } }> }
    const infos = loaded.map((m) => m.object.userData.essential as Info | undefined).filter((x): x is Info => !!x)
    for (const [id, names] of hiddenBones(infos)) {
      const bones = infos.find((i) => i.id === id)?.bones
      for (const n of names) {
        const b = bones?.get(n)
        if (b) b.group.visible = false
      }
    }
    return dressed
  },

  imageUrl: () => Promise.reject(new Error('Essential items are 3D models')),

  loadModel(item, opts) {
    const e = byId.get(item.id)
    if (!e) return Promise.reject(new Error(`Unknown item ${item.id}`))
    return loadModel(e, !!opts?.raw)
  },

  async sourceFiles(item) {
    const e = byId.get(item.id)
    if (!e) return []
    const out: DownloadFile[] = []
    for (const p of e.files.keys()) {
      try {
        out.push({ name: p.replace(/\//g, '_'), data: new Uint8Array(await bytes(e, p)) })
      } catch {}
    }
    return out
  },

  estimateSize: (item) => (byId.get(item.id)?.files.size ?? 0) * 6_000,

  stats: () => ({ items: catalog?.entries.length ?? 0, files: catalog?.files ?? 0, indexes: [] }),

  info(item: CosmeticItem) {
    const f = item.fields
    const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : undefined)
    const rows: Record<string, string | undefined> = {
      Category: f.category ? String(f.category) : undefined,
      Rarity: f.rarity ? String(f.rarity) : undefined,
      Price: typeof f.price === 'number' ? `${f.price.toLocaleString()} coins` : undefined,
      Themes: list(f.themes),
      Collections: list(f.collections),
      Variants: list(f.variants),
      Slots: list(f.slots),
      Animated: f.hasAnimation ? 'Yes' : undefined,
      Files: typeof f.files === 'number' ? String(f.files) : undefined,
      ID: item.id,
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rows)) if (v !== undefined) out[k] = v
    return out
  },
}

// Dev only: headless checks can't click a folder picker, so they connect a source directly.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__essential = { connect, resolveFolders, listingSource, subSource }
}
