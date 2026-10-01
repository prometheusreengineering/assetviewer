import { zipSync } from 'fflate'
import type { MeshLambertMaterial } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { fileUrl, getFileBuffer, getFileJson } from '../../cdn'
import { disposeObject, fitObject } from '../../three/fit'
import { buildGeoModel, createMaterial, createTexture, type GeoFile } from '../../three/geoModel'
import type { CategoryDef, CosmeticProvider, DownloadFile, FilterDef, LoadedModel } from '../types'
import { loadLunarCatalog, PREFIX, type LunarCatalog, type LunarEntry } from './catalog'

const LABELS: Record<string, [string, string]> = {
  hat: ['Hats', 'pi-crown'],
  mask: ['Masks', 'pi-face-smile'],
  bandanna: ['Bandannas', 'pi-flag'],
  glasses: ['Glasses', 'pi-eye'],
  dragon_wings: ['Wings', 'pi-send'],
  cloak: ['Cloaks', 'pi-bookmark'],
  pet: ['Pets', 'pi-heart'],
  suits: ['Suits', 'pi-user'],
  backpack: ['Backpacks', 'pi-briefcase'],
  bodywear: ['Bodywear', 'pi-tag'],
  shoes: ['Shoes', 'pi-arrow-down'],
  neckwear: ['Neckwear', 'pi-link'],
  auras: ['Auras', 'pi-sun'],
  belts: ['Belts', 'pi-minus'],
  shields: ['Shields', 'pi-shield'],
  wristwear: ['Wristwear', 'pi-stopwatch'],
}

let catalog: LunarCatalog | undefined
let byId = new Map<string, LunarEntry>()
let loading: Promise<void> | undefined

const stripNs = (p: string) => p.replace(/^lunar:/, '')
const baseName = (p: string) => p.split('/').pop()!
const hashOf = (relPath: string) => {
  const h = catalog!.files.get(PREFIX + stripNs(relPath))
  if (!h) throw new Error(`Not in CDN index: ${relPath}`)
  return h
}
const toBitmap = (buf: ArrayBuffer, flipY: boolean) =>
  createImageBitmap(new Blob([buf]), { imageOrientation: flipY ? 'flipY' : 'none' })

async function optional(relPath: string): Promise<DownloadFile | undefined> {
  const h = catalog!.files.get(PREFIX + stripNs(relPath))
  return h ? { name: baseName(relPath), data: new Uint8Array(await getFileBuffer(h)) } : undefined
}

function finish(
  object: LoadedModel['object'],
  material: MeshLambertMaterial,
  frames: number,
  /** texture offset.y of frame 0 */
  baseOffset: number,
  /** +1 when frames advance upwards in texture space, -1 downwards */
  dir: 1 | -1,
  files: DownloadFile[],
): LoadedModel {
  const tex = material.map!
  let last = -1
  return {
    object,
    files,
    frames,
    tick(ms) {
      if (frames <= 1) return
      const f = Math.floor(ms / 125) % frames
      if (f === last) return
      last = f
      tex.offset.y = baseOffset + (dir * f) / frames
    },
    dispose() {
      disposeObject(object)
      ;(tex.image as ImageBitmap | undefined)?.close?.()
      tex.dispose()
      material.dispose()
    },
  }
}

async function loadGek(entry: LunarEntry): Promise<LoadedModel> {
  const gekHash = hashOf(entry.path)
  const gek = await getFileJson<{ model?: string; texture?: string; animation?: string }>(gekHash)
  if (!gek.model || !gek.texture) throw new Error('gek has no model/texture')
  const [geo, texBuf, anim] = await Promise.all([
    getFileJson<GeoFile>(hashOf(gek.model)),
    getFileBuffer(hashOf(gek.texture)),
    gek.animation ? optional(gek.animation) : undefined,
  ])
  const bitmap = await toBitmap(texBuf, false)
  const tex = createTexture(bitmap)
  const d = geo['minecraft:geometry'][0]!.description
  const aspect = (d.texture_height ?? 16) / (d.texture_width ?? 16)
  const frames = Math.max(1, Math.round(bitmap.height / bitmap.width / aspect))
  tex.repeat.y = 1 / frames
  const material = createMaterial(tex)
  const object = fitObject(buildGeoModel(geo, material))
  const files: DownloadFile[] = [
    { name: baseName(entry.path), data: new Uint8Array(await getFileBuffer(gekHash)) },
    { name: baseName(gek.model), data: new TextEncoder().encode(JSON.stringify(geo)) },
    { name: baseName(gek.texture), data: new Uint8Array(texBuf) },
  ]
  if (anim) files.push(anim)
  return finish(object, material, frames, 0, 1, files)
}

async function loadObj(entry: LunarEntry): Promise<LoadedModel> {
  const objPath = catalog!.objs.get(entry.modelKey)
  if (!objPath) throw new Error(`No OBJ for ${entry.modelKey}`)
  const [objBuf, texBuf] = await Promise.all([getFileBuffer(catalog!.files.get(objPath)!), getFileBuffer(hashOf(entry.path))])
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
  return finish(fitObject(obj), material, frames, 1 - 1 / frames, -1, files)
}

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
    return [...counts].map(([id, count]) => ({
      id,
      count,
      label: LABELS[id]?.[0] ?? id,
      icon: LABELS[id]?.[1] ?? 'pi-box',
    }))
  },

  filters(category): FilterDef[] {
    const themes = new Set<string>()
    const colors = new Set<string>()
    for (const e of catalog!.entries) {
      if (e.item.category !== category) continue
      for (const t of e.item.fields.themes as string[]) themes.add(t)
      for (const c of e.item.fields.colors as string[]) colors.add(c)
    }
    return [
      { key: 'themes', label: 'Theme', type: 'multi', options: [...themes].sort() },
      { key: 'colors', label: 'Color', type: 'multi', options: [...colors].sort() },
      { key: 'animated', label: 'Animated', type: 'toggle' },
    ]
  },

  items: (category) => catalog!.entries.filter((e) => e.item.category === category).map((e) => e.item),

  async imageUrl(item) {
    const e = byId.get(item.id)!
    return fileUrl(hashOf(e.path))
  },

  loadModel(item) {
    const e = byId.get(item.id)!
    return e.path.endsWith('.gek.json') ? loadGek(e) : loadObj(e)
  },
}

export function zipFiles(files: DownloadFile[]): Uint8Array<ArrayBuffer> {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))) as Uint8Array<ArrayBuffer>
}
