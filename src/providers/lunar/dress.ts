import { Box3, Group, Vector3, type Object3D } from 'three'
import type { Player } from '../../three/player'
import type { DownloadFile, LoadedModel } from '../types'
import type { EmoteDef, EmotesJson, LunarEntry } from './catalog'
import { emoteEffects, emoteTimeline, findAction, newPlayer } from './emotes'

type HashOf = (rel: string) => string

// Bedrock biped bones -> bones of the emote player armature.
const BIPED: Record<string, string> = {
  Head: 'head',
  Body: 'low_body',
  RightArm: 'right_arm',
  LeftArm: 'left_arm',
  RightLeg: 'right_leg',
  LeftLeg: 'left_leg',
}
const OTHER_SIDE: Record<string, string> = { right_arm: 'left_arm', left_arm: 'right_arm', right_leg: 'left_leg', left_leg: 'right_leg' }
/** OBJ models (legacy hats/bodywear) are placed around these centers (blocks). */
const HEAD_CENTER = 1.75
const CHEST_CENTER = 1.125
const HEAD_TOP = 0.25

const _a = new Vector3()
const _b = new Vector3()

/**
 * Re-parents `obj` under a player bone without changing its local transform (cosmetic animations write
 * it): a fixed holder reproduces the rest-pose transform of its old parent relative to the bone.
 */
function socket(bone: Object3D, obj: Object3D) {
  const holder = new Group()
  holder.matrixAutoUpdate = false
  holder.matrix.copy(bone.matrixWorld).invert().multiply(obj.parent!.matrixWorld)
  bone.add(holder)
  holder.add(obj)
  holder.updateMatrixWorld(true)
}

/** Adds a raw (player-space) cosmetic to the player so its biped parts follow the player's bones. */
function attach(player: Player, scene: Group, object: Object3D, entry: LunarEntry) {
  const bone = (name: string) => player.skel.bones.get(name)!
  scene.add(object)
  if (entry.kind === 'obj') {
    const box = new Box3().setFromObject(object)
    const body = entry.item.category === 'bodywear'
    // Hats drawn entirely above the head center sit on top of the head.
    const lift = !body && entry.item.category === 'hat' && box.min.y > -0.05 ? HEAD_TOP - box.min.y : 0
    object.position.y = (body ? CHEST_CENTER : HEAD_CENTER) + lift
    scene.updateMatrixWorld(true)
    socket(bone(body ? 'low_body' : 'head'), object)
    return
  }
  scene.updateMatrixWorld(true)
  const matches: [Object3D, string][] = []
  object.traverse((o) => {
    const m = /^biped(Head|Body|RightArm|LeftArm|RightLeg|LeftLeg)/.exec(o.name)
    if (!m) return
    let target = BIPED[m[1]!]!
    // Some models mirror their left/right pivots; follow the limb on the same side.
    const other = OTHER_SIDE[target]
    if (other) {
      const x = o.getWorldPosition(_a).x
      if (Math.abs(x) > 0.01 && Math.sign(x) !== Math.sign(bone(target).getWorldPosition(_b).x)) target = other
    }
    matches.push([o, target])
  })
  for (const [o, target] of matches) socket(bone(target), o)
}

export async function dressPlayer(
  entries: LunarEntry[],
  emote: EmoteDef | undefined,
  data: EmotesJson | undefined,
  hashOf: HashOf,
  loadRaw: (e: LunarEntry) => Promise<LoadedModel>,
): Promise<LoadedModel> {
  const [player, models, found] = await Promise.all([
    newPlayer(hashOf),
    Promise.all(entries.map((e) => loadRaw(e).catch((err) => (console.warn(e.item.name, err), undefined)))),
    emote && data ? findAction('emote_' + emote.name, data, hashOf) : undefined,
  ])
  const scene = new Group()
  scene.add(player.object)
  player.pose(undefined, 0)
  models.forEach((m, i) => m && attach(player, scene, m.object, entries[i]!))
  // A fixed frame (not fitObject) so the player keeps its size as items change (room above for hats),
  // turned to face the camera (models face +z, the camera looks from -z).
  const object = new Group()
  object.add(scene)
  scene.scale.setScalar(0.68)
  scene.position.y = -0.78
  scene.rotation.y = Math.PI
  const action = found?.action
  const ticks = emote ? Math.max(emote.duration, action?.length ?? 0) || 1 : 0
  const effects = emote ? await emoteEffects(emote, hashOf, player, ticks) : undefined
  if (effects) player.object.add(effects.object)
  const anim = emote
    ? emoteTimeline(ticks, !!emote.looping, (t) => {
        player.pose(action, t)
        if (effects) {
          player.object.updateMatrixWorld(true)
          effects.update(t)
        }
      })
    : undefined
  const loaded = models.filter((m): m is LoadedModel => !!m)
  const single = loaded.length === 1 ? loaded[0] : undefined
  const files: DownloadFile[] = loaded.flatMap((m) => m.files)
  return {
    object,
    files,
    frames: 1,
    // A single cosmetic keeps its own animation states (e.g. wings: elytra).
    states: single?.states ?? [],
    get state() {
      return single?.state ?? ''
    },
    setState: (s) => single?.setState(s),
    timeline: anim?.timeline,
    tick(ms) {
      anim?.tick(ms)
      for (const m of loaded) m.tick(ms)
    },
    dispose() {
      for (const m of loaded) m.dispose()
      effects?.dispose()
      player.dispose()
    },
  }
}
