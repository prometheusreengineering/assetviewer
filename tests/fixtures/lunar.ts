// A miniature Lunar CDN: every kind of catalog entry, an unlisted file of each kind, resources and emotes.
import type { FileBody } from '../helpers/cdnMock'
import { gif, png } from './images'
import { actionBlock, playerBobj, PROPS_BOBJ } from './player'

export const P = 'assets/lunar/'
const CROWN = 'cosmetics/models/gek/hats/crown/'
const DOG = 'cosmetics/models/gek/pets/dog/'

export const CROWN_GEK = {
  model: `lunar:${CROWN}crown.geo.json`,
  texture: `lunar:${CROWN}textures/crown.webp`,
  animation: `lunar:${CROWN}crown.anim.json`,
  attached_bone: 'HEAD',
  hide_body: true,
  hide_head: false,
  transformations: [
    { transformType: 'rotate', values: { angle: 180, x: 0, y: 1, z: 0 } },
    { transformType: 'translate', values: { x: 5 } },
  ],
  state_machine: { controllers: [{ states: [{ anim: 'spin', plays_when: '1' }, { anim: 'gui', plays_when: 'q.is_gui' }] }] },
  extras: { glow: `lunar:${CROWN}textures/glow.webp`, missing: 'lunar:cosmetics/nowhere.webp' },
}

export const CROWN_GEO = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.crown', texture_width: 32, texture_height: 32 },
      bones: [
        { name: 'root', pivot: [0, 24, 0] },
        { name: 'bipedHead', parent: 'root', pivot: [0, 24, 0], cubes: [{ origin: [-4, 32, -4], size: [8, 4, 8], uv: [0, 0] }] },
        { name: 'jewel', parent: 'bipedHead', pivot: [0, 36, 0], cubes: [{ origin: [-1, 36, -1], size: [2, 2, 2], uv: [0, 12] }] },
      ],
    },
  ],
}

export const CROWN_ANIM = {
  format_version: '1.8.0',
  animations: {
    gui: { loop: true, bones: { root: { rotation: [0, 45, 0] } } },
    spin: { loop: true, animation_length: 2, bones: { jewel: { rotation: { '0': [0, 0, 0], '2': [0, 360, 0] }, scale: 'lunar.double(0.5)' } } },
  },
}

const DOG_GEK = {
  model: { [`lunar:${DOG}dog.geo.json`]: '!q.is_slim', [`lunar:${DOG}dog_slim.geo.json`]: 'q.is_slim' },
  texture: `lunar:${DOG}textures/missing.webp`,
  attached_bone: 'SHOULDER',
}
const DOG_GEO = {
  'minecraft:geometry': [{ description: { texture_width: 16, texture_height: 16 }, bones: [{ name: 'dog', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 4, 8], uv: [0, 0] }] }] }],
}

const OBJ = ['o hat', 'v -0.25 -0.5 -0.25', 'v 0.25 -0.5 -0.25', 'v 0 -0.8 0.25', 'vt 0 0', 'vt 1 0', 'vt 0 1', 'vn 0 1 0', 'f 1/1/1 2/2/1 3/3/1', ''].join('\n')

const COSMETICS_JSON = [
  { id: 1, name: 'Crown', resource: `lunar:${CROWN}crown.gek.json`, category: 'hat', indexType: 'NONE', geckolibCosmetic: true, special: true, animated: false, colors: ['GOLD'], tags: ['FANCY'], releasedAt: '2023-05-01T12:00:00Z' },
  { id: 2, name: 'Red Wings', resource: 'lunar:cosmetics/wings/red.webp', category: 'dragon_wings', indexType: 'NONE', geckolibCosmetic: false, special: false, animated: false, colors: ['RED'], tags: [] },
  { id: 3, name: 'Blue Cloak', resource: 'lunar:cosmetics/cloaks/blue.webp', category: 'cloak', indexType: '', geckolibCosmetic: false, special: false, animated: false, colors: ['BLUE'], tags: ['COOL'] },
  { id: 4, name: 'Top Hat', resource: 'lunar:cosmetics/models/hats/tophat/textures/black.webp', category: 'hat', indexType: 'tophat', geckolibCosmetic: false, special: false, animated: false, colors: [], tags: ['FANCY', 'CLASSIC'] },
  { id: 5, name: '', resource: 'lunar:cosmetics/misc/flat.webp', category: 'bodywear', indexType: 'nomodel', geckolibCosmetic: false, special: false, animated: true, colors: null, tags: null, releasedAt: 'not a date' },
]

// id,?,?,name,?,?,category,modelKey,path,?,themes,colors
const CSV = [
  '1,x,x,Crown dup,x,x,hat,NONE,cosmetics/models/gek/hats/crown/crown.gek.json,x,,',
  '10,x,x,Old Mask,x,x,mask,mask,cosmetics/models/hats/mask/textures/old.webp,x,SPOOKY|DARK,BLACK',
  '11,x,x,Gone,x,x,hat,NONE,cosmetics/nope.webp,x,,',
  '12,x,x,,x,x,cloak,NONE,cosmetics/cloaks/legacy/legacy.webp,x,,',
  'short,row',
  '',
].join('\n')

export const SPARKS = {
  format_version: '1.10.0',
  particle_effect: {
    description: { identifier: 'lunar:sparks', basic_render_parameters: { material: 'particles_alpha', texture: 'textures/particle/particles' } },
    components: {
      'minecraft:emitter_rate_steady': { spawn_rate: 20, max_particles: 50 },
      'minecraft:emitter_lifetime_looping': { active_time: 1 },
      'minecraft:emitter_shape_sphere': { radius: 0.2, direction: 'outwards' },
      'minecraft:particle_lifetime_expression': { max_lifetime: 0.5 },
      'minecraft:particle_initial_speed': 1,
      'minecraft:particle_appearance_billboard': { size: [0.05, 0.05], facing_camera_mode: 'lookat_xyz', uv: { texture_width: 128, texture_height: 128, uv: [0, 0], uv_size: [8, 8] } },
    },
  },
}

const EMOTES = {
  props: ['emotes/models/props/hat_prop.bobj'],
  actions: ['emotes/models/actions_a.bobj', 'emotes/models/actions_b.bobj'],
  meshes: { hat_prop: { visible: false, texture: 'lunar:emotes/textures/prop.webp' } },
  emotes: [
    { id: 1, name: 'wave_hello', duration: 50, looping: true, author: 'Bob', meshes: [{ name: 'hat_prop', show_at: 5 }], morph: 'sparkle' },
    { id: 2, name: 'dance', duration: 20 },
    { id: 3, name: 'ghost', duration: 0, particleEffect: 'sparks' },
    { id: 4, name: 'broken', duration: 10, morph: 'broken' },
  ],
}

/** Files in index order (relative to P) with their bodies. */
export const LUNAR_FILES: [string, FileBody][] = [
  ['cosmetics.json', COSMETICS_JSON],
  ['cosmetics/index', CSV],
  ['cosmetics/functions.molang', 'lunar.double(a.x): |-\n  return a.x * 2;\n'],
  [`${CROWN}crown.gek.json`, CROWN_GEK],
  [`${CROWN}crown.geo.json`, CROWN_GEO],
  [`${CROWN}crown.anim.json`, CROWN_ANIM],
  [`${CROWN}textures/crown.webp`, png(32, 32)],
  [`${CROWN}textures/glow.webp`, png(32, 32)],
  [`${CROWN}crown.fsh`, 'void main() {}'],
  ['cosmetics/wings/red.webp', png(256, 256)],
  ['cosmetics/wings/thumbnail/red.webp', png(64, 64)],
  ['cosmetics/cloaks/blue.webp', png(44, 68)],
  ['cosmetics/cloaks/blue.webp.mcmeta', { animation: { frametime: 2 } }],
  ['cosmetics/cloaks/blue/extra.webp', png(4, 4)],
  ['cosmetics/models/hats/tophat/tophat.obj', OBJ],
  ['cosmetics/models/hats/tophat/textures/black.webp', png(16, 16)],
  ['cosmetics/misc/flat.webp', png(8, 8)],
  ['cosmetics/models/hats/mask/mask.obj', OBJ],
  ['cosmetics/models/hats/mask/textures/old.webp', png(16, 16)],
  ['cosmetics/cloaks/legacy/legacy.webp', png(22, 17)],
  // unlisted
  [`${DOG}dog.gek.json`, DOG_GEK],
  [`${DOG}dog.geo.json`, DOG_GEO],
  [`${DOG}dog_slim.geo.json`, DOG_GEO],
  ['cosmetics/models/gek/weird/thing/thing.gek.json', { model: 'lunar:x', texture: 'lunar:y' }],
  ['cosmetics/models/bodywear/scarf/textures/red_scarf.webp', png(16, 16)],
  ['cosmetics/models/hats/bandanna/bandanna.obj', OBJ],
  ['cosmetics/models/hats/bandanna/textures/blue-bandanna.webp', png(16, 16)],
  ['cosmetics/models/hats/mask/textures/new.webp', png(16, 16)],
  ['cosmetics/models/hats/plain/textures/cap.webp', png(16, 16)],
  ['cosmetics/wings/green.webp', png(256, 256)],
  ['cosmetics/wings/thumbnail/green.webp', png(64, 64)],
  ['cosmetics/wings/thumbnail/lonely.webp', png(64, 64)],
  ['cosmetics/cloaks/unl.webp', png(22, 17)],
  ['cosmetics/cloaks/unl.webp.mcmeta', { animation: {} }],
  // resources
  ['badges.json', [{ id: 7, name: 'Gold Badge', description: 'Shiny', resource: 'lunar:badges/gold.png', releasedAt: '2022-01-02T00:00:00Z' }]],
  ['sprays.json', [{ id: 8, name: 'Heart', resource: 'lunar:sprays/heart.gif', animated: true }]],
  ['badges/gold.png', png(18, 18)],
  ['sprays/heart.gif', gif(32, 32)],
  ['sprays/heart.gif.mcmeta', { animation: { frametime: 1 } }],
  ['sprays/plain.webp', png(32, 32)],
  ['emotes/icons/1.webp', png(64, 64)],
  ['emotes/textures/prop.webp', png(16, 16)],
  ['emotes/emotes.json', EMOTES],
  ['emotes/models/entity/default.bobj', playerBobj()],
  ['emotes/models/entity/default.json', { meshes: { hat_prop: { texture: 'lunar:emotes/textures/prop.webp' } } }],
  ['emotes/models/actions_a.bobj', '# a\n' + actionBlock('other', 10)],
  ['emotes/models/actions_b.bobj', '# b\n' + actionBlock('dance', 30) + actionBlock('wave_hello', 40)],
  ['emotes/models/props/hat_prop.bobj', PROPS_BOBJ],
  ['particles/textures/default_particles.webp', png(128, 128)],
  ['particles/configuration.json', { sparkle: { morphs: [{ morph: '{Scheme:"sparks"}', bone: 'head', start: 10, length: 20, translate: [0, 0.5, 0] }, { morph: 'no scheme here' }, { morph: '{Scheme:"sparks"}', bone: 'no_such_bone' }] }, broken: { morphs: [{ morph: '{Scheme:"missing"}' }] } }],
  ['particles/schemes/sparks.particle.json', SPARKS],
  ['icons/x.png', png(16, 16)],
  ['misc/y.jpg', 'jpeg'],
  ['shaders/glint.vsh', 'void main() {}'],
]

export const LUNAR_FULL: [string, FileBody][] = LUNAR_FILES.map(([p, b]) => [P + p, b])
