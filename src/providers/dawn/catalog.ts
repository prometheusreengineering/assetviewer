import { getFreshBuffer } from '../../cdn'
import type { CosmeticItem } from '../types'

/** Same-origin proxy of https://assets.dawn.gg/assets/ (functions/dawn in production, the Vite proxy in dev). */
export const DAWN_BASE = '/dawn/'
export const INDEX_PATH = 'assets_index.json'
const COSMETICS = 'game/cosmetics/'

/** Files are requested with their sha1 so the browser and edge caches can keep them forever. */
export const dawnUrl = (path: string, hash: string) => `${DAWN_BASE}${path}?h=${hash}`

export interface DawnIndexEntry {
  name: string
  hash: string
}

export type DawnKind = 'geo' | 'variant' | 'cloak' | 'shield' | 'trim' | 'image' | 'file'

export interface DawnPart {
  geo: string
  texture: string
}

export interface DawnEntry {
  item: CosmeticItem
  kind: DawnKind
  /** The item's own main file: its texture (or the file itself). */
  path: string
  /** Model parts (one, or four for an armor trim); a variant or flat shield borrows a geo. */
  parts: DawnPart[]
  anim?: string
  meta?: string
  /** Every file of the index that belongs to this item (for downloads). */
  files: string[]
  /** The item whose model a texture-only variant borrows. */
  variantOf?: string
}

export interface DawnCatalog {
  /** path -> sha1 */
  files: Map<string, string>
  entries: DawnEntry[]
  /** sha1 of the index file itself (footer). */
  indexHash: string
}

/** Sidebar order and labels of the cosmetic folders. */
export const DAWN_CATEGORIES: Record<string, [string, string]> = {
  hats: ['Hats', 'pi-crown'],
  face: ['Face', 'pi-face-smile'],
  back: ['Back', 'pi-briefcase'],
  wings: ['Wings', 'pi-send'],
  auras: ['Auras', 'pi-sun'],
  pets: ['Pets', 'pi-heart'],
  cloaks: ['Cloaks', 'pi-bookmark'],
  shields: ['Shields', 'pi-shield'],
  arm: ['Arms', 'pi-hammer'],
  boots: ['Boots', 'pi-arrow-down'],
  trim: ['Armor trims', 'pi-star'],
}
export const DAWN_RESOURCES: Record<string, [string, string]> = {
  models: ['Shared models', 'pi-box'],
  lang: ['Language files', 'pi-language'],
  other: ['Other files', 'pi-file'],
}

/** The flat shield model that texture-only shields are drawn on (its texture is 286x320). */
export const FLAT_SHIELD = 'game/cosmetics/shields/rectangleShield320.geo.json'
export const TRIM_SLOTS = ['head', 'chest', 'legs', 'feet'] as const

/** camelCase words: `4thJulyHat` -> 4th July Hat, `MCPVPBetaCloak` -> MCPVP Beta Cloak, `spring2025Bee` -> spring 2025 Bee. */
export const words = (s: string) => s.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Z])|[_\s-]+/).filter(Boolean)
export const humanize = (s: string) =>
  words(s)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')

const COLORS = new Set(['black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gold', 'silver', 'gray', 'grey', 'cyan', 'brown', 'rainbow', 'dark', 'light'])
const lower = (a: string[]) => a.map((w) => w.toLowerCase())

/**
 * How well a texture-only name matches a model's name in the same folder (0 = not a variant). Variants
 * share the collection and the type word (springFireWyvernWings ~ springAbyssalWyvernWings) or only add a
 * colour (summer2024MechaWingsBlue ~ summer2024MechaWingsOrange, sharpnessEnchantAuraRed ~ sharpnessEnchantAura).
 */
export function variantScore(texName: string, geoName: string): number {
  const t = lower(words(texName))
  const g = lower(words(geoName))
  let pre = 0
  while (pre < t.length && pre < g.length && t[pre] === g[pre]) pre++
  let suf = 0
  while (suf < t.length - pre && suf < g.length - pre && t[t.length - 1 - suf] === g[g.length - 1 - suf]) suf++
  if (suf >= 1) {
    if (pre + suf < 2) return 0
    // Black/White sneakers: the differing words are both colours.
    const dt = t.slice(pre, t.length - suf)
    const dg = g.slice(pre, g.length - suf)
    const colours = dt.length === 1 && dg.length === 1 && COLORS.has(dt[0]!) && COLORS.has(dg[0]!)
    return pre + suf + (colours ? 0.5 : 0)
  }
  if (pre === g.length && t.length === g.length + 1) return pre // model name + a colour word
  if (t.length === g.length && pre === t.length - 1 && pre >= 3) return pre // only the last word (a colour) differs
  return 0
}

/** Folder and file base name of a cosmetics path (`hats/angelHalo.geo.json` -> hats, angelHalo, geo.json). */
function split(path: string) {
  const rest = path.slice(COSMETICS.length)
  const slash = rest.indexOf('/')
  const folder = rest.slice(0, slash)
  const file = rest.slice(slash + 1)
  const dot = file.indexOf('.')
  return { folder, base: dot < 0 ? file : file.slice(0, dot), ext: dot < 0 ? '' : file.slice(dot + 1) }
}

/** Builds the catalog from the index; every file is claimed by exactly one entry. */
export function buildDawnCatalog(index: DawnIndexEntry[], indexHash = ''): DawnCatalog {
  const files = new Map(index.map((e) => [e.name, e.hash]))
  const entries: DawnEntry[] = []
  const claimed = new Set<string>()
  const item = (id: string, name: string, category: string, render: CosmeticItem['render']): CosmeticItem => ({ id, name, category, render, fields: {} })
  const push = (e: DawnEntry) => {
    for (const f of e.files) claimed.add(f)
    entries.push(e)
  }

  // folder/base -> ext -> path
  const groups = new Map<string, Map<string, string>>()
  for (const { name } of index) {
    if (!name.startsWith(COSMETICS) || name.slice(COSMETICS.length).split('/').length !== 2) continue
    const { folder, base, ext } = split(name)
    const key = `${folder}/${base}`
    if (!groups.has(key)) groups.set(key, new Map())
    groups.get(key)!.set(ext, name)
  }
  const texOf = (g: Map<string, string>) => g.get('webp') ?? g.get('avif') ?? g.get('png')
  const byBase = new Map<string, string[]>()
  for (const key of groups.keys()) {
    const base = key.split('/')[1]!
    byBase.set(base, [...(byBase.get(base) ?? []), key])
  }

  // 1. Models with their own geometry and texture.
  const models = new Map<string, DawnEntry>()
  for (const [key, g] of groups) {
    const [folder, base] = key.split('/') as [string, string]
    const geo = g.get('geo.json')
    const tex = texOf(g)
    if (!geo || !tex || folder === 'trim') continue
    const e: DawnEntry = {
      item: item(key, humanize(base), folder, '3d'),
      kind: 'geo',
      path: tex,
      parts: [{ geo, texture: tex }],
      anim: g.get('animation.json'),
      meta: g.get('meta.json') ?? g.get('json'),
      files: [...g.values()],
    }
    models.set(key, e)
    push(e)
  }

  // 2. Files in the wrong folder that share a model's name (pets/halloween2024BatAura.webp next to auras/...).
  const strayOwner = (key: string) => {
    const base = key.split('/')[1]!
    const owners = (byBase.get(base) ?? []).filter((k) => k !== key && models.has(k))
    return owners.length === 1 ? models.get(owners[0]!) : undefined
  }

  const trims = new Map<string, { slot: string; texture: string }[]>()
  for (const [key, g] of groups) {
    if (models.has(key)) continue
    const [folder, base] = key.split('/') as [string, string]
    const tex = texOf(g)
    const rest = [...g.values()].filter((p) => p !== tex)
    if (folder === 'trim') {
      const m = /^(.+)_(head|chest|legs|feet)$/.exec(base)
      if (m && tex) {
        trims.set(m[1]!, [...(trims.get(m[1]!) ?? []), { slot: m[2]!, texture: tex }])
        continue
      }
    }
    if (!tex) continue // geometry/animation/meta only: shared models or strays (below)
    if (folder === 'cloaks') {
      push({ item: item(key, humanize(base), folder, '3d'), kind: 'cloak', path: tex, parts: [], files: [tex, ...rest] })
      continue
    }
    if (folder === 'shields' && files.has(FLAT_SHIELD)) {
      push({ item: item(key, humanize(base), folder, '3d'), kind: 'shield', path: tex, parts: [{ geo: FLAT_SHIELD, texture: tex }], files: [tex, ...rest] })
      continue
    }
    const stray = strayOwner(key)
    if (stray && !g.has('geo.json')) {
      stray.files.push(...g.values())
      for (const p of g.values()) claimed.add(p)
      continue
    }
    // A colour variant of a model in the same folder borrows its geometry and animation.
    let best: DawnEntry | undefined
    let bestScore = 0
    for (const [mk, m] of models) {
      if (!mk.startsWith(folder + '/')) continue
      const s = variantScore(base, mk.split('/')[1]!)
      if (s > bestScore || (s === bestScore && s > 0 && mk < best!.item.id)) {
        best = m
        bestScore = s
      }
    }
    if (best) {
      push({
        item: item(key, humanize(base), folder, '3d'),
        kind: 'variant',
        path: tex,
        parts: [{ geo: best.parts[0]!.geo, texture: tex }],
        anim: best.anim,
        meta: best.meta,
        files: [tex, ...rest],
        variantOf: best.item.id,
      })
      continue
    }
    push({ item: item(key, humanize(base), folder, 'image'), kind: 'image', path: tex, parts: [], files: [tex, ...rest] })
  }

  // 3. Armor trims: one item per trim, its slot textures on the shared trim/<slot>.geo.json models.
  for (const [name, slots] of [...trims].sort(([a], [b]) => a.localeCompare(b))) {
    slots.sort((a, b) => TRIM_SLOTS.indexOf(a.slot as never) - TRIM_SLOTS.indexOf(b.slot as never))
    const parts = slots.filter((s) => files.has(`${COSMETICS}trim/${s.slot}.geo.json`)).map((s) => ({ geo: `${COSMETICS}trim/${s.slot}.geo.json`, texture: s.texture }))
    push({
      item: item(`trim/${name}`, humanize(name), 'trim', parts.length ? '3d' : 'image'),
      kind: parts.length ? 'trim' : 'image',
      path: slots[0]!.texture,
      parts,
      files: slots.map((s) => s.texture),
    })
  }

  // 4. Leftovers: strays without a texture, shared models (flat shield, trim pieces), language files, anything else.
  for (const { name } of index) {
    if (claimed.has(name)) continue
    if (name.startsWith(COSMETICS)) {
      const { folder, base } = split(name)
      const stray = strayOwner(`${folder}/${base}`)
      if (stray && !name.endsWith('.geo.json')) {
        stray.files.push(name)
        claimed.add(name)
        continue
      }
    }
    const file = name.split('/').pop()!
    const category = name.endsWith('.geo.json') ? 'models' : name.startsWith('game/lang/') ? 'lang' : 'other'
    push({ item: item(name, file, category, 'file'), kind: 'file', path: name, parts: [], files: [name] })
  }

  setCollections(entries)
  // Grids list items by name (the index is grouped by file kind, so variants came after every model).
  entries.sort((x, y) => x.item.name.localeCompare(y.item.name, 'en', { numeric: true }))
  return { files, entries, indexHash }
}

/**
 * A cosmetic's collection: the shortest leading run of words shared with at least two other cosmetics,
 * extended over a year and over words that every one of them shares (`arcaneLibrarianWings` -> Arcane
 * Librarian, `spring2025BeeHalo` -> Spring 2025, `demon2024DemonCrown` -> Demon 2024).
 */
function setCollections(entries: DawnEntry[]) {
  const cos = entries.filter((e) => e.kind !== 'file')
  const ws = new Map(cos.map((e) => [e, words(e.item.id.split('/').pop()!)]))
  const key = (w: string[], n: number) => lower(w.slice(0, n)).join(' ')
  const count = new Map<string, number>()
  for (const w of ws.values()) for (let n = 1; n < w.length; n++) count.set(key(w, n), (count.get(key(w, n)) ?? 0) + 1)
  const at = (w: string[], n: number) => count.get(key(w, n)) ?? 0
  for (const [e, w] of ws) {
    let n = 1
    while (n < w.length && at(w, n) < 3) n++
    if (n >= w.length) continue
    while (n + 1 < w.length && (/^(19|20)\d\d$/.test(w[n]!) || at(w, n + 1) === at(w, n))) n++
    e.item.fields.collection = humanize(w.slice(0, n).join(''))
  }
}

async function sha1(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-1', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function loadDawnCatalog(): Promise<DawnCatalog> {
  const buf = await getFreshBuffer(DAWN_BASE + INDEX_PATH)
  const index = JSON.parse(new TextDecoder().decode(buf)) as DawnIndexEntry[]
  return buildDawnCatalog(index.filter((e) => e && typeof e.name === 'string' && typeof e.hash === 'string'), await sha1(buf))
}
