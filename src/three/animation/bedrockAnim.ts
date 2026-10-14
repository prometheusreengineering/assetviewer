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
  /** Time of the last keyframe (s). */
  end?: number
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

/** GeckoLib easings: applied to the segment that ends at the keyframe carrying them. */
export const EASINGS: Record<string, (t: number, arg?: number) => number> = {
  linear: (t) => t,
  step: (t, steps = 2) => Math.floor(t * Math.max(1, steps)) / Math.max(1, steps),
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
}

/** Catmull-Rom spline through p1..p2 with neighbours p0, p3 (Bedrock's `lerp_mode: catmullrom`). */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

interface Frame {
  t: number
  /** Value arriving at the keyframe and leaving it (they differ for a jump). */
  pre: Vec3
  post: Vec3
  ease?: (t: number) => number
  smooth: boolean
}

function compileChannel(ch: Channel | undefined, lib: FnLib): Track | undefined {
  if (ch === undefined) return undefined
  if (typeof ch === 'number' || typeof ch === 'string' || Array.isArray(ch)) return { eval: compileVec(ch, lib) }
  if ('vector' in ch && ch.vector !== undefined) return { eval: compileVec(ch.vector as Vec, lib) }

  // Keyframes: { "0.0": [..], "0.5": { pre: [..], post: [..] }, "1.0": { vector: [..], easing: "easeInSine" }, ... }
  const frames: Frame[] = Object.entries(ch as Record<string, Vec | Keyframe>)
    .filter(([k]) => !Number.isNaN(Number(k)))
    .map(([k, val]) => {
      if (Array.isArray(val) || typeof val !== 'object') {
        const v = compileVec(val as Vec, lib)
        return { t: Number(k), pre: v, post: v, smooth: false }
      }
      const kf = val as Keyframe
      const post = compileVec((kf.post ?? kf.vector ?? kf.pre ?? 0) as Vec, lib)
      const pre = kf.pre !== undefined ? compileVec(kf.pre, lib) : post
      const fn = typeof kf.easing === 'string' ? EASINGS[kf.easing] : undefined
      const arg = Array.isArray(kf.easingArgs) ? Number(kf.easingArgs[0]) : undefined
      return { t: Number(k), pre, post, ease: fn && ((x: number) => fn(x, arg)), smooth: kf.lerp_mode === 'catmullrom' }
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
      if (t < a.t) return a.pre(s)
      if (!b) return a.post(s)
      let k = (t - a.t) / (b.t - a.t)
      const va = a.post(s)
      const vb = b.pre(s)
      if (a.smooth || b.smooth) {
        const v0 = (frames[i - 1] ?? a).post(s)
        const v3 = (frames[i + 2] ?? b).pre(s)
        return [0, 1, 2].map((j) => catmullRom(v0[j]!, va[j]!, vb[j]!, v3[j]!, k)) as [number, number, number]
      }
      if (b.ease) k = b.ease(k)
      return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k]
    },
    end: frames[frames.length - 1]!.t,
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
      // Without animation_length the animation ends at its last keyframe; "hold_on_last_frame" doesn't loop.
      const end = Math.max(0, ...[...cb.values()].flatMap((b) => [b.rotation?.end ?? 0, b.position?.end ?? 0, b.scale?.end ?? 0]))
      this.anims.set(name, { length: a.animation_length ?? end, loop: a.loop !== false && a.loop !== 'false' && a.loop !== 'hold_on_last_frame', bones: cb })
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
