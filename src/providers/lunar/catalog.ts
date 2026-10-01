import { getFileJson, getFileText, getIndexBuffer } from '../../cdn'
import { LUNAR_INDEXES } from '../../config'
import type { CosmeticItem } from '../types'

export const PREFIX = 'assets/lunar/'

/** Cape textures sit directly in cosmetics/cloaks (subfolders hold extras). */
const isCloakTex = (p: string) => /^cosmetics\/cloaks\/[^/]+\.webp$/.test(p)

export type Kind = 'gek' | 'obj' | 'wing2d' | 'cloak' | 'image' | 'file'

export interface LunarEntry {
  item: CosmeticItem
  /** Path (relative to PREFIX) of the .gek.json, the texture, or the file itself. */
  path: string
  /** Shared OBJ model key (legacy hats/bandannas/masks), or '' if none. */
  modelKey: string
  kind: Kind
  /** Extra info rows for the modal. */
  info: Record<string, string>
}

export interface LunarCatalog {
  /** full path -> sha1 */
  files: Map<string, string>
  /** full path -> bytes */
  sizes: Map<string, number>
  entries: LunarEntry[]
  /** folder name -> full path of the .obj inside it */
  objs: Map<string, string>
}

interface JsonCosmetic {
  id: number
  name: string
  resource: string
  category: string
  indexType: string
  geckolibCosmetic: boolean
  special: boolean
  animated: boolean
  colors: string[]
  tags: string[]
  releasedAt?: string
}

async function loadFileMap() {
  const files = new Map<string, string>()
  const sizes = new Map<string, number>()
  const decoder = new TextDecoder()
  for (const id of LUNAR_INDEXES) {
    for (const line of decoder.decode(await getIndexBuffer(id)).split('\n')) {
      const [path, hash, size] = line.split(' ')
      if (path && hash) {
        files.set(path, hash)
        sizes.set(path, Number(size) || 0)
      }
    }
  }
  return { files, sizes }
}

const strip = (r: string) => r.replace(/^lunar:/, '')
const IMAGE = /\.(webp|png|gif|jpe?g)$/i

export const humanize = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.(gek\.json|[a-z0-9]+)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())

const GEK_CATEGORY: Record<string, string> = {
  hats: 'hat',
  suits: 'suits',
  pets: 'pet',
  wings: 'dragon_wings',
  shoes: 'shoes',
  shields: 'shields',
  auras: 'auras',
  backpacks: 'backpack',
  companions: 'companion',
  wristwear: 'wristwear',
  items: 'items',
}

/** Category for files outside the cosmetic catalog (badges, sprays, emotes, ...). */
function resourceCategory(rel: string): string {
  if (rel.startsWith('badges/')) return 'badges'
  if (rel.startsWith('sprays/')) return 'sprays'
  if (rel.startsWith('emotes/icons/')) return 'emote_icons'
  if (rel.startsWith('emotes/textures/')) return 'emote_textures'
  if (rel.startsWith('emotes/')) return 'emote_data'
  if (rel.startsWith('particles/textures/')) return 'particle_textures'
  if (rel.startsWith('particles/')) return 'particle_data'
  if (rel.startsWith('icons/')) return 'icons'
  if (rel.startsWith('misc/')) return 'misc'
  return 'data'
}

export const RESOURCE_CATEGORIES = [
  'badges',
  'sprays',
  'emote_icons',
  'emote_textures',
  'emote_data',
  'particle_textures',
  'particle_data',
  'icons',
  'misc',
  'data',
]

export async function loadLunarCatalog(): Promise<LunarCatalog> {
  const { files, sizes } = await loadFileMap()
  const has = (rel: string) => files.has(PREFIX + rel)

  const objs = new Map<string, string>()
  for (const path of files.keys()) {
    if (path.endsWith('.obj') && path.includes('/cosmetics/models/')) {
      objs.set(path.split('/').slice(-2, -1)[0]!, path)
    }
  }

  const entries: LunarEntry[] = []
  const claimed = new Set<string>()
  const claim = (rel: string) => claimed.add(PREFIX + rel)

  const add = (e: Omit<LunarEntry, 'info'> & { info?: Record<string, string> }) => {
    claim(e.path)
    claim(e.path.replace('cosmetics/wings/', 'cosmetics/wings/thumbnail/')) // preview of a listed wing
    entries.push({ info: {}, ...e })
  }

  // 1. The JSON catalog is the full list (the legacy CSV is a subset).
  const cosmetics = await getFileJson<JsonCosmetic[]>(files.get(PREFIX + 'cosmetics.json')!)
  const seen = new Set<number>()
  for (const c of cosmetics) {
    seen.add(c.id)
    const path = strip(c.resource)
    const modelKey = c.indexType && c.indexType !== 'NONE' ? c.indexType : ''
    const isGek = path.endsWith('.gek.json')
    const kind: Kind = isGek ? 'gek' : c.category === 'dragon_wings' ? 'wing2d' : isCloakTex(path) ? 'cloak' : modelKey && objs.has(modelKey) ? 'obj' : 'image'
    add({
      path,
      modelKey,
      kind,
      item: {
        id: String(c.id),
        name: c.name || String(c.id),
        category: c.category,
        render: kind === 'image' ? 'image' : '3d',
        fields: {
          themes: c.tags ?? [],
          colors: c.colors ?? [],
          animated: !!c.animated || has(path + '.mcmeta'),
        },
      },
      info: {
        ID: String(c.id),
        ...(c.releasedAt ? { Released: c.releasedAt.slice(0, 10) } : {}),
        Source: path,
      },
    })
  }

  // 2. CSV rows that the JSON catalog lacks.
  const csvHash = files.get(PREFIX + 'cosmetics/index')
  if (csvHash) {
    for (const line of (await getFileText(csvHash)).split('\n')) {
      const c = line.trim().split(',')
      if (c.length < 12 || seen.has(Number(c[0]))) continue
      const path = c[8]!
      if (!has(path)) continue
      const modelKey = c[7] === 'NONE' ? '' : c[7]!
      const kind: Kind = path.endsWith('.gek.json') ? 'gek' : isCloakTex(path) ? 'cloak' : modelKey && objs.has(modelKey) ? 'obj' : 'image'
      add({
        path,
        modelKey,
        kind,
        item: {
          id: c[0]!,
          name: c[3] || c[0]!,
          category: c[6]!,
          render: kind === 'image' ? 'image' : '3d',
          fields: { themes: c[10] ? c[10].split('|') : [], colors: c[11] ? c[11].split('|') : [], animated: has(path + '.mcmeta') },
        },
        info: { ID: c[0]!, Source: path },
      })
    }
  }

  // 3. Cosmetic files present on the CDN that no catalog lists.
  for (const full of files.keys()) {
    if (claimed.has(full) || !full.startsWith(PREFIX + 'cosmetics/')) continue
    const rel = full.slice(PREFIX.length)
    const m = rel.match(/^cosmetics\/models\/gek\/([^/]+)\/.*\.gek\.json$/)
    let category: string | undefined
    let kind: Kind | undefined
    let modelKey = ''
    const o = rel.match(/^cosmetics\/models\/(hats|bodywear)\/([^/]+)\/(?:textures\/)?[^/]+\.webp$/)
    if (m) {
      category = GEK_CATEGORY[m[1]!] ?? m[1]!
      kind = 'gek'
    } else if (o) {
      // Texture that no catalog lists; drawn on its shared OBJ model if there is one.
      category = o[1] === 'bodywear' ? 'bodywear' : o[2] === 'mask' ? 'mask' : /bandanna/.test(o[2]!) ? 'bandanna' : 'hat'
      kind = objs.has(o[2]!) ? 'obj' : 'image'
      modelKey = kind === 'obj' ? o[2]! : ''
    } else if (/^cosmetics\/wings\/thumbnail\/[^/]+\.webp$/.test(rel)) {
      category = 'dragon_wings'
      kind = 'image'
    } else if (/^cosmetics\/cloaks\/[^/]+\.webp$/.test(rel)) {
      category = 'cloak'
      kind = 'cloak'
    } else if (/^cosmetics\/wings\/[^/]+\.webp$/.test(rel)) {
      category = 'dragon_wings'
      kind = 'wing2d'
    }
    if (!category || !kind) continue
    add({
      path: rel,
      modelKey,
      kind,
      item: {
        id: 'unlisted:' + rel,
        name: humanize(rel),
        category,
        render: kind === 'image' ? 'image' : '3d',
        fields: { themes: ['UNLISTED'], colors: [], animated: has(rel + '.mcmeta') },
      },
      info: { Source: rel, Note: 'Present on the CDN but not in any catalog' },
    })
  }

  // 4. Everything outside cosmetics (badges, sprays, emotes, particles, icons, shaders, data).
  const meta = new Map<string, { name: string; info: Record<string, string>; animated?: boolean }>()
  for (const f of ['badges.json', 'sprays.json']) {
    const h = files.get(PREFIX + f)
    if (!h) continue
    for (const x of await getFileJson<{ id: number; name: string; description?: string; resource: string; releasedAt?: string; animated?: boolean }[]>(h)) {
      const info: Record<string, string> = { ID: String(x.id) }
      if (x.description) info.Description = x.description
      if (x.releasedAt) info.Released = x.releasedAt.slice(0, 10)
      meta.set(PREFIX + strip(x.resource), { name: x.name, info, animated: x.animated })
    }
  }
  for (const full of files.keys()) {
    if (claimed.has(full)) continue
    // Model dependencies (geo, anim, textures) are reachable through their item and All files; the
    // rest of the cosmetics tree (shaders, cloak extras, stray models) is listed here.
    const r0 = full.slice(PREFIX.length)
    const isExtra = /^cosmetics\/cloaks\/[^/]+\//.test(r0) || /\.(obj|fsh)$/.test(r0)
    if (/^cosmetics\/(models|cloaks|wings)\//.test(r0) && !isExtra) continue
    if (full.endsWith('.mcmeta')) continue
    const rel = full.slice(PREFIX.length)
    const isImage = IMAGE.test(rel)
    const m = meta.get(full)
    add({
      path: rel,
      modelKey: '',
      kind: isImage ? 'image' : 'file',
      item: {
        id: 'res:' + rel,
        name: m?.name ?? humanize(rel),
        category: resourceCategory(rel),
        render: isImage ? 'image' : 'file',
        fields: { themes: [], colors: [], animated: m?.animated ?? has(rel + '.mcmeta'), ext: rel.split('.').pop() ?? '' },
      },
      info: { ...(m?.info ?? {}), Path: rel },
    })
  }

  return { files, sizes, entries, objs }
}
