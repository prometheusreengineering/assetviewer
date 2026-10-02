// Bedrock-style particle effects (Lunar's `particles/schemes/*.particle.json`) drawn as camera-facing quads.
// Supports the parts the Lunar schemes use: steady/instant emitters, point/disc/sphere/box shapes, dynamic and
// parametric motion, billboard UVs (static and flipbook), tinting (colors and gradients), curves and Molang.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three'
import { compile, newScope, type Compiled, type FnLib, type Scope } from './animation/molang'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Scheme {
  particle_effect: {
    description: { identifier?: string; basic_render_parameters: { texture: string; material?: string; bone?: string } }
    curves?: Record<string, any>
    components: Record<string, any>
  }
}

const MAX_CAPACITY = 600
const STEP = 1 / 30

export const num = (e: unknown, lib: FnLib, d = 0): Compiled =>
  typeof e === 'number' ? () => e : typeof e === 'string' && e.trim() !== '' ? compile(e, lib) : typeof e === 'boolean' ? () => (e ? 1 : 0) : () => d
type Vec = (s: Scope) => number[]
export const vec = (e: unknown, lib: FnLib, n: number, d: number[]): Vec => {
  if (!Array.isArray(e)) {
    const one = e === undefined ? undefined : num(e, lib)
    return one ? (s) => Array(n).fill(one(s)) : () => d
  }
  const cs = Array.from({ length: n }, (_, i) => num(e[i], lib, d[i] ?? 0))
  return (s) => cs.map((c) => c(s))
}

export interface Curve {
  name: string
  type: string
  nodes: number[]
  input: Compiled
  range: Compiled
}

export function curveValue(c: Curve, s: Scope): number {
  const n = c.nodes
  if (!n.length) return 0
  const r = c.range(s) || 1
  const t = Math.min(Math.max(c.input(s) / r, 0), 1)
  if (c.type === 'catmull_rom' && n.length >= 4) {
    // The first and last nodes are only control points; the curve runs through the rest.
    const seg = n.length - 3
    const x = t * seg
    const i = Math.min(Math.floor(x), seg - 1)
    const u = x - i
    const [p0, p1, p2, p3] = [n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!]
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  }
  // linear: nodes evenly spaced over [0, 1]
  const x = t * (n.length - 1)
  const i = Math.min(Math.floor(x), n.length - 2)
  return i < 0 ? n[0]! : n[i]! + (n[i + 1]! - n[i]!) * (x - i)
}

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  rot: number
  rotRate: number
  r: [number, number, number, number]
  ox: number
  oy: number
  oz: number
}

const _v = new Vector3()
const _c = new Color()
const rnd = () => Math.random()

export function hex(s: string): [number, number, number, number] {
  const h = s.replace('#', '')
  const a = h.length === 8 ? parseInt(h.slice(0, 2), 16) / 255 : 1
  _c.set('#' + h.slice(-6))
  return [_c.r, _c.g, _c.b, a]
}

const VERT = `
attribute vec2 aCorner; attribute vec3 aCenter; attribute vec2 aSize; attribute float aRot; attribute vec2 aUv; attribute vec4 aColor;
varying vec2 vUv; varying vec4 vColor;
void main() {
  float c = cos(aRot), s = sin(aRot);
  vec2 o = aCorner * aSize;
  o = vec2(c * o.x - s * o.y, s * o.x + c * o.y);
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  // Quad size is in blocks: scale the view-space offset by the object's scale.
  mv.xy += o * length(modelViewMatrix[0].xyz);
  vUv = aUv; vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`
const FRAG = `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = t * vColor;
  if (gl_FragColor.a < 0.02) discard;
  #include <colorspace_fragment>
}`

export class Emitter {
  readonly object: Mesh
  private curves: Curve[] = []
  private scope = newScope()
  private parts: Particle[] = []
  private age = 0
  private acc = 0
  private lastCycle = -1
  private wasActive = false
  private on = false
  private geo = new BufferGeometry()
  private cap: number
  private a: Record<string, BufferAttribute> = {}

  // compiled pieces
  private rate: Compiled
  private maxParts: Compiled
  private count: Compiled
  private lifetime: Compiled
  private expire?: Compiled
  private speed: Compiled
  private spin: Compiled
  private spinRate: Compiled
  private accel: Vec
  private drag: Compiled
  private rotAccel: Compiled
  private rotDrag: Compiled
  private rel?: Vec
  private size: Vec
  private uv: Vec
  private uvSize: Vec
  private texW: number
  private texH: number
  private flip?: { base: Vec; size: Vec; step: Vec; fps: Compiled; max: Compiled; stretch: boolean; loop: boolean }
  private tint: (s: Scope) => [number, number, number, number]
  private offset: Vec
  private radius: Compiled
  private half: Vec
  private normal: Vec
  private dirExpr: Vec | undefined
  private dirMode: 'vec' | 'out' | 'in' | 'random' = 'random'
  private surface = false
  private shape: 'point' | 'disc' | 'sphere' | 'box' = 'point'
  private active: (age: number, s: Scope) => { active: boolean; cycle: number; length: number }
  private local: boolean
  private perUpdate?: Compiled

  private texture: Texture | undefined
  private matrix: () => Matrix4

  constructor(scheme: Scheme, lib: FnLib, texture: Texture | undefined, matrix: () => Matrix4) {
    this.texture = texture
    this.matrix = matrix
    const e = scheme.particle_effect
    const c = e.components
    this.object = new Mesh(this.geo)
    for (const [k, v] of Object.entries(e.curves ?? {})) {
      this.curves.push({ name: k.replace(/^variable\./, '').replace(/^v\./, ''), type: v.type ?? 'linear', nodes: Array.isArray(v.nodes) ? v.nodes : [], input: num(v.input, lib), range: num(v.horizontal_range, lib, 1) })
    }
    this.local = !!c['minecraft:emitter_local_space']?.position
    this.rate = num(c['minecraft:emitter_rate_steady']?.spawn_rate, lib)
    this.maxParts = num(c['minecraft:emitter_rate_steady']?.max_particles ?? 100, lib, 100)
    this.count = num(c['minecraft:emitter_rate_instant']?.num_particles ?? 10, lib, 10)
    const steady = !!c['minecraft:emitter_rate_steady']
    this.steady = steady
    this.cap = Math.min(MAX_CAPACITY, Math.max(8, Math.round(this.maxParts(this.scope)) || 100))
    this.lifetime = num(c['minecraft:particle_lifetime_expression']?.max_lifetime, lib, 1)
    this.expire = c['minecraft:particle_lifetime_expression']?.expiration_expression ? num(c['minecraft:particle_lifetime_expression'].expiration_expression, lib) : undefined
    const sp = c['minecraft:particle_initial_speed']
    this.speed = num(typeof sp === 'object' && !Array.isArray(sp) ? 0 : sp, lib)
    this.spin = num(c['minecraft:particle_initial_spin']?.rotation, lib)
    this.spinRate = num(c['minecraft:particle_initial_spin']?.rotation_rate, lib)
    const md = c['minecraft:particle_motion_dynamic'] ?? {}
    this.accel = vec(md.linear_acceleration, lib, 3, [0, 0, 0])
    this.drag = num(md.linear_drag_coefficient, lib)
    this.rotAccel = num(md.rotation_acceleration, lib)
    this.rotDrag = num(md.rotation_drag_coefficient, lib)
    const mp = c['minecraft:particle_motion_parametric']
    if (mp) this.rel = vec(mp.relative_position, lib, 3, [0, 0, 0])

    const b = c['minecraft:particle_appearance_billboard'] ?? {}
    this.size = vec(b.size, lib, 2, [0.1, 0.1])
    const uv = b.uv ?? {}
    this.texW = Number(uv.texture_width) || 16
    this.texH = Number(uv.texture_height) || 16
    this.uv = vec(uv.uv, lib, 2, [0, 0])
    this.uvSize = vec(uv.uv_size, lib, 2, [this.texW, this.texH])
    if (uv.flipbook) {
      const f = uv.flipbook
      this.flip = { base: vec(f.base_UV, lib, 2, [0, 0]), size: vec(f.size_UV, lib, 2, [this.texW, this.texH]), step: vec(f.step_UV, lib, 2, [0, 0]), fps: num(f.frames_per_second, lib, 8), max: num(f.max_frame, lib, 1), stretch: !!f.stretch_to_lifetime, loop: !!f.loop }
    }

    const t = c['minecraft:particle_appearance_tinting']?.color
    if (Array.isArray(t)) {
      const cs = [0, 1, 2, 3].map((i) => num(t[i], lib, 1))
      this.tint = (s) => [cs[0]!(s), cs[1]!(s), cs[2]!(s), cs[3]!(s)]
    } else if (t && typeof t === 'object' && t.gradient) {
      const inter = num(t.interpolant, lib)
      const stops = Object.entries(t.gradient as Record<string, string>).map(([k, v]) => ({ at: Number(k), c: hex(v) })).sort((x, y) => x.at - y.at)
      this.tint = (s) => {
        const x = inter(s)
        if (x <= stops[0]!.at) return stops[0]!.c
        for (let i = 1; i < stops.length; i++) {
          if (x <= stops[i]!.at) {
            const a = stops[i - 1]!
            const bb = stops[i]!
            const k = (x - a.at) / (bb.at - a.at || 1)
            return [0, 1, 2, 3].map((j) => a.c[j]! + (bb.c[j]! - a.c[j]!) * k) as [number, number, number, number]
          }
        }
        return stops[stops.length - 1]!.c
      }
    } else this.tint = () => [1, 1, 1, 1]

    // shape
    const sh = c['minecraft:emitter_shape_point'] ?? c['minecraft:emitter_shape_disc'] ?? c['minecraft:emitter_shape_sphere'] ?? c['minecraft:emitter_shape_box'] ?? {}
    this.shape = c['minecraft:emitter_shape_disc'] ? 'disc' : c['minecraft:emitter_shape_sphere'] ? 'sphere' : c['minecraft:emitter_shape_box'] ? 'box' : 'point'
    this.offset = vec(sh.offset, lib, 3, [0, 0, 0])
    this.radius = num(sh.radius, lib, 1)
    this.half = vec(sh.half_dimensions, lib, 3, [1, 1, 1])
    const pn = sh.plane_normal
    this.normal = pn === 'x' ? () => [1, 0, 0] : pn === 'z' ? () => [0, 0, 1] : Array.isArray(pn) ? vec(pn, lib, 3, [0, 1, 0]) : () => [0, 1, 0]
    this.surface = !!sh.surface_only
    if (Array.isArray(sh.direction)) {
      this.dirExpr = vec(sh.direction, lib, 3, [0, 1, 0])
      this.dirMode = 'vec'
    } else if (sh.direction === 'outwards') this.dirMode = 'out'
    else if (sh.direction === 'inwards') this.dirMode = 'in'

    // emitter lifetime
    const lo = c['minecraft:emitter_lifetime_looping']
    const once = c['minecraft:emitter_lifetime_once']
    const ex = c['minecraft:emitter_lifetime_expression']
    if (lo) {
      const a = num(lo.active_time, lib, 10)
      const sl = num(lo.sleep_time, lib, 0)
      this.active = (age, s) => {
        const at = a(s)
        const cyc = at + sl(s) || 1
        return { active: age % cyc < at, cycle: Math.floor(age / cyc), length: at }
      }
    } else if (once) {
      const a = num(once.active_time, lib, 10)
      this.active = (age, s) => ({ active: age < a(s), cycle: 0, length: a(s) })
    } else if (ex) {
      const on = num(ex.activation_expression, lib, 1)
      const off = ex.expiration_expression ? num(ex.expiration_expression, lib) : undefined
      this.active = (_, s) => ({ active: on(s) !== 0 && !(off && off(s) !== 0), cycle: 0, length: 0 })
    } else this.active = () => ({ active: true, cycle: 0, length: 0 })
    const init = c['minecraft:emitter_initialization']
    this.perUpdate = init?.per_update_expression ? compile(String(init.per_update_expression), lib) : undefined
    this.initExpr = init?.creation_expression ? compile(String(init.creation_expression), lib) : undefined

    this.buildGeometry()
    const mat = new ShaderMaterial({
      uniforms: { map: { value: texture ?? null } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.object.material = mat
    this.object.frustumCulled = false
    this.object.renderOrder = 10
    this.reset()
  }
  private steady = true
  private initExpr?: Compiled

  private buildGeometry() {
    const n = this.cap
    const idx = new Uint16Array(n * 6)
    const corner = new Float32Array(n * 8)
    for (let i = 0; i < n; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6)
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8)
    }
    this.geo.setIndex(new BufferAttribute(idx, 1))
    const add = (name: string, size: number, data?: Float32Array) => {
      const attr = new BufferAttribute(data ?? new Float32Array(n * 4 * size), size)
      if (!data) attr.setUsage(DynamicDrawUsage)
      this.geo.setAttribute(name, attr)
      this.a[name] = attr
    }
    add('aCorner', 2, corner)
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 12), 3)) // required by three, unused
    for (const [k, s] of [['aCenter', 3], ['aSize', 2], ['aRot', 1], ['aUv', 2], ['aColor', 4]] as const) add(k, s)
    this.geo.setDrawRange(0, 0)
  }

  setEnabled(on: boolean) {
    if (on && !this.on) {
      this.age = 0
      this.acc = 0
      this.lastCycle = -1
      this.wasActive = false
      this.initScope()
    }
    this.on = on
  }

  private initScope() {
    this.scope.v.emitter_age = 0
    for (let i = 1; i <= 4; i++) this.scope.v['emitter_random_' + i] = rnd()
    this.initExpr?.(this.scope)
  }

  reset() {
    this.parts = []
    this.on = false
    this.age = 0
    this.acc = 0
    this.lastCycle = -1
    this.wasActive = false
    this.initScope()
    this.geo.setDrawRange(0, 0)
  }

  private setVars(p?: Particle) {
    const v = this.scope.v
    v.emitter_age = this.age
    if (p) {
      v.particle_age = p.age
      v.particle_lifetime = p.life
      for (let i = 0; i < 4; i++) v['particle_random_' + (i + 1)] = p.r[i]!
    }
    for (const c of this.curves) v[c.name] = curveValue(c, this.scope)
  }

  private spawn(m: Matrix4) {
    const p: Particle = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, rot: 0, rotRate: 0, r: [rnd(), rnd(), rnd(), rnd()], ox: 0, oy: 0, oz: 0 }
    this.setVars(p)
    const s = this.scope
    const [ox, oy, oz] = this.offset(s) as [number, number, number]
    let px = ox
    let py = oy
    let pz = oz
    if (this.shape === 'disc') {
      const n = _v.fromArray(this.normal(s)).normalize()
      const u = new Vector3(0, 1, 0).cross(n)
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0)
      u.normalize()
      const w = n.clone().cross(u)
      const a = rnd() * Math.PI * 2
      const r = this.radius(s) * (this.surface ? 1 : Math.sqrt(rnd()))
      px += (u.x * Math.cos(a) + w.x * Math.sin(a)) * r
      py += (u.y * Math.cos(a) + w.y * Math.sin(a)) * r
      pz += (u.z * Math.cos(a) + w.z * Math.sin(a)) * r
    } else if (this.shape === 'sphere') {
      const d = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
      const r = this.radius(s) * (this.surface ? 1 : Math.cbrt(rnd()))
      px += d.x * r
      py += d.y * r
      pz += d.z * r
    } else if (this.shape === 'box') {
      const h = this.half(s)
      px += (rnd() * 2 - 1) * h[0]!
      py += (rnd() * 2 - 1) * h[1]!
      pz += (rnd() * 2 - 1) * h[2]!
    }
    const dir = new Vector3()
    if (this.dirMode === 'vec') dir.fromArray(this.dirExpr!(s))
    else if (this.dirMode === 'out' || this.dirMode === 'in') {
      dir.set(px - ox, py - oy, pz - oz)
      if (this.dirMode === 'in') dir.negate()
    } else dir.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)
    dir.normalize()
    const sp = this.speed(s)
    p.life = Math.max(0.01, this.lifetime(s))
    p.rot = this.spin(s)
    p.rotRate = this.spinRate(s)
    let vx = dir.x * sp
    let vy = dir.y * sp
    let vz = dir.z * sp
    if (!this.local) {
      // World-space particles are placed with the emitter's transform at spawn time and then left alone.
      _v.set(px, py, pz).applyMatrix4(m)
      px = _v.x
      py = _v.y
      pz = _v.z
      _v.set(vx, vy, vz).transformDirection(m)
      const k = Math.hypot(vx, vy, vz)
      vx = _v.x * k
      vy = _v.y * k
      vz = _v.z * k
    }
    Object.assign(p, { x: px, y: py, z: pz, vx, vy, vz, ox: px, oy: py, oz: pz })
    this.parts.push(p)
  }

  /** Advances by `dt` seconds. */
  step(dt: number) {
    const m = this.matrix()
    let left = dt
    while (left > 1e-6) {
      const h = Math.min(left, STEP)
      left -= h
      this.sim(h, m)
    }
    this.draw(m)
  }

  private sim(dt: number, m: Matrix4) {
    const s = this.scope
    if (this.on) {
      this.age += dt
      this.setVars()
      this.perUpdate?.(s)
      const st = this.active(this.age, s)
      if (st.active) {
        if (this.steady) {
          this.acc += this.rate(s) * dt
          const cap = Math.min(this.cap, Math.round(this.maxParts(s)) || this.cap)
          while (this.acc >= 1) {
            this.acc -= 1
            if (this.parts.length < cap) this.spawn(m)
          }
        } else if (!this.wasActive || st.cycle !== this.lastCycle) {
          const n = Math.round(this.count(s))
          for (let i = 0; i < n && this.parts.length < this.cap; i++) this.spawn(m)
        }
        this.lastCycle = st.cycle
      }
      this.wasActive = st.active
    }
    let w = 0
    for (const p of this.parts) {
      p.age += dt
      this.setVars(p)
      if (p.age >= p.life || (this.expire && this.expire(s) !== 0)) continue
      if (this.rel) {
        const r = this.rel(s)
        p.x = p.ox + r[0]!
        p.y = p.oy + r[1]!
        p.z = p.oz + r[2]!
      } else {
        const a = this.accel(s)
        const d = this.drag(s)
        p.vx += (a[0]! - d * p.vx) * dt
        p.vy += (a[1]! - d * p.vy) * dt
        p.vz += (a[2]! - d * p.vz) * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
      }
      p.rotRate += (this.rotAccel(s) - this.rotDrag(s) * p.rotRate) * dt
      p.rot += p.rotRate * dt
      this.parts[w++] = p
    }
    this.parts.length = w
  }

  private draw(m: Matrix4) {
    const n = this.parts.length
    const A = this.a
    const s = this.scope
    const c3 = A.aCenter!.array as Float32Array
    const sz = A.aSize!.array as Float32Array
    const rt = A.aRot!.array as Float32Array
    const uvs = A.aUv!.array as Float32Array
    const col = A.aColor!.array as Float32Array
    for (let i = 0; i < n; i++) {
      const p = this.parts[i]!
      this.setVars(p)
      let x = p.x
      let y = p.y
      let z = p.z
      if (this.local) {
        _v.set(x, y, z).applyMatrix4(m)
        x = _v.x
        y = _v.y
        z = _v.z
      }
      const size = this.size(s)
      // Bedrock sizes are half-extents of the quad.
      const hw = size[0]!
      const hh = size[1]!
      let u0: number
      let v0: number
      let uw: number
      let uh: number
      if (this.flip) {
        const f = this.flip
        const max = Math.max(1, Math.round(f.max(s)))
        let frame = f.stretch ? Math.floor((p.age / p.life) * max) : Math.floor(p.age * f.fps(s))
        frame = f.loop ? frame % max : Math.min(frame, max - 1)
        const b = f.base(s)
        const st = f.step(s)
        const sS = f.size(s)
        u0 = b[0]! + st[0]! * frame
        v0 = b[1]! + st[1]! * frame
        uw = sS[0]!
        uh = sS[1]!
      } else {
        const uv = this.uv(s)
        const us = this.uvSize(s)
        u0 = uv[0]!
        v0 = uv[1]!
        uw = us[0]!
        uh = us[1]!
      }
      const color = this.tint(s)
      const rot = (p.rot * Math.PI) / 180
      for (let k = 0; k < 4; k++) {
        const o = i * 4 + k
        c3[o * 3] = x
        c3[o * 3 + 1] = y
        c3[o * 3 + 2] = z
        sz[o * 2] = hw
        sz[o * 2 + 1] = hh
        rt[o] = rot
        const cx = k === 1 || k === 2 ? 1 : 0
        const cy = k >= 2 ? 1 : 0
        uvs[o * 2] = (u0 + uw * cx) / this.texW
        uvs[o * 2 + 1] = (v0 + uh * (1 - cy)) / this.texH
        col[o * 4] = color[0]
        col[o * 4 + 1] = color[1]
        col[o * 4 + 2] = color[2]
        col[o * 4 + 3] = color[3]
      }
    }
    for (const k of ['aCenter', 'aSize', 'aRot', 'aUv', 'aColor']) A[k]!.needsUpdate = true
    this.geo.setDrawRange(0, n * 6)
  }

  dispose() {
    this.geo.dispose()
    ;(this.object.material as ShaderMaterial).dispose()
    this.texture?.dispose()
  }
}
