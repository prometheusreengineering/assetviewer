import { zipSync } from 'fflate'
import { Box3, Group, Quaternion, Vector3, type MeshLambertMaterial, type Object3D } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { fileUrl, getFileBuffer, getFileJson, getFileText } from '../../cdn'
import { AnimationPlayer, type AnimFile } from '../../three/animation/bedrockAnim'
import { parseFunctions, type FnLib } from '../../three/animation/molang'
import { disposeObject, fitObject } from '../../three/fit'
import { buildGeoRig, createMaterial, createTexture, type Bone, type GeoFile } from '../../three/geoModel'
import type { CategoryDef, CosmeticItem, CosmeticProvider, DownloadFile, FieldDef, IndexedFile, LoadedModel } from '../types'
import { LUNAR_INDEXES } from '../../config'
import { fetchImageSize } from '../../dimensions'
import { formatBytes } from '../../format'
import { dressPlayer } from './dress'
import { emoteSources, loadEmote } from './emotes'
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
  emotes: ['Emotes', 'pi-video'],
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
/** Pseudo category holding every item of every category. */
export const EVERYTHING = 'everything'
// Fully covered by the Emotes category (icons, props, body, actions); still listed under All files.
const HIDDEN_CATEGORIES = new Set(['emote_icons', 'emote_textures', 'emote_data'])
export const OUTFIT = 'outfit'

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

const DEG = Math.PI / 180
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
  raw = false,
  prep?: (root: Object3D) => void,
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
  prep?.(root)
  const player = animFile ? new AnimationPlayer(bones, animFile, await getLib(), preferred) : undefined
  // Fit the first frame of the default animation (parts it hides don't count), not the static model.
  player?.tick(0)
  // raw: keep player-space coordinates (blocks) for dressing a player.
  const object = raw ? root : fitObject(root)
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

async function loadGek(entry: LunarEntry, playerSpace = false): Promise<LoadedModel> {
  const gekHash = hashOf(entry.path)
  const raw = await getFileJson<{
    model?: string | Record<string, string>
    texture?: string
    animation?: string
    attached_bone?: string
    hide_head?: boolean
    hide_body?: boolean
    hide_right_arm?: boolean
    hide_left_arm?: boolean
    hide_right_leg?: boolean
    hide_left_leg?: boolean
    transformations?: { transformType: string; values: { angle?: number; x?: number; y?: number; z?: number } }[]
    state_machine?: { controllers?: { states?: { anim: string; plays_when?: string }[] }[] }
  }>(gekHash)
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
  // Default pose: idle, else whatever the state machine plays unconditionally (plays_when "1"), e.g. auras' "main".
  const states = (raw.state_machine?.controllers ?? []).flatMap((c) => c.states ?? [])
  const preferred = ['idle', ...states.filter((x) => String(x.plays_when).trim() === '1').map((x) => x.anim), 'main']
  return finish(
    await buildRig(geo, texBuf, stripNs(gek.texture), anim, preferred, files, playerSpace, (root) => {
      // Bedrock geometry is x-mirrored and faces -z (Blockbench negates x on import). Unmirror it for the plain
      // view (front still towards the camera at -z); on a player (faces +z) that plus a half turn is a z flip.
      if (playerSpace) root.scale.z *= -1
      else root.scale.x *= -1
      // Unconditional "rotate" transformations (a few backpacks are modelled backwards).
      for (const t of raw.transformations ?? []) {
        const v = t.values
        if (t.transformType === 'rotate' && v.angle) root.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0).normalize(), v.angle * DEG))
      }
      root.userData.attachedBone = raw.attached_bone
      // Player parts this cosmetic replaces (a robotic arm hides the arm under it).
      root.userData.hideParts = (['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg'] as const).filter((p) => raw[`hide_${p}`] === true)
    }),
  )
}

// Legacy "dragon wings" textures are ender dragon sheets (256 grid, x4): the vanilla dragon wing is a 56-long
// bone at uv 112,88 with a 56x56 membrane at -56,88, then a wing tip (bone 112,136, membrane -56,144).
// Built at WING_S scale on the upper back, Bedrock convention (back = +z, the player's right = -x).
const WING_S = 0.2
function dragonWingGeo(): GeoFile {
  const L = 56 * WING_S
  type Uv = Record<string, { uv: [number, number]; uv_size: [number, number] }>
  const box = (u: number, v: number, w: number, d: number): Uv => ({
    north: { uv: [u + d, v + d], uv_size: [w, d] },
    south: { uv: [u + d + w + d, v + d], uv_size: [w, d] },
    up: { uv: [u + d, v], uv_size: [w, d] },
    down: { uv: [u + d + w, v], uv_size: [w, d] },
    east: { uv: [u, v + d], uv_size: [d, d] },
    west: { uv: [u + d + w, v + d], uv_size: [d, d] },
  })
  // Java box UV for the membrane: the outer end is u=0 and the bone edge is the bottom of the 56x56 quad
  // (v+56); the trailing edge (top) carries the scallops. Our up face runs v with +z (away from the bone),
  // so it's flipped; the left wing is mirrored (Java draws it with scale -1,1,1).
  const skin = (v: number, side: 1 | -1): Uv =>
    side < 0
      ? { up: { uv: [0, v + 56], uv_size: [56, -56] }, down: { uv: [56, v], uv_size: [56, 56] } }
      : { up: { uv: [56, v + 56], uv_size: [-56, -56] }, down: { uv: [112, v], uv_size: [-56, 56] } }
  // side -1 = right wing (extends to -x), +1 = left (mirrored)
  const wing = (side: 1 | -1, name: string) => {
    const x0 = side * 1.5
    const at = (x: number, len: number) => (side < 0 ? x - len : x)
    return [
      {
        name: `${name}_wing`,
        parent: 'wings',
        pivot: [x0, 23, 2.5],
        rotation: [-75, side * -25, side * -30],
        cubes: [
          { origin: [at(x0, L), 22.2, 1.7], size: [L, 1.6, 1.6], uv: box(112, 88, 56, 8) },
          { origin: [at(x0, L), 23, 2.5], size: [L, 0, L], inflate: 0.02, uv: skin(88, side) },
        ],
      },
      {
        name: `${name}_tip`,
        parent: `${name}_wing`,
        pivot: [x0 + side * L, 23, 2.5],
        cubes: [
          { origin: [at(x0 + side * L, L), 22.6, 2.1], size: [L, 0.8, 0.8], uv: box(112, 136, 56, 4) },
          { origin: [at(x0 + side * L, L), 23, 2.5], size: [L, 0, L], inflate: 0.02, uv: skin(144, side) },
        ],
      },
    ]
  }
  return {
    'minecraft:geometry': [
      {
        description: { texture_width: 256, texture_height: 256 },
        bones: [{ name: 'wings', pivot: [0, 23, 2.5] }, ...wing(-1, 'right'), ...wing(1, 'left')],
      },
    ],
  } as unknown as GeoFile
}
// A slow flap: the wings swing back and forth while the tips fold.
const DRAGON_WING_ANIM: AnimFile = {
  animations: {
    main: {
      loop: true,
      bones: {
        right_wing: { rotation: ['math.cos(q.life_time * 150) * 8', 'math.sin(q.life_time * 150) * 12', 'math.sin(q.life_time * 150) * 8'] },
        left_wing: { rotation: ['math.cos(q.life_time * 150) * 8', '-math.sin(q.life_time * 150) * 12', '-math.sin(q.life_time * 150) * 8'] },
        right_tip: { rotation: [0, 0, '-15 + math.sin(q.life_time * 150 + 115) * 12'] },
        left_tip: { rotation: [0, 0, '15 - math.sin(q.life_time * 150 + 115) * 12'] },
      },
    },
  },
}

/** Legacy dragon wings: an ender dragon texture sheet on a pair of dragon wings. */
async function loadWing2d(entry: LunarEntry, raw = false): Promise<LoadedModel> {
  const texBuf = await getFileBuffer(hashOf(entry.path))
  const files: DownloadFile[] = [{ name: baseName(entry.path), data: new Uint8Array(texBuf) }]
  return finish(
    await buildRig(dragonWingGeo(), texBuf, entry.path, DRAGON_WING_ANIM, ['main'], files, raw, (root) => {
      // Same frame as gek models (see loadGek).
      if (raw) root.scale.z *= -1
      else root.scale.x *= -1
    }),
  )
}

// Lunar cloaks use the OptiFine layout: a 22x17 base grid (scaled by any integer), cape box 10x16x1 at uv 0,0.
const CAPE_GEO: GeoFile = {
  'minecraft:geometry': [
    {
      description: { texture_width: 22, texture_height: 17 },
      // The design is the box's north face (uv 1,1): it faces -z, towards the camera.
      bones: [{ name: 'cape', pivot: [0, 0, 0], cubes: [{ origin: [-5, 0, -1], size: [10, 16, 1], uv: [0, 0] }] }],
    },
  ],
}

// The same cape hung from the shoulders behind a player (bone named so it follows the torso).
const CAPE_ON_PLAYER: GeoFile = {
  'minecraft:geometry': [
    {
      description: { texture_width: 22, texture_height: 17 },
      // Player space: the back is -z, so the north face (the design) faces away from the back; tilted out at the bottom.
      bones: [{ name: 'bipedBody', pivot: [0, 24, -2.4], rotation: [-6, 0, 0], cubes: [{ origin: [-5, 8, -3.4], size: [10, 16, 1], uv: [0, 0] }] }],
    },
  ],
}

async function loadCloak(entry: LunarEntry, raw = false): Promise<LoadedModel> {
  const texBuf = await getFileBuffer(hashOf(entry.path))
  const files: DownloadFile[] = [{ name: baseName(entry.path), data: new Uint8Array(texBuf) }]
  return finish(await buildRig(raw ? CAPE_ON_PLAYER : CAPE_GEO, texBuf, entry.path, undefined, [], files, raw))
}

async function loadObj(entry: LunarEntry, raw = false): Promise<LoadedModel> {
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
  const parsedObj = new OBJLoader().parse(new TextDecoder().decode(objBuf))
  // Three conventions exist. Older models are y-down (Java, rendered with scale -1,-1,1) around the head
  // or the neck; later ones are y-down in player space (feet at 0, so the head is near y = -1.75); the
  // newest are y-up in player space. Tell them apart by the vertical center.
  const box = new Box3().setFromObject(parsedObj)
  const cy = (box.min.y + box.max.y) / 2
  const body = objPath.includes('/bodywear/')
  const folder = objPath.split('/').slice(-2)[0]!
  const space = cy > 0.6 ? 'feet-up' : cy < (body ? -0.4 : -1) ? 'feet' : 'local'
  const obj = new Group()
  obj.add(parsedObj)
  // The face mask is y-up too (its straps rise above the plate); flipped it was upside down.
  if (space !== 'feet-up' && folder !== 'mask') parsedObj.rotation.z = Math.PI
  obj.userData.objSpace = space
  obj.userData.objBody = body
  obj.userData.objFolder = folder
  obj.traverse((o) => {
    if ('material' in o) (o as unknown as { material: MeshLambertMaterial }).material = material
  })
  const files: DownloadFile[] = [
    { name: baseName(objPath), data: new Uint8Array(objBuf) },
    { name: baseName(entry.path), data: new Uint8Array(texBuf) },
  ]
  return finish({
    object: raw ? obj : fitObject(obj),
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
const measurable = (e?: LunarEntry) => !!e && e.kind !== 'gek' && e.kind !== 'file' && e.kind !== 'emote' && /\.(webp|png|gif)$/i.test(e.path)

/** Fills the catalog-wide fields (id, size, path, folder, ...) used by the filter and sort bar. */
function enrich(c: LunarCatalog) {
  for (const e of c.entries) {
    const f = e.item.fields
    const cat = e.item.category
    f.category = COSMETIC_LABELS[cat]?.[0] ?? RESOURCE_LABELS[cat]?.[0] ?? cat
    if (e.kind === 'emote') {
      // Emotes span several shared files; path/size of the icon would mislead.
      f.type = '3D'
      continue
    }
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
      if (!counts.has(id) || HIDDEN_CATEGORIES.has(id)) continue
      defs.push({ id, count: counts.get(id)!, label: RESOURCE_LABELS[id]![0], icon: RESOURCE_LABELS[id]![1], group: 'Resources (2D)' })
    }
    defs.unshift({ id: OUTFIT, count: counts.get('emotes') ?? 0, label: 'Outfit builder', icon: 'pi-user-edit', group: 'Tools' })
    defs.unshift({ id: EVERYTHING, count: catalog!.entries.length, label: 'Everything', icon: 'pi-th-large', group: '' })
    return defs
  },

  fields(category): FieldDef[] {
    const list = catalog!.entries.filter((e) => category === EVERYTHING || e.item.category === category).map((e) => e.item)
    const has = (k: string) => list.some((it) => it.fields[k] !== undefined && it.fields[k] !== '' && !(Array.isArray(it.fields[k]) && !(it.fields[k] as string[]).length))
    const opts = (k: string) => [...new Set(list.flatMap((it) => (Array.isArray(it.fields[k]) ? (it.fields[k] as string[]) : it.fields[k] ? [String(it.fields[k])] : [])))].sort()
    const out: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }]
    const add = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}) => has(key) && out.push({ key, label, type, ...extra })
    add('category', 'Category', 'multi', { options: opts('category') })
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
    add('duration', 'Duration (s)', 'number')
    add('looping', 'Looping', 'bool')
    add('author', 'Author', 'multi', { options: opts('author') })
    add('props', 'Props', 'multi', { options: opts('props') })
    add('morph', 'Morph', 'multi', { options: opts('morph') })
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

  items: (category) => catalog!.entries.filter((e) => category === EVERYTHING || e.item.category === category).map((e) => e.item),

  async imageUrl(item) {
    const e = byId.get(item.id)!
    return blobUrl(e.path)
  },

  async imageFrames(item) {
    return mcmetaFor(byId.get(item.id)!.path)
  },

  loadModel(item, opts) {
    const e = byId.get(item.id)!
    const raw = !!opts?.raw
    if (e.kind === 'gek') return loadGek(e, raw)
    if (e.kind === 'wing2d') return loadWing2d(e, raw)
    if (e.kind === 'cloak') return loadCloak(e, raw)
    if (e.kind === 'emote') return loadEmote(catalog!.emotes!.emotes.find((x) => x.id === item.fields.id)!, catalog!.emotes!, hashOf)
    return loadObj(e, raw)
  },

  dressPlayer(items, emote) {
    const entries = items.map((it) => byId.get(it.id)).filter((e): e is LunarEntry => !!e && e.kind !== 'image' && e.kind !== 'file' && e.kind !== 'emote')
    const em = emote ? catalog!.emotes?.emotes.find((x) => x.id === emote.fields.id) : undefined
    return dressPlayer(entries, em, catalog!.emotes, hashOf, (e) => lunarProvider.loadModel(e.item, { raw: true }))
  },

  itemById: (id) => byId.get(id)?.item,

  async sourceFiles(item) {
    const e = byId.get(item.id)
    if (!e) return []
    if (e.kind === 'emote') {
      const em = catalog!.emotes?.emotes.find((x) => x.id === item.fields.id)
      return em ? (await emoteSources(em, catalog!.emotes!, hashOf)).files : []
    }
    const out = new Map<string, DownloadFile>()
    const add = async (rel: string) => {
      rel = stripNs(rel)
      if (out.has(rel)) return
      const f = await optional(rel)
      if (!f) return
      out.set(rel, f)
      const mc = await optional(rel + '.mcmeta')
      if (mc) out.set(rel + '.mcmeta', mc)
    }
    await add(e.path)
    if (e.kind === 'gek') {
      // Every "lunar:..." reference in the gek (models, textures, animations, extras).
      const refs: string[] = []
      const walk = (v: unknown) => {
        if (typeof v === 'string' && v.startsWith('lunar:')) refs.push(v)
        else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x)
      }
      walk(await getFileJson(hashOf(e.path)))
      for (const r of refs) await add(r)
    } else if (e.kind === 'obj') {
      const objPath = catalog!.objs.get(e.modelKey)
      if (objPath) await add(objPath.slice(PREFIX.length))
    }
    // Keep names unique inside the item's folder.
    const files = [...out.values()]
    const seen = new Map<string, number>()
    return files.map((f) => {
      const n = seen.get(f.name) ?? 0
      seen.set(f.name, n + 1)
      return n ? { ...f, name: f.name.replace(/(\.[^.]+)?$/, `_${n}$1`) } : f
    })
  },

  estimateSize(item) {
    const e = byId.get(item.id)
    if (!e) return 0
    if (e.kind === 'emote') return 600_000
    if (e.kind === 'gek') {
      // A gek and its files share a folder.
      const dir = PREFIX + e.path.replace(/\/[^/]+$/, '/')
      let n = 0
      for (const [p, size] of catalog!.sizes) if (p.startsWith(dir)) n += size
      return n
    }
    return catalog!.sizes.get(PREFIX + e.path) ?? 0
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
      Duration: typeof f.duration === 'number' ? `${f.duration} s` : undefined,
      Looping: yn(f.looping),
      Author: f.author ? String(f.author) : undefined,
      Props: list(f.props),
      Morph: f.morph ? String(f.morph) : undefined,
      Animated: yn(f.animated),
      Special: yn(f.special),
      'File type': f.ext ? String(f.ext) : undefined,
      'File size': typeof f.size === 'number' && f.size ? formatBytes(f.size) : undefined,
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
