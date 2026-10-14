// Synthetic Essential data in the dump/cache layout (made-up ids, files and URLs; never real catalog data).
import { createHash } from 'node:crypto'
import { cachePath } from '../../src/providers/essential/localData'
import { png } from './images'

const enc = new TextEncoder()
const bytes = (b: Uint8Array | string | object) => (b instanceof Uint8Array ? b : enc.encode(typeof b === 'string' ? b : JSON.stringify(b)))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const geo = (bones: object[]) => ({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.x', texture_width: 32, texture_height: 32 }, bones }] })
export const HAT_GEO = geo([
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'head', parent: 'root', pivot: [0, 24, 0] },
  { name: 'brim', parent: 'head', pivot: [0, 32, 0], cubes: [{ origin: [-5, 32, -5], size: [10, 1, 10], uv: [0, 0] }] },
  { name: 'tip', parent: 'brim', pivot: [0, 33, 0], cubes: [{ origin: [-2, 33, -2], size: [4, 3, 4], uv: [0, 12] }] },
])
export const WINGS_GEO = geo([
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'body', parent: 'root', pivot: [0, 24, 0] },
  { name: 'wing_left', parent: 'body', pivot: [2, 22, 2], cubes: [{ origin: [2, 14, 2], size: [10, 10, 0], uv: { south: { uv: [0, 0], uv_size: [10, 10] } } }] },
  { name: 'wing_right', parent: 'body', pivot: [-2, 22, 2], cubes: [{ origin: [-12, 14, 2], size: [10, 10, 0], uv: { south: { uv: [10, 0], uv_size: [10, 10] } } }] },
])
export const TOP_GEO = geo([
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'body', parent: 'root', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
  { name: 'arm_right', parent: 'root', pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
  { name: 'arm_left', parent: 'root', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }] },
])
export const BRACELET_GEO = geo([
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'arm_right', parent: 'root', pivot: [-5, 22, 0] },
  { name: 'side_right', parent: 'arm_right', pivot: [-5, 22, 0], cubes: [{ origin: [-8.5, 13, -2.5], size: [5, 2, 5], uv: [0, 0] }] },
  { name: 'arm_left', parent: 'root', pivot: [5, 22, 0] },
  { name: 'side_left', parent: 'arm_left', pivot: [5, 22, 0], cubes: [{ origin: [3.5, 13, -2.5], size: [5, 2, 5], uv: [0, 8] }] },
])
// The same top with 3 px (slim) arms
export const TOP_ALEX_GEO = geo([
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'body', parent: 'root', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
  { name: 'arm_right', parent: 'root', pivot: [-5, 22, 0], cubes: [{ origin: [-7, 12, -2], size: [3, 12, 4], uv: [40, 16] }] },
  { name: 'arm_left', parent: 'root', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [3, 12, 4], uv: [32, 48] }] },
])
export const HAT_ANIM = {
  format_version: '1.8.0',
  animations: {
    'animation.test_hat.spin': { loop: true, animation_length: 2, bones: { tip: { rotation: { '0.0': [0, 0, 0], '2.0': [0, 360, 0] } } } },
    'animation.test_hat.wobble': { loop: true, animation_length: 1, bones: { brim: { rotation: [0, 0, 'math.sin(q.anim_time * 360) * 5'] } } },
  },
  triggers: [{ type: 'IDLE', target: 'ALL', name: 'animation.test_hat.spin', loops: 0, priority: 1 }],
}

interface Def {
  id: string
  category: string
  name?: string
  tags?: string[]
  price?: number
  rarity?: string
  files: Record<string, Uint8Array | string | object>
  /** files left out of the local cache (served from the "CDN" instead) */
  remote?: string[]
}

const DEFS: Def[] = [
  {
    id: 'TEST_HAT',
    category: 'HAT',
    name: 'Test Hat',
    tags: ['THEME_SPRING', 'COLLECTION_JANUARY2026', 'PREVIOUSLY_UNPOPULAR'],
    price: 600,
    rarity: 'RARE',
    files: {
      'geometry.steve.json': HAT_GEO,
      'variants/red/texture.png': png(32, 32),
      'variants/blue/texture.png': png(32, 32).map((b, i) => (i === 40 ? 1 : b)),
      'animations.json': HAT_ANIM,
      'settings.json': [{ type: 'VARIANTS', id: 'UNUSED', enabled: true, data: { variants: [{ name: 'blue', color: 255 }, { name: 'red', color: 16711680 }] } }],
    },
  },
  {
    id: 'TEST_WINGS',
    category: 'WINGS',
    name: 'Test Wings',
    rarity: 'EPIC',
    price: 900,
    // 4 stacked animation frames (32x128 for a 32x32 model), a glow layer and a skin mask
    files: {
      'geometry.steve.json': WINGS_GEO,
      'texture.png': png(32, 128).map((b, i) => (i === 41 ? 2 : b)),
      'emissive.png': png(32, 128).map((b, i) => (i === 41 ? 3 : b)),
      'skin_mask.steve.png': png(64, 64).map((b, i) => (i === 41 ? 4 : b)),
    },
  },
  {
    id: 'TEST_TOP',
    category: 'TOP',
    files: { 'geometry.steve.json': TOP_GEO, 'geometry.alex.json': TOP_ALEX_GEO, 'texture.png': png(64, 64) },
    // its texture is only on the "CDN"
    remote: ['texture.png'],
  },
  {
    id: 'TEST_BRACELET',
    category: 'ARMS',
    name: 'Test Bracelet',
    files: {
      'geometry.steve.json': BRACELET_GEO,
      'texture.png': png(32, 32).map((b, i) => (i === 42 ? 5 : b)),
      'skin_mask.steve.left.png': png(64, 64).map((b, i) => (i === 42 ? 6 : b)),
      'skin_mask.steve.right.png': png(64, 64).map((b, i) => (i === 42 ? 7 : b)),
      // hidden under the test top's... body (COSMETIC_BONE_HIDING: this bracelet's arms hide when TEST_TOP is worn)
      'settings.json': [{ type: 'COSMETIC_BONE_HIDING', id: 'TEST_TOP', enabled: true, data: { arms: true } }, { type: 'EXTERNAL_HIDDEN_BONE', id: 'TEST_WINGS', enabled: true, data: { wing_left: true } }],
    },
  },
  {
    id: 'TEST_DANCE',
    category: 'EMOTE',
    name: 'Test Dance',
    files: {
      // Essential emote skeleton (the player's parts are added under these bones) and a prop
      'geometry.steve.json': geo([
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body_orbit', parent: 'root', pivot: [0, 18, 0] },
        { name: 'body_wrap', parent: 'body_orbit', pivot: [0, 12, 0] },
        { name: 'body', parent: 'body_wrap', pivot: [0, 24, 0] },
        { name: 'head', parent: 'body_wrap', pivot: [0, 24, 0] },
        { name: 'arm_right', parent: 'body_wrap', pivot: [-5, 22, 0] },
        { name: 'arm_left', parent: 'body_wrap', pivot: [5, 22, 0] },
        { name: 'leg_right', parent: 'body_orbit', pivot: [-1.9, 12, 0] },
        { name: 'leg_left', parent: 'body_orbit', pivot: [1.9, 12, 0] },
        { name: 'prop', parent: 'arm_right', pivot: [-6, 12, 0], cubes: [{ origin: [-7, 10, -1], size: [2, 2, 2], uv: [0, 0] }] },
      ]),
      'animations.json': {
        animations: {
          'animation.dance.start': { animation_length: 1, sound_effects: { '0.0': { effect: 'beat' } }, bones: { arm_right: { rotation: { '0.0': [0, 0, 0], '1.0': [-90, 0, 0] } } } },
          'animation.dance.loop': { loop: true, animation_length: 2, sound_effects: { '0.5': { effect: 'beat' } }, bones: { arm_right: { rotation: [-90, 0, 'math.sin(q.anim_time * 180) * 20'] } } },
        },
        triggers: [{ type: 'EMOTE', target: 'ALL', name: 'animation.dance.start', on_complete: { name: 'animation.dance.loop' }, loops: 1 }],
      },
      'texture.png': png(16, 16),
      'sounds/sound_definitions.json': { sound_definitions: { beat: { sounds: [{ name: 'sounds/beat', volume: 0.5 }] } } },
      'sounds/beat.ogg': 'OggS fake',
    },
  },
]

export interface EssentialFixture {
  /** dumps folder: `<CATEGORY>/<ID>.json` */
  dumps: Record<string, string>
  /** cosmetic-cache folder: `<h0>/<h1>/<h[2:]>` */
  cache: Record<string, Uint8Array>
  /** url -> bytes for files not in the cache */
  remote: Map<string, Uint8Array>
  /** id -> path -> sha256 */
  hashes: Record<string, Record<string, string>>
}

export function essentialFixture(): EssentialFixture {
  const out: EssentialFixture = { dumps: {}, cache: {}, remote: new Map(), hashes: {} }
  for (const d of DEFS) {
    const q: Record<string, { a: string; b: string }> = {}
    out.hashes[d.id] = {}
    for (const [path, body] of Object.entries(d.files)) {
      const b = bytes(body)
      const h = sha(b)
      const url = `https://cdn.example/assets/${h}`
      q[path] = { a: url, b: h }
      out.hashes[d.id]![path] = h
      if (d.remote?.includes(path)) out.remote.set(url, b)
      else out.cache[cachePath(h)] = b
    }
    const dump = { a: d.id, b: d.category, c: d.name ? { en_us: d.name } : {}, f: 0, h: d.tags ?? [], i: {}, m: { [d.category]: 20 }, n: 1, o: d.price, p: d.rarity, q }
    out.dumps[`${d.category}/${d.id}.json`] = JSON.stringify(dump)
  }
  // an unrelated, broken file in the dumps folder
  out.dumps['HAT/broken.json'] = '{not json'
  return out
}
