// A miniature Dawn CDN (assets_index.json + files): one of each kind of entry.
import type { FileBody } from '../helpers/cdnMock'
import { avif, webpVP8X } from './images'

export const G = 'game/cosmetics/'

const cube = (origin: number[], size: number[], uv: number[] = [0, 0]) => ({ origin, size, uv })
const geo = (w: number, h: number, bones: object[]) => ({
  format_version: '1.12.0',
  'minecraft:geometry': [{ description: { identifier: 'geometry.unknown', texture_width: w, texture_height: h }, bones }],
})

export const HAT_GEO = geo(32, 32, [
  { name: 'anchor_head', pivot: [0, 24, 0], cubes: [cube([-4, 32, -4], [8, 4, 8])] },
  { name: 'feather', parent: 'anchor_head', pivot: [0, 36, 0], cubes: [cube([-1, 36, -1], [2, 2, 2], [0, 12])] },
])
export const HAT_ANIM = {
  format_version: '1.8.0',
  animations: {
    'animation.testHat.idle': { loop: true, animation_length: 2, bones: { feather: { rotation: { '0.0': { vector: [0, 0, 0] }, '2.0': { vector: [0, 360, 0], easing: 'easeInOutSine' } } } } },
    'animation.testHat.null': { loop: true, bones: {} },
  },
  geckolib_format_version: 2,
}
export const HAT_META = { states: {}, scaleLayers: true, hideDuringCombat: false, armorConstraints: [{ slot: 'helmet' }] }

export const WINGS_GEO = geo(64, 64, [
  { name: 'anchor_body', pivot: [0, 24, 0] },
  { name: 'rightWing', parent: 'anchor_body', pivot: [-1, 22, 2], cubes: [cube([-13, 14, 2], [12, 10, 0])] },
  { name: 'leftWing', parent: 'anchor_body', pivot: [1, 22, 2], cubes: [cube([1, 14, 2], [12, 10, 0], [0, 20])] },
])
export const WINGS_ANIM = {
  format_version: '1.8.0',
  animations: {
    'animation.testWings.idle': { loop: true, animation_length: 1, bones: { rightWing: { rotation: { '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' }, '0.5': { post: [0, 30, 0], lerp_mode: 'catmullrom' }, '1.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' } } } } },
    'animation.testWings.fly': { loop: true, animation_length: 1, bones: { leftWing: { rotation: [0, 'math.sin(q.anim_time * 360) * 20', 0] } } },
  },
}
export const BOOTS_GEO = geo(32, 32, [
  { name: 'anchor_rightleg', pivot: [-1.9, 12, 0], cubes: [cube([-4, 0, -2], [4, 3, 4])] },
  { name: 'anchor_leftleg', pivot: [1.9, 12, 0], cubes: [cube([0, 0, -2], [4, 3, 4], [0, 8])] },
])
export const FLAT_SHIELD_GEO = geo(286, 320, [{ name: 'shield', pivot: [0, 0, 0], cubes: [cube([-6, -1, -2], [12, 22, 1])] }])
export const TRIM_HEAD_GEO = geo(64, 32, [{ name: 'anchor_head', pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8])] }])
export const TRIM_CHEST_GEO = geo(64, 32, [
  { name: 'anchor_body', pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4], [16, 16])] },
  { name: 'anchor_rightarm', pivot: [-5, 22, 0], cubes: [cube([-8, 12, -2], [4, 12, 4], [40, 16])] },
])
export const AURA_GEO = geo(16, 16, [{ name: 'anchor_body', pivot: [0, 0, 0], cubes: [cube([-8, 0, -8], [16, 0, 16])] }])

export const DAWN_FILES: [string, FileBody][] = [
  [`${G}hats/testHat.geo.json`, HAT_GEO],
  [`${G}hats/testHat.webp`, webpVP8X(32, 32)],
  [`${G}hats/testHat.animation.json`, HAT_ANIM],
  [`${G}hats/testHat.meta.json`, HAT_META],
  // texture-only colour variant of testHat
  [`${G}hats/testHatBlue.webp`, webpVP8X(32, 32)],
  [`${G}hats/testCrown.geo.json`, HAT_GEO],
  [`${G}hats/testCrown.avif`, avif(32, 32)],
  [`${G}wings/testWings.geo.json`, WINGS_GEO],
  [`${G}wings/testWings.webp`, webpVP8X(64, 64)],
  [`${G}wings/testWings.animation.json`, WINGS_ANIM],
  [`${G}boots/testBoots.geo.json`, BOOTS_GEO],
  [`${G}boots/testBoots.webp`, webpVP8X(32, 32)],
  // no model anywhere: shown as a flat image
  [`${G}boots/lonelyBoots.webp`, webpVP8X(32, 32)],
  [`${G}cloaks/testCape.avif`, avif(352, 272)],
  [`${G}cloaks/plainCloak.webp`, webpVP8X(22, 17)],
  [`${G}shields/rectangleShield320.geo.json`, FLAT_SHIELD_GEO],
  [`${G}shields/testShield.avif`, avif(286, 320)],
  [`${G}trim/head.geo.json`, TRIM_HEAD_GEO],
  [`${G}trim/chest.geo.json`, TRIM_CHEST_GEO],
  [`${G}trim/glowTrim_chest.webp`, webpVP8X(64, 32)],
  [`${G}trim/glowTrim_head.webp`, webpVP8X(64, 32)],
  [`${G}auras/strayAura.geo.json`, AURA_GEO],
  [`${G}auras/strayAura.webp`, webpVP8X(16, 16)],
  // the same aura's texture and animation, filed under pets
  [`${G}pets/strayAura.webp`, webpVP8X(16, 16)],
  [`${G}pets/strayAura.animation.json`, { animations: {} }],
  ['game/lang/en_us.json', { 'feather.modulename.cosmetic': 'Cosmetics' }],
]
