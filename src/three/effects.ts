// Particle effects cued by Bedrock animations (`particle_effects` timelines), as Essential cosmetics use them:
// at a cue's time the named effect starts at a geometry locator and then runs its own emitter lifetime.
import { Group, Matrix4, type Object3D, type Texture } from 'three'
import type { FnLib } from './animation/molang'
import { Emitter, type Scheme } from './particles'

export interface ParticleCue {
  /** Animation the cue belongs to (each animation loops on its own length). */
  anim: string
  length: number
  /** Seconds into the animation. */
  time: number
  effect: string
  locator?: string
}

interface CueFile {
  animations?: Record<string, { animation_length?: number; particle_effects?: Record<string, unknown> }>
}

/** The particle cues of these animations (all of them when `names` is empty). */
export function particleCues(file: CueFile, names: string[] = []): ParticleCue[] {
  const out: ParticleCue[] = []
  for (const [anim, a] of Object.entries(file.animations ?? {})) {
    if (names.length && !names.includes(anim)) continue
    const effects = a.particle_effects ?? {}
    const times = Object.keys(effects).map(Number).filter((t) => !Number.isNaN(t))
    const length = a.animation_length || Math.max(1, ...times.map((t) => t + 0.05))
    for (const [t, v] of Object.entries(effects)) {
      const time = Number(t)
      if (Number.isNaN(time)) continue
      for (const e of Array.isArray(v) ? v : [v]) {
        const cue = e as { effect?: unknown; locator?: unknown }
        if (typeof cue?.effect === 'string') out.push({ anim, length, time, effect: cue.effect, locator: typeof cue.locator === 'string' ? cue.locator : undefined })
      }
    }
  }
  return out
}

export interface LoadedEffect {
  scheme: Scheme
  texture?: Texture
  /** The texture belongs to the model (not disposed with the effects). */
  shared?: boolean
}

/**
 * Runs the cued effects of a model. `space` is the object the particles are drawn in (they are its children);
 * emitters follow their locator (or `space` itself without one).
 */
export class EffectPlayer {
  readonly object = new Group()
  private emitters: { cue: ParticleCue; e: Emitter }[] = []
  private last = -1
  private textures = new Set<Texture>()

  constructor(cues: ParticleCue[], effects: Map<string, LoadedEffect>, locators: Map<string, Object3D>, space: Object3D, lib: FnLib = new Map()) {
    const inv = new Matrix4()
    for (const cue of cues) {
      const fx = effects.get(cue.effect)
      if (!fx) continue
      const at = (cue.locator && locators.get(cue.locator)) || undefined
      const out = new Matrix4()
      const e = new Emitter(fx.scheme, lib, fx.texture, () => {
        // Emitter transform in the particle group's space (the group is a child of `space`).
        inv.copy(space.matrixWorld).invert()
        return at ? out.copy(inv).multiply(at.matrixWorld) : out.identity()
      })
      if (fx.texture && !fx.shared) this.textures.add(fx.texture)
      this.object.add(e.object)
      this.emitters.push({ cue, e })
    }
  }

  get count() {
    return this.emitters.length
  }

  /** Advances to `ms`; cues whose time was passed since the last tick (per looping animation) restart their effect. */
  tick(ms: number) {
    const s = ms / 1000
    const prev = this.last
    this.last = s
    const dt = prev < 0 ? 0 : s - prev
    // A jump (seek, a long pause) restarts cleanly instead of simulating the gap.
    if (prev >= 0 && (dt < 0 || dt > 0.5)) {
      for (const x of this.emitters) x.e.reset()
      return
    }
    for (const x of this.emitters) {
      const len = x.cue.length
      const a = prev < 0 ? -1e-6 : prev % len
      const b = s % len
      const passed = prev < 0 ? x.cue.time <= b : b >= a ? x.cue.time > a && x.cue.time <= b : x.cue.time > a || x.cue.time <= b
      // Restart the emitter's own lifetime; particles already in the air live on.
      if (passed) {
        x.e.setEnabled(false)
        x.e.setEnabled(true)
      }
      x.e.step(dt)
    }
  }

  dispose() {
    for (const x of this.emitters) x.e.dispose()
    for (const t of this.textures) t.dispose()
  }
}
