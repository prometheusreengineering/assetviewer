// Essential emotes: the emote's geometry is a bare player skeleton (root > body_orbit > body_ext > body_wrap >
// body/head/arms/legs, each part under an `_ext` bone) plus props. In-game the player's own parts hang from
// those bones; here the player is built as standard Bedrock cubes in the skin's box-UV layout and dropped into
// them, so the emote's Bedrock animation moves it directly.
import { Box3, Group, Vector3, type Material, type Matrix4, type Mesh, type Object3D } from 'three'
import { isSlimSkin, skinBitmap } from '../../skin'
import { AnimationPlayer, normalizeAnims, type AnimFile } from '../../three/animation/bedrockAnim'
import { EffectPlayer, particleCues, type LoadedEffect } from '../../three/effects'
import { fitObject, visibleBox } from '../../three/fit'
import { buildGeoRig, createMaterial, createTexture, type GeoBone, type GeoFile } from '../../three/geoModel'
import { transparentPixel } from '../../three/glow'
import { buildRig, finish, singleFrame } from '../../three/rig'
import type { DownloadFile, LoadedModel } from '../types'
import { socket } from '../lunar/dress'
import { emoteTimeline } from '../lunar/emotes'
import { maskedSkin } from '../../three/player'
import { SoundPlayer, soundCues, type SoundDefinitions } from './sounds'

type Cube = { origin: [number, number, number]; size: [number, number, number]; uv: [number, number]; inflate?: number }
const part = (origin: Cube['origin'], size: Cube['size'], uv: [number, number], outer: [number, number], inflate: number): Cube[] => [
  { origin, size, uv },
  { origin, size, uv: outer, inflate },
]

/** The six player parts in the 64x64 skin layout (outer layer inflated over each), wide or slim arms. */
export function playerParts(slim: boolean): Record<string, Cube[]> {
  const aw = slim ? 3 : 4
  return {
    head: part([-4, 24, -4], [8, 8, 8], [0, 0], [32, 0], 0.5),
    body: part([-4, 12, -2], [8, 12, 4], [16, 16], [16, 32], 0.25),
    arm_right: part([-4 - aw, 12, -2], [aw, 12, 4], [40, 16], [40, 32], 0.25),
    arm_left: part([4, 12, -2], [aw, 12, 4], [32, 48], [48, 48], 0.25),
    leg_right: part([-3.9, 0, -2], [4, 12, 4], [0, 16], [0, 32], 0.25),
    leg_left: part([-0.1, 0, -2], [4, 12, 4], [16, 48], [0, 48], 0.25),
  }
}

interface Trigger {
  type?: string
  name?: string
  on_complete?: { name?: string }
}
export interface EssentialEmoteFile extends AnimFile {
  triggers?: Trigger[]
}

/** The animations an emote plays: the EMOTE trigger's, then its `on_complete` loop if any. */
export function emoteSequence(file: EssentialEmoteFile): string[] {
  const t = (file.triggers ?? []).find((x) => x.type === 'EMOTE')
  const first = t?.name ?? Object.keys(file.animations ?? {})[0]
  if (!first) return []
  const then = t?.on_complete?.name
  return then && then !== first ? [first, then] : [first]
}

export interface EmoteSources {
  geo: GeoFile
  anim: EssentialEmoteFile
  /** Props texture (the emote's texture.png), if any. */
  texture?: ImageBitmap
  effects: Map<string, LoadedEffect>
  sounds?: SoundDefinitions
  /** Bytes of a sound file by its path without extension (`sounds/em_x_start`). */
  sound: (path: string) => Promise<ArrayBuffer | undefined>
  files: DownloadFile[]
}

/** Cosmetics worn during the emote (outfit builder): raw Essential models and their skin masks. */
export interface EmoteOutfit {
  worn: Object3D[]
  masks: ImageBitmap[]
}
/** Cosmetic bones that have no emote bone of their name, and the emote bone they ride on. */
const STAND_IN: Record<string, string> = { cape: 'body' }

const TICKS = 20

export async function buildEmote(src: EmoteSources, outfit?: EmoteOutfit): Promise<LoadedModel> {
  const plain = await skinBitmap()
  // Skin pixels under worn cosmetics are hidden (their skin masks).
  const skin = outfit?.masks.length ? await maskedSkin(plain, outfit.masks) : plain
  // (slim arms are read from the skin itself: masks make the arm columns transparent)
  const slim = isSlimSkin(plain)
  // Props and the skeleton: the emote's own texture (a transparent pixel when it has none).
  const propTex = src.texture ?? (await transparentPixel())
  const rig = buildRig(src.geo, propTex, singleFrame(), src.files, {
    raw: true,
    flipU: true,
    // Bedrock geometry is x-mirrored and faces -z, like every other Bedrock model here.
    prep: (root) => (root.scale.x *= -1),
  })
  const skel = rig.bones ?? new Map()
  // The player: one rig of the six parts in the skin's texture, each part moved under the emote bone of
  // the same name (same pivot), so the emote's animation carries it.
  const parts = playerParts(slim)
  const pivots = new Map((src.geo['minecraft:geometry'][0]?.bones ?? []).map((b) => [b.name, b.pivot ?? [0, 0, 0]] as const))
  const bones: GeoBone[] = Object.entries(parts)
    .filter(([name]) => skel.has(name))
    .map(([name, cubes]) => ({ name, pivot: [...pivots.get(name)!] as [number, number, number], cubes }))
  const skinMat = createMaterial(createTexture(skin))
  const player = buildGeoRig({ 'minecraft:geometry': [{ description: { texture_width: 64, texture_height: 64 }, bones }] } as GeoFile, skinMat, true)
  for (const [name, b] of player.bones) {
    const target = skel.get(name)!.group
    b.group.position.set(0, 0, 0)
    b.group.rotation.set(0, 0, 0)
    target.add(b.group)
  }
  const model = finish(rig)
  const object = new Group()
  object.add(rig.object)
  // Worn cosmetics hang from the emote's bones of the same names, as in game (the skeleton is still at rest).
  // Raw models are z-mirrored, the emote rig x-mirrored: a half turn lines them up.
  for (const worn of outfit?.worn ?? []) {
    // Cosmetics often repeat the skin's own boxes (a onesie's body is the body at inflate 0); the game draws
    // them over the player, so they win equal depths here too.
    worn.traverse((o) => {
      const mat = (o as Mesh).material as Material | undefined
      if ((o as Mesh).isMesh && mat && 'polygonOffset' in mat) {
        mat.polygonOffsetFactor = -1
        mat.polygonOffsetUnits = -1
      }
    })
    const turn = new Group()
    turn.rotation.y = Math.PI
    turn.add(worn)
    object.add(turn)
    object.updateMatrixWorld(true)
    const parts: [Object3D, Object3D, Matrix4][] = []
    for (const o of worn.getObjectByName('root')?.children ?? []) {
      const target = skel.get(o.name) ?? skel.get(STAND_IN[o.name] ?? '')
      if (target) parts.push([o, target.group, o.parent!.matrixWorld.clone()])
    }
    for (const [o, bone, parentWorld] of parts) socket(bone, o, undefined, parentWorld)
  }

  // Timeline: the emote's animations one after another, the last one looping.
  const anim = normalizeAnims(src.anim)
  const seq = emoteSequence(src.anim).map((n) => n.split('.').pop()!).filter((n) => n in anim.animations)
  const player2 = new AnimationPlayer(skel, anim, new Map(), seq)
  const lengths = seq.map((n) => player2.lengthOf(n) || 1)
  const total = lengths.reduce((a, b) => a + b, 0) || 1
  const at = (t: number): [string, number] => {
    let rest = t
    for (let i = 0; i < seq.length; i++) {
      if (rest < lengths[i]! || i === seq.length - 1) return [seq[i]!, Math.min(rest, lengths[i]!)]
      rest -= lengths[i]!
    }
    return [seq[0] ?? '', 0]
  }
  // Particles and sounds follow the same clock (in timeline ms).
  const cues = particleCues(src.anim, emoteSequence(src.anim))
  const effects = cues.length ? new EffectPlayer(cues.map((c) => ({ ...c, length: total, time: offsetOf(c.anim) + c.time })), src.effects, rig.locators ?? new Map(), object) : undefined
  if (effects?.count) object.add(effects.object)
  const sounds = src.sounds ? new SoundPlayer(soundCues(src.anim, emoteSequence(src.anim)).map((c) => ({ ...c, time: offsetOf(c.anim) + c.time })), src.sounds, src.sound) : undefined
  function offsetOf(full: string) {
    const i = seq.indexOf(full.split('.').pop()!)
    return i <= 0 ? 0 : lengths.slice(0, i).reduce((a, b) => a + b, 0)
  }

  // Framed like a standing player with headroom (props and jumps leave the rest pose), plus the first frame.
  player2.poseAt(seq[0] ?? '', 0)
  const frame = visibleBox(object).union(new Box3(new Vector3(-1.1, -0.2, -1.1), new Vector3(1.1, 2.6, 1.1)))
  const fitted = fitObject(object, 1.6, frame)
  const looping = true
  const { timeline, tick } = emoteTimeline(total * TICKS, looping, (ticks) => {
    const t = ticks / TICKS
    const [name, local] = at(t)
    player2.poseAt(name, local)
    rig.object.updateMatrixWorld(true)
    effects?.tick(t * 1000)
    sounds?.at(t, total)
  })
  const pausable = timeline as typeof timeline & { paused: boolean }
  return {
    ...model,
    object: fitted,
    frames: 1,
    states: [],
    state: '',
    setState: () => {},
    timeline,
    tick(ms) {
      tick(ms)
      if (pausable.paused) sounds?.stop()
    },
    setSound: (on) => sounds?.setEnabled(on),
    hasSound: !!sounds?.count,
    files: src.files,
    dispose() {
      model.dispose()
      skinMat.map?.dispose()
      skinMat.dispose()
      effects?.dispose()
      sounds?.dispose()
    },
  }
}

