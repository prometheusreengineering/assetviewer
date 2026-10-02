import { getFileBuffer, getFileJson, getFileText } from '../../cdn'
import { actionNames, extractAction, parseBobj, type BobjAction, type BobjFile, type BobjMesh } from '../../three/bobj'
import { fitObject } from '../../three/fit'
import { createTexture } from '../../three/geoModel'
import { Emitter, type Scheme } from '../../three/particles'
import type { FnLib } from '../../three/animation/molang'
import { Euler, Group, Matrix4, Quaternion, Vector3, type Texture } from 'three'
import { createPlayer, type Player } from '../../three/player'
import { skinBitmap } from '../../skin'
import type { DownloadFile, LoadedModel, Timeline } from '../types'
import type { EmoteDef, EmotesJson } from './catalog'

export const BODY = 'emotes/models/entity/default.bobj'
/** Body config; also declares textures of some props (e.g. popcorn) that emotes.json lacks. */
const BODY_JSON = 'emotes/models/entity/default.json'
const TICK_MS = 50
/** Non-looping emotes hold their last pose this long before restarting. */
const HOLD_TICKS = 20

type HashOf = (rel: string) => string
const strip = (p: string) => p.replace(/^lunar:/, '')

const parsed = new Map<string, Promise<BobjFile>>()
/** Small .bobj files (body, props) are parsed whole and kept. */
function parsedFile(rel: string, hashOf: HashOf): Promise<BobjFile> {
  let p = parsed.get(rel)
  if (!p) {
    p = getFileText(hashOf(rel)).then(parseBobj)
    p.catch(() => parsed.delete(rel))
    parsed.set(rel, p)
  }
  return p
}

export function playerBody(hashOf: HashOf): Promise<BobjFile> {
  return parsedFile(BODY, hashOf)
}

export async function newPlayer(hashOf: HashOf): Promise<Player> {
  const [body, skin] = await Promise.all([playerBody(hashOf), skinBitmap()])
  return createPlayer(body, skin)
}

// Actions live in several files (one is 16 MB); each is scanned once for its action names and
// only the needed block is parsed. Bytes come from the hash cache, so re-reads are cheap.
const home = new Map<string, string>()
const scanned = new Set<string>()
const actions = new Map<string, Promise<{ action: BobjAction; text: string; file: string } | undefined>>()

export function findAction(name: string, data: EmotesJson, hashOf: HashOf) {
  let p = actions.get(name)
  if (!p) {
    p = (async () => {
      for (const f of [home.get(name), ...data.actions.map(strip)]) {
        if (!f || (scanned.has(f) && home.get(name) !== f)) continue
        const text = await getFileText(hashOf(f))
        if (!scanned.has(f)) {
          scanned.add(f)
          for (const n of actionNames(text)) if (!home.has(n)) home.set(n, f)
        }
        if (home.get(name) !== f) continue
        const block = extractAction(text, name)
        if (!block) return undefined
        return { action: parseBobj(block).actions.get(name)!, text: block, file: f }
      }
      return undefined
    })()
    actions.set(name, p)
  }
  return p
}

async function findProp(name: string, data: EmotesJson, hashOf: HashOf): Promise<{ mesh: BobjMesh; file: string } | undefined> {
  // props.bobj (popcorn, armor) is used by emotes but missing from emotes.json's list.
  for (const f of [...data.props.map(strip), 'emotes/models/props.bobj']) {
    let file: BobjFile
    try {
      file = await parsedFile(f, hashOf)
    } catch {
      continue
    }
    const mesh = file.meshes.get(name)
    if (mesh) return { mesh, file: f }
  }
  return undefined
}

const bitmaps = new Map<string, Promise<ImageBitmap>>()
function bitmapOf(rel: string, hashOf: HashOf) {
  let p = bitmaps.get(rel)
  if (!p) {
    p = getFileBuffer(hashOf(rel)).then((b) => createImageBitmap(new Blob([b])))
    bitmaps.set(rel, p)
  }
  return p
}

/** Plays an emote looping (or hold-and-restart) and exposes its timeline. */
export function emoteTimeline(durationTicks: number, looping: boolean, apply: (tick: number) => void) {
  let start = -1
  let last = 0
  let paused = false
  let current = 0
  const timeline: Timeline = {
    duration: durationTicks / 20,
    get time() {
      return current / 20
    },
    get paused() {
      return paused
    },
    set paused(v) {
      if (v === paused) return
      paused = v
      // Resume from where it stopped.
      if (!v) start = last - current * TICK_MS
    },
    seek(s) {
      current = Math.min(Math.max(s * 20, 0), durationTicks)
      start = last - current * TICK_MS
      apply(current)
    },
  }
  const tick = (ms: number) => {
    last = ms
    if (start < 0) start = ms
    if (!paused) {
      const t = (ms - start) / TICK_MS
      current = looping ? t % durationTicks : Math.min(t % (durationTicks + HOLD_TICKS), durationTicks)
    }
    apply(current)
  }
  return { timeline, tick }
}

/** Everything an emote is made of: action block, props (+ textures), and the source files for download. */
export async function emoteSources(em: EmoteDef, data: EmotesJson, hashOf: HashOf) {
  const [found, bodyBuf] = await Promise.all([findAction('emote_' + em.name, data, hashOf), getFileBuffer(hashOf(BODY))])
  const files: DownloadFile[] = [{ name: 'default.bobj', data: new Uint8Array(bodyBuf) }]
  if (found) files.push({ name: `${em.name}.bobj`, data: new TextEncoder().encode(found.text) })
  const props: { mesh: BobjMesh; texRel?: string; showAt: number }[] = []
  const bodyMeshes = em.meshes?.length ? ((await getFileJson<{ meshes?: EmotesJson['meshes'] }>(hashOf(BODY_JSON)).catch(() => ({}))) as { meshes?: EmotesJson['meshes'] }).meshes ?? {} : {}
  const addFile = async (rel: string) => {
    const name = rel.split('/').pop()!
    if (!files.some((f) => f.name === name)) files.push({ name, data: new Uint8Array(await getFileBuffer(hashOf(rel))) })
  }
  for (const m of em.meshes ?? []) {
    const prop = await findProp(m.name, data, hashOf)
    if (!prop) continue
    const texture = data.meshes[m.name]?.texture ?? bodyMeshes[m.name]?.texture
    const texRel = texture && texture.startsWith('lunar:') ? strip(texture) : undefined
    props.push({ mesh: prop.mesh, texRel, showAt: m.show_at })
    await addFile(prop.file)
    if (texRel) await addFile(texRel)
  }
  return { found, files, props }
}

interface MorphEntry {
  morph: string
  bone?: string
  start?: number
  length?: number
  translate?: number[]
  rotation?: number[]
  scale?: number[]
}

const NO_LIB: FnLib = new Map()
let particleCfg: Promise<Record<string, { morphs?: MorphEntry[] }>> | undefined
const schemes = new Map<string, Promise<Scheme | undefined>>()
const loadScheme = (name: string, hashOf: HashOf) => {
  let p = schemes.get(name)
  if (!p) {
    p = getFileJson<Scheme>(hashOf(`particles/schemes/${name}.particle.json`)).catch(() => undefined)
    schemes.set(name, p)
  }
  return p
}

/** Textures of the vanilla particle atlas (and blocks/items) aren't on the CDN: the atlas has a Lunar copy, the rest is a plain tint. */
async function particleTexture(ref: string, hashOf: HashOf): Promise<Texture | undefined> {
  const rel = ref.startsWith('lunar:') ? strip(ref) : ref === 'textures/particle/particles' ? 'particles/textures/default_particles.webp' : ''
  try {
    return createTexture(rel ? await bitmapOf(rel, hashOf) : await solidBitmap())
  } catch {
    return undefined
  }
}
const solidBitmap = () => {
  const c = new OffscreenCanvas(4, 4)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 4, 4)
  return createImageBitmap(c)
}

export interface Effects {
  object: Group
  /** Advance to the emote's `tick` (ticks, 20/s); jumps and loops reset the particles. */
  update(tick: number): void
  dispose(): void
}

/** Particle effects of an emote: its `morph` entries from particles/configuration.json (scheme + bone + start/length), or `particleEffect`. */
export async function emoteEffects(em: EmoteDef, hashOf: HashOf, player: Player, durationTicks: number): Promise<Effects | undefined> {
  const entries: { scheme: string; bone: string; start: number; end: number; local: Matrix4 }[] = []
  const toLocal = (m: MorphEntry) => {
    const t = m.translate ?? [0, 0, 0]
    const r = m.rotation ?? [0, 0, 0]
    const sc = m.scale ?? [1, 1, 1]
    const q = new Quaternion().setFromEuler(new Euler((r[0]! * Math.PI) / 180, (r[1]! * Math.PI) / 180, (r[2]! * Math.PI) / 180, 'ZYX'))
    return new Matrix4().compose(new Vector3(t[0], t[1], t[2]), q, new Vector3(sc[0], sc[1], sc[2]))
  }
  try {
    if (em.morph) {
      particleCfg ??= getFileJson(hashOf('particles/configuration.json'))
      for (const m of (await particleCfg)[em.morph]?.morphs ?? []) {
        const scheme = /Scheme:"([^"]+)"/.exec(m.morph)?.[1]
        if (!scheme) continue
        entries.push({ scheme, bone: m.bone ?? 'anchor', start: m.start ?? 0, end: (m.start ?? 0) + (m.length ?? durationTicks), local: toLocal(m) })
      }
    }
    if (em.particleEffect) entries.push({ scheme: em.particleEffect, bone: '', start: 0, end: durationTicks, local: new Matrix4() })
  } catch (e) {
    console.warn('particle config', e)
  }
  if (!entries.length) return undefined
  const object = new Group()
  const inv = new Matrix4()
  const emitters: { e: Emitter; start: number; end: number }[] = []
  for (const en of entries) {
    const scheme = await loadScheme(en.scheme, hashOf)
    if (!scheme) continue
    const render = scheme.particle_effect.description.basic_render_parameters
    const boneName = en.bone || render.bone || 'anchor'
    const bone = player.skel.bones.get(boneName)
    if (!bone) continue
    const tex = await particleTexture(render.texture, hashOf)
    const out = new Matrix4()
    // Emitter transform in the player's own space (the particle group is a child of player.object).
    const e = new Emitter(scheme, NO_LIB, tex, () => {
      inv.copy(player.object.matrixWorld).invert()
      return out.copy(inv).multiply(bone.matrixWorld).multiply(en.local)
    })
    object.add(e.object)
    emitters.push({ e, start: en.start, end: en.end })
  }
  if (!emitters.length) return undefined
  let last = -1
  return {
    object,
    update(tick) {
      const dt = (tick - last) / 20
      if (last < 0 || dt < 0 || dt > 0.5) for (const x of emitters) x.e.reset()
      const step = last < 0 || dt < 0 || dt > 0.5 ? 0 : dt
      last = tick
      for (const x of emitters) {
        x.e.setEnabled(tick >= x.start && tick < x.end)
        x.e.step(step)
      }
    },
    dispose: () => emitters.forEach((x) => x.e.dispose()),
  }
}

export async function loadEmote(em: EmoteDef, data: EmotesJson, hashOf: HashOf): Promise<LoadedModel> {
  const [player, { found, files, props: parts }] = await Promise.all([newPlayer(hashOf), emoteSources(em, data, hashOf)])
  const props: { mesh: { visible: boolean }; showAt: number }[] = []
  for (const p of parts) {
    const tex = p.texRel ? await bitmapOf(p.texRel, hashOf) : await skinBitmap()
    props.push({ mesh: player.addMesh(p.mesh, tex), showAt: p.showAt })
  }
  const action = found?.action
  const duration = Math.max(em.duration, action?.length ?? 0) || 1
  const effects = await emoteEffects(em, hashOf, player, duration)
  if (effects) player.object.add(effects.object)
  const apply = (tick: number) => {
    player.pose(action, tick)
    for (const p of props) p.mesh.visible = tick >= p.showAt
    if (effects) {
      player.object.updateMatrixWorld(true)
      effects.update(tick)
    }
  }
  apply(0)
  // The player faces +z; the camera looks from -z.
  player.object.rotation.y = Math.PI
  const object = fitObject(player.object)
  const { timeline, tick } = emoteTimeline(duration, !!em.looping, apply)
  return {
    object,
    files,
    frames: 1,
    states: [],
    state: '',
    setState() {},
    timeline,
    tick,
    dispose() {
      effects?.dispose()
      player.dispose()
    },
  }
}
