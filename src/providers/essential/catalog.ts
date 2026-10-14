import type { CosmeticItem } from '../types'
import type { AssetRef } from './localData'

/** A cosmetic as dumped by the Prometheus patch (Essential's `Cosmetic`, field names minified). */
export interface EssentialDump {
  /** id */
  a: string
  /** category (folder name) */
  b: string
  /** display names by locale */
  c?: Record<string, string>
  /** tags: THEME_*, COLLECTION_*, flags */
  h?: string[]
  /** slots */
  m?: Record<string, number>
  /** price in coins */
  o?: number
  /** rarity */
  p?: string
  /** files: path -> { a: url, b: sha256 } */
  q?: Record<string, { a?: string; b?: string }>
}

export interface EssentialEntry {
  item: CosmeticItem
  files: Map<string, AssetRef>
  geometry?: string
  /** Colour variants (`variants/<name>/texture.png`), or the plain `texture.png` as `default`; `emissive` is the glow layer drawn full-bright over it. */
  textures: { name: string; path: string; emissive?: string }[]
  /** Skin masks (64x64, black = hide that skin pixel under the cosmetic) for wide and slim skins. */
  skinMask?: { steve?: string; alex?: string }
  /** Slim-arm (Alex) geometry, when the cosmetic has one. */
  geometryAlex?: string
  animations?: string
  settings?: string
}

export interface EssentialCatalog {
  entries: EssentialEntry[]
  files: number
}

/** Category (dump folder) -> sidebar label and icon, in sidebar order. */
export const ESSENTIAL_CATEGORIES: Record<string, [string, string]> = {
  HAT: ['Hats', 'pi-crown'],
  HEAD: ['Head', 'pi-user'],
  FACE: ['Face', 'pi-face-smile'],
  EARS: ['Ears', 'pi-star'],
  TOP: ['Tops', 'pi-tag'],
  PANTS: ['Pants', 'pi-minus'],
  SHOES: ['Shoes', 'pi-arrow-down'],
  ARMS: ['Arms', 'pi-hammer'],
  BACK: ['Back', 'pi-briefcase'],
  WINGS: ['Wings', 'pi-send'],
  CAPE: ['Capes', 'pi-bookmark'],
  FULL_BODY: ['Full body', 'pi-users'],
  ACCESSORY: ['Accessories', 'pi-link'],
  SHOULDERS: ['Shoulders', 'pi-arrows-h'],
  SKIRT: ['Skirts', 'pi-filter'],
  PET: ['Pets', 'pi-heart'],
  EFFECT: ['Effects', 'pi-sparkles'],
  EMOTE: ['Emotes', 'pi-video'],
  ICON: ['Icons', 'pi-image'],
}
/** Shown as a name tile: emotes play on the player in the modal. Icons are flat images. */
const TILE = new Set(['EMOTE'])

export const categoryId = (b: string) => b.toLowerCase()

/** `THEME_BUG` -> Bug, `DECEMBER2025` -> December 2025, `BLING_CHAIN` -> Bling Chain. */
export function humanize(s: string) {
  return s
    .replace(/^(THEME|COLLECTION)_/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.replace(/(\D)(\d)/g, '$1 $2'))
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function buildEssentialCatalog(dumps: unknown[]): EssentialCatalog {
  const entries: EssentialEntry[] = []
  const seen = new Set<string>()
  let fileCount = 0
  for (const raw of dumps) {
    const d = raw as EssentialDump
    if (!d || typeof d.a !== 'string' || typeof d.b !== 'string' || seen.has(d.a)) continue
    seen.add(d.a)
    const files = new Map<string, AssetRef>()
    for (const [path, f] of Object.entries(d.q ?? {})) if (f && typeof f.b === 'string' && /^[0-9a-f]{64}$/.test(f.b)) files.set(path, { url: typeof f.a === 'string' ? f.a : '', sha256: f.b })
    fileCount += files.size
    const variants = [...files.keys()]
      .map((p) => /^variants\/([^/]+)\/texture\.png$/.exec(p))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1]!, path: m[0], emissive: files.has(`variants/${m[1]}/emissive.png`) ? `variants/${m[1]}/emissive.png` : files.has('emissive.png') ? 'emissive.png' : undefined }))
      .sort((x, y) => x.name.localeCompare(y.name))
    const plain = { name: 'default', path: 'texture.png', emissive: files.has('emissive.png') ? 'emissive.png' : undefined }
    const textures = files.has('texture.png') ? [plain, ...variants] : variants
    for (const t of textures) if (!t.emissive) delete t.emissive
    const geometry = files.has('geometry.steve.json') ? 'geometry.steve.json' : undefined
    const tags = d.h ?? []
    const icon = d.b === 'ICON' && files.has('texture.png')
    const tile = !icon && (TILE.has(d.b) || !geometry || !textures.length)
    const item: CosmeticItem = {
      id: d.a,
      name: d.c?.en_us || d.c?.en_US || humanize(d.a),
      category: categoryId(d.b),
      render: icon ? 'image' : '3d',
      thumb: tile ? 'none' : undefined,
      fields: {
        category: ESSENTIAL_CATEGORIES[d.b]?.[0] ?? humanize(d.b),
        type: '3D',
        rarity: d.p ? humanize(d.p) : '',
        themes: tags.filter((t) => t.startsWith('THEME_')).map(humanize),
        collections: tags.filter((t) => t.startsWith('COLLECTION_')).map(humanize),
        flags: tags.filter((t) => !/^(THEME|COLLECTION)_/.test(t)).map(humanize),
        slots: Object.keys(d.m ?? {}).map(humanize),
        variants: variants.map((v) => v.name),
        hasAnimation: files.has('animations.json'),
        files: files.size,
      },
    }
    if (typeof d.o === 'number') item.fields.price = d.o
    const mask = (m: 'steve' | 'alex') => (files.has(`skin_mask.${m}.png`) ? `skin_mask.${m}.png` : undefined)
    const skinMask = mask('steve') || mask('alex') ? { steve: mask('steve'), alex: mask('alex') } : undefined
    if (files.has('emissive.png') || variants.some((v) => v.emissive)) item.fields.glow = true
    entries.push({ item, files, geometry, geometryAlex: files.has('geometry.alex.json') ? 'geometry.alex.json' : undefined, skinMask, textures, animations: files.has('animations.json') ? 'animations.json' : undefined, settings: files.has('settings.json') ? 'settings.json' : undefined })
  }
  entries.sort((x, y) => x.item.name.localeCompare(y.item.name, 'en', { numeric: true }))
  return { entries, files: fileCount }
}

interface Setting {
  type?: string
  data?: { variants?: { name?: string; color?: number }[] }
}

/** Variant order from settings.json (the first is the default); unknown names keep their place after them. */
export function orderVariants(textures: EssentialEntry['textures'], settings: unknown): EssentialEntry['textures'] {
  const list = Array.isArray(settings) ? (settings as Setting[]) : []
  const order = list.find((s) => s?.type === 'VARIANTS')?.data?.variants?.map((v) => v.name) ?? []
  const rank = (n: string) => (order.indexOf(n) < 0 ? order.length + (n === 'default' ? -0.5 : 0) : order.indexOf(n))
  return [...textures].sort((a, b) => rank(a.name) - rank(b.name))
}
