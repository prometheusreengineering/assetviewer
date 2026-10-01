import type { Bone } from '../geoModel'
import { rotationOf } from '../geoModel'
import { compile, newScope, type Compiled, type FnLib, type Scope } from './molang'

type Raw = number | string
type Vec = Raw | Raw[]
interface Keyframe {
  vector?: Vec
  pre?: Vec
  post?: Vec
  [k: string]: unknown
}
type Channel = Vec | { vector: Vec } | Record<string, Vec | Keyframe>
interface AnimBone {
  rotation?: Channel
  position?: Channel
  scale?: Channel
}
interface Animation {
  loop?: boolean | string
  animation_length?: number
  bones?: Record<string, AnimBone>
}
export interface AnimFile {
  animations: Record<string, Animation>
}

type Vec3 = (s: Scope) => [number, number, number]

interface Track {
  /** Evaluates to a vec3 at the current scope. */
  eval: Vec3
}

function compileComponent(c: Raw | undefined, lib: FnLib): Compiled {
  if (typeof c === 'number') return () => c
  if (typeof c === 'string') {
    const n = Number(c)
    if (c.trim() !== '' && !Number.isNaN(n)) return () => n
    return compile(c, lib)
  }
  return () => 0
}

function compileVec(v: Vec, lib: FnLib): Vec3 {
  if (Array.isArray(v)) {
    const [x, y, z] = [compileComponent(v[0], lib), compileComponent(v[1], lib), compileComponent(v[2], lib)]
    return (s) => [x(s), y(s), z(s)]
  }
  // A lone value applies to all three axes (used by scale).
  const c = compileComponent(v, lib)
  return (s) => {
    const n = c(s)
    return [n, n, n]
  }
}

function compileChannel(ch: Channel | undefined, lib: FnLib): Track | undefined {
  if (ch === undefined) return undefined
  if (typeof ch === 'number' || typeof ch === 'string' || Array.isArray(ch)) return { eval: compileVec(ch, lib) }
  if ('vector' in ch && ch.vector !== undefined) return { eval: compileVec(ch.vector as Vec, lib) }

  // Keyframes: { "0.0": [..], "0.5": { post: [..] }, "1.0": { vector: [..] }, ... }
  const frames = Object.entries(ch as Record<string, Vec | Keyframe>)
    .filter(([k]) => !Number.isNaN(Number(k)))
    .map(([k, val]) => {
      const kf = val as Keyframe
      const v = Array.isArray(val) || typeof val !== 'object' ? (val as Vec) : ((kf.vector ?? kf.post ?? kf.pre ?? 0) as Vec)
      return { t: Number(k), v: compileVec(v, lib) }
    })
    .sort((a, b) => a.t - b.t)
  if (!frames.length) return undefined
  return {
    eval(s) {
      const t = s.q.anim_time ?? 0
      let i = 0
      while (i < frames.length - 1 && frames[i + 1]!.t <= t) i++
      const a = frames[i]!
      const b = frames[i + 1]
      if (!b || t <= a.t) return a.v(s)
      const k = (t - a.t) / (b.t - a.t)
      const va = a.v(s)
      const vb = b.v(s)
      return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k]
    },
  }
}

interface CompiledBone {
  rotation?: Track
  position?: Track
  scale?: Track
}
interface CompiledAnim {
  length: number
  loop: boolean
  bones: Map<string, CompiledBone>
}

/** Plays Bedrock `.anim.json` animations onto bone groups built by buildGeoRig. */
export class AnimationPlayer {
  readonly states: string[]
  state: string
  private anims = new Map<string, CompiledAnim>()
  private scope = newScope()
  private startMs = 0
  private lastMs = 0

  private bones: Map<string, Bone>

  constructor(bones: Map<string, Bone>, file: AnimFile, lib: FnLib, preferred = ['idle']) {
    this.bones = bones
    for (const [name, a] of Object.entries(file.animations ?? {})) {
      const cb = new Map<string, CompiledBone>()
      for (const [bn, ab] of Object.entries(a.bones ?? {})) {
        cb.set(bn, {
          rotation: compileChannel(ab.rotation, lib),
          position: compileChannel(ab.position, lib),
          scale: compileChannel(ab.scale, lib),
        })
      }
      this.anims.set(name, { length: a.animation_length ?? 0, loop: a.loop !== false, bones: cb })
    }
    this.states = [...this.anims.keys()]
    this.state = preferred.find((p) => this.anims.has(p)) ?? this.states.find((s) => s !== 'gui') ?? this.states[0] ?? ''
  }

  setState(state: string) {
    if (this.anims.has(state)) {
      this.state = state
      this.startMs = this.lastMs
    }
  }

  tick(ms: number) {
    this.lastMs = ms
    const anim = this.anims.get(this.state)
    if (!anim) return
    const t = (ms - this.startMs) / 1000
    const s = this.scope
    s.q.life_time = ms / 1000
    s.q.anim_time = anim.length > 0 ? (anim.loop ? t % anim.length : Math.min(t, anim.length)) : t
    s.q.delta_time = 1 / 60
    for (const [name, bone] of this.bones) {
      const ab = anim.bones.get(name)
      const g = bone.group
      if (!ab) {
        g.rotation.copy(rotationOf(bone.baseRot))
        g.position.set(...bone.basePos)
        g.scale.set(1, 1, 1)
        continue
      }
      const r = ab.rotation?.eval(s) ?? [0, 0, 0]
      g.rotation.copy(rotationOf([bone.baseRot[0] + r[0], bone.baseRot[1] + r[1], bone.baseRot[2] + r[2]]))
      const p = ab.position?.eval(s) ?? [0, 0, 0]
      g.position.set(bone.basePos[0] + p[0], bone.basePos[1] + p[1], bone.basePos[2] + p[2])
      const sc = ab.scale?.eval(s)
      if (sc) g.scale.set(sc[0], sc[1], sc[2])
      else g.scale.set(1, 1, 1)
    }
  }
}
