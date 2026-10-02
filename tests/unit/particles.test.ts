import { Matrix4, ShaderMaterial, Texture, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newScope, parseFunctions } from '../../src/three/animation/molang'
import { curveValue, Emitter, hex, num, vec, type Curve, type Scheme } from '../../src/three/particles'

const lib = parseFunctions('')
const scheme = (components: Record<string, unknown>, curves?: Record<string, unknown>): Scheme => ({
  particle_effect: { description: { identifier: 't:x', basic_render_parameters: { texture: 'textures/particle/particles' } }, components, curves },
})
const count = (e: Emitter) => e.object.geometry.drawRange.count / 6
const attr = (e: Emitter, name: string) => e.object.geometry.getAttribute(name).array as Float32Array
/** Center of particle i. */
const center = (e: Emitter, i: number) => [...attr(e, 'aCenter').slice(i * 12, i * 12 + 3)]
const centers = (e: Emitter) => Array.from({ length: count(e) }, (_, i) => new Vector3(...center(e, i)))
const emitter = (c: Record<string, unknown>, m = new Matrix4(), curves?: Record<string, unknown>) => {
  const e = new Emitter(scheme(c, curves), lib, undefined, () => m)
  e.setEnabled(true)
  return e
}

afterEach(() => vi.restoreAllMocks())

describe('num / vec', () => {
  const s = newScope()
  it('num compiles numbers, Molang strings, booleans, with a default', () => {
    expect(num(3, lib)(s)).toBe(3)
    expect(num('1 + 1', lib)(s)).toBe(2)
    expect(num(true, lib)(s)).toBe(1)
    expect(num(false, lib)(s)).toBe(0)
    expect(num(undefined, lib, 7)(s)).toBe(7)
    expect(num('  ', lib, 4)(s)).toBe(4)
  })
  it('vec broadcasts a scalar, fills missing components and uses the default', () => {
    expect(vec([1, '2'], lib, 3, [9, 9, 5])(s)).toEqual([1, 2, 5])
    expect(vec(2, lib, 3, [0, 0, 0])(s)).toEqual([2, 2, 2])
    expect(vec(undefined, lib, 2, [4, 5])(s)).toEqual([4, 5])
  })
})

describe('hex', () => {
  it('parses #RRGGBB and #AARRGGBB (to linear rgb)', () => {
    expect(hex('#FFFFFF')).toEqual([1, 1, 1, 1])
    expect(hex('#000000')).toEqual([0, 0, 0, 1])
    const [r, g, b, a] = hex('#80FF0000')
    expect(r).toBeCloseTo(1)
    expect(g).toBe(0)
    expect(b).toBe(0)
    expect(a).toBeCloseTo(128 / 255)
    expect(hex('00ff00')[1]).toBeCloseTo(1)
  })
})

describe('curveValue', () => {
  const s = newScope()
  const curve = (type: string, nodes: number[], input: number, range = 1): Curve => ({ name: 'c', type, nodes, input: () => input, range: () => range })
  it('linear curves spread nodes evenly over [0, range] and clamp', () => {
    expect(curveValue(curve('linear', [0, 10, 20], 0.25), s)).toBeCloseTo(5)
    expect(curveValue(curve('linear', [0, 10, 20], 0.75), s)).toBeCloseTo(15)
    expect(curveValue(curve('linear', [0, 10, 20], 5, 10), s)).toBeCloseTo(10)
    expect(curveValue(curve('linear', [0, 10, 20], -1), s)).toBe(0)
    expect(curveValue(curve('linear', [0, 10, 20], 2), s)).toBe(20)
    expect(curveValue(curve('linear', [3], 0.5), s)).toBe(3)
    expect(curveValue(curve('linear', [], 0.5), s)).toBe(0)
    // a zero range counts as 1
    expect(curveValue(curve('linear', [0, 10], 0.5, 0), s)).toBeCloseTo(5)
  })
  it('catmull-rom passes through the inner nodes; the outer ones are control points', () => {
    const n = [100, 0, 10, 20, -100]
    expect(curveValue(curve('catmull_rom', n, 0), s)).toBeCloseTo(0)
    expect(curveValue(curve('catmull_rom', n, 0.5), s)).toBeCloseTo(10)
    expect(curveValue(curve('catmull_rom', n, 1), s)).toBeCloseTo(20)
    // with fewer than 4 nodes it falls back to linear
    expect(curveValue(curve('catmull_rom', [0, 10, 20], 0.25), s)).toBeCloseTo(5)
  })
})

describe('Emitter', () => {
  it('starts empty and spawns nothing until enabled', () => {
    const e = new Emitter(scheme({ 'minecraft:emitter_rate_steady': { spawn_rate: 30, max_particles: 50 } }), lib, undefined, () => new Matrix4())
    e.step(1)
    expect(count(e)).toBe(0)
    expect(e.object.frustumCulled).toBe(false)
    expect(e.object.renderOrder).toBe(10)
    expect((e.object.material as ShaderMaterial).transparent).toBe(true)
  })

  it('steady rate spawns rate*dt particles up to max_particles', () => {
    const e = emitter({ 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 100 } })
    e.step(1)
    expect(count(e)).toBe(10)
    const capped = emitter({ 'minecraft:emitter_rate_steady': { spawn_rate: 100, max_particles: 15 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 100 } })
    capped.step(1)
    expect(count(capped)).toBe(15)
  })

  it('the buffer capacity is limited to 600', () => {
    const e = emitter({ 'minecraft:emitter_rate_steady': { spawn_rate: 5000, max_particles: 10000 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 100 } })
    e.step(1)
    expect(count(e)).toBe(600)
  })

  it('instant rate emits one burst per looping cycle', () => {
    const e = emitter({
      'minecraft:emitter_rate_instant': { num_particles: 4 },
      'minecraft:emitter_lifetime_looping': { active_time: 1, sleep_time: 1 },
      'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
    })
    e.step(0.5)
    expect(count(e)).toBe(4)
    e.step(1)
    expect(count(e)).toBe(4)
    e.step(1)
    expect(count(e)).toBe(8)
  })

  it('emitter_lifetime_once stops emitting after active_time', () => {
    const e = emitter({
      'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 },
      'minecraft:emitter_lifetime_once': { active_time: 0.5 },
      'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
    })
    e.step(2)
    expect(count(e)).toBe(5)
  })

  it('emitter_lifetime_expression: activation and expiration', () => {
    const off = emitter({ 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 }, 'minecraft:emitter_lifetime_expression': { activation_expression: 0 } })
    off.step(1)
    expect(count(off)).toBe(0)
    const exp = emitter({
      'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 },
      'minecraft:emitter_lifetime_expression': { activation_expression: 1, expiration_expression: 'v.emitter_age > 0.5' },
      'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
    })
    exp.step(2)
    expect(count(exp)).toBeGreaterThanOrEqual(4)
    expect(count(exp)).toBeLessThanOrEqual(6)
  })

  it('particles expire after their lifetime or when the expiration expression holds', () => {
    const e = emitter({ 'minecraft:emitter_rate_instant': { num_particles: 3 }, 'minecraft:emitter_lifetime_once': { active_time: 0.05 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 0.5 } })
    e.step(0.4)
    expect(count(e)).toBe(3)
    e.step(0.2)
    expect(count(e)).toBe(0)
    const x = emitter({
      'minecraft:emitter_rate_instant': { num_particles: 3 },
      'minecraft:emitter_lifetime_once': { active_time: 0.05 },
      'minecraft:particle_lifetime_expression': { max_lifetime: 10, expiration_expression: 'v.particle_age > 0.2' },
    })
    x.step(0.1)
    expect(count(x)).toBe(3)
    x.step(0.2)
    expect(count(x)).toBe(0)
  })

  it('reset clears particles; setEnabled(false) stops spawning', () => {
    const c = { 'minecraft:emitter_rate_steady': { spawn_rate: 10, max_particles: 100 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 100 } }
    const e = emitter(c)
    e.step(1)
    e.reset()
    expect(count(e)).toBe(0)
    e.step(1)
    expect(count(e)).toBe(0)
    e.setEnabled(true)
    e.step(0.5)
    e.setEnabled(false)
    e.step(1)
    expect(count(e)).toBe(5)
  })

  const instant = (shape: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    emitter({ 'minecraft:emitter_rate_instant': { num_particles: 200 }, 'minecraft:emitter_lifetime_once': { active_time: 1 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 10 }, ...shape, ...extra })

  it('point shape spawns at the offset', () => {
    const e = instant({ 'minecraft:emitter_shape_point': { offset: [1, 2, 3] } })
    e.step(1 / 60)
    for (const p of centers(e)) expect(p.toArray()).toEqual([1, 2, 3])
  })

  it('sphere shape stays within the radius (on it with surface_only)', () => {
    const e = instant({ 'minecraft:emitter_shape_sphere': { radius: 2, offset: [0, 5, 0] } })
    e.step(1 / 60)
    for (const p of centers(e)) expect(p.distanceTo(new Vector3(0, 5, 0))).toBeLessThanOrEqual(2 + 1e-6)
    const s = instant({ 'minecraft:emitter_shape_sphere': { radius: 2, surface_only: true } })
    s.step(1 / 60)
    for (const p of centers(s)) expect(p.length()).toBeCloseTo(2)
  })

  it('disc shape lies in the plane given by plane_normal', () => {
    const y = instant({ 'minecraft:emitter_shape_disc': { radius: 1 } })
    y.step(1 / 60)
    for (const p of centers(y)) {
      expect(p.y).toBeCloseTo(0)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(1 + 1e-6)
    }
    const x = instant({ 'minecraft:emitter_shape_disc': { radius: 1, plane_normal: 'x', surface_only: true } })
    x.step(1 / 60)
    for (const p of centers(x)) {
      expect(p.x).toBeCloseTo(0)
      expect(Math.hypot(p.y, p.z)).toBeCloseTo(1)
    }
    const z = instant({ 'minecraft:emitter_shape_disc': { radius: 1, plane_normal: [0, 0, 1] } })
    z.step(1 / 60)
    for (const p of centers(z)) expect(p.z).toBeCloseTo(0)
  })

  it('box shape stays within the half dimensions', () => {
    const e = instant({ 'minecraft:emitter_shape_box': { half_dimensions: [1, 2, 3] } })
    e.step(1 / 60)
    for (const p of centers(e)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(2)
      expect(Math.abs(p.z)).toBeLessThanOrEqual(3)
    }
  })

  it('direction: vector, outwards and inwards with initial speed', () => {
    const v = instant({ 'minecraft:emitter_shape_point': { direction: [0, 1, 0] } }, { 'minecraft:particle_initial_speed': 2 })
    v.step(0.5)
    for (const p of centers(v)) expect(p.y).toBeCloseTo(1, 1)
    const out = instant({ 'minecraft:emitter_shape_sphere': { radius: 1, surface_only: true, direction: 'outwards' } }, { 'minecraft:particle_initial_speed': 2 })
    out.step(0.5)
    for (const p of centers(out)) expect(p.length()).toBeGreaterThan(1.5)
    const inw = instant({ 'minecraft:emitter_shape_sphere': { radius: 1, surface_only: true, direction: 'inwards' } }, { 'minecraft:particle_initial_speed': 1 })
    inw.step(0.5)
    for (const p of centers(inw)) expect(p.length()).toBeLessThan(1)
  })

  it('dynamic motion applies acceleration and drag', () => {
    const e = instant({ 'minecraft:emitter_shape_point': {} }, { 'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -10, 0] } })
    e.step(1)
    // ~ -1/2 g t² (semi-implicit Euler at 30 Hz)
    for (const p of centers(e)) expect(p.y).toBeCloseTo(-5, 0)
    const d = instant({ 'minecraft:emitter_shape_point': {} }, { 'minecraft:particle_motion_dynamic': { linear_acceleration: [0, -10, 0], linear_drag_coefficient: 5 } })
    d.step(1)
    for (const p of centers(d)) expect(p.y).toBeGreaterThan(-5)
  })

  it('parametric motion places particles at origin + relative_position', () => {
    const e = instant({ 'minecraft:emitter_shape_point': { offset: [1, 0, 0] } }, { 'minecraft:particle_motion_parametric': { relative_position: [0, 'v.particle_age * 10', 0] } })
    e.step(0.5)
    for (const p of centers(e)) {
      expect(p.x).toBeCloseTo(1)
      expect(p.y).toBeCloseTo(5)
    }
  })

  it('world-space particles take the emitter transform at spawn; local-space ones follow it', () => {
    const m = new Matrix4().makeTranslation(10, 0, 0)
    const c = { 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:emitter_lifetime_once': { active_time: 0.05 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 10 } }
    const world = emitter(c, m)
    world.step(1 / 60)
    expect(center(world, 0)).toEqual([10, 0, 0])
    m.makeTranslation(20, 0, 0)
    world.step(1 / 60)
    expect(center(world, 0)).toEqual([10, 0, 0])
    const m2 = new Matrix4().makeTranslation(10, 0, 0)
    const local = emitter({ ...c, 'minecraft:emitter_local_space': { position: true } }, m2)
    local.step(1 / 60)
    m2.makeTranslation(20, 0, 0)
    local.step(1 / 60)
    expect(center(local, 0)).toEqual([20, 0, 0])
  })

  it('billboard size, static uv and tint array', () => {
    const e = instant(
      { 'minecraft:emitter_shape_point': {} },
      {
        'minecraft:emitter_rate_instant': { num_particles: 1 },
        'minecraft:particle_appearance_billboard': { size: [0.2, 0.3], uv: { texture_width: 128, texture_height: 64, uv: [16, 8], uv_size: [8, 8] } },
        'minecraft:particle_appearance_tinting': { color: [1, 0.5, 0.25, 0.75] },
      },
    )
    e.step(1 / 60)
    expect([...attr(e, 'aSize').slice(0, 2)].map((n) => +n.toFixed(4))).toEqual([0.2, 0.3])
    // corner 0 = (u0, v0 + uh), corner 1 = (u0 + uw, v0 + uh), corner 2 = (u0 + uw, v0)
    const uv = [...attr(e, 'aUv').slice(0, 8)].map((n) => +n.toFixed(4))
    expect(uv).toEqual([16 / 128, 16 / 64, 24 / 128, 16 / 64, 24 / 128, 8 / 64, 16 / 128, 8 / 64].map((n) => +n.toFixed(4)))
    expect([...attr(e, 'aColor').slice(0, 4)]).toEqual([1, 0.5, 0.25, 0.75])
  })

  it('flipbook frames advance with fps, clamp without loop, loop with loop', () => {
    const fb = (flip: Record<string, unknown>) =>
      instant(
        { 'minecraft:emitter_shape_point': {} },
        {
          'minecraft:emitter_rate_instant': { num_particles: 1 },
          'minecraft:particle_appearance_billboard': { uv: { texture_width: 128, texture_height: 128, flipbook: { base_UV: [0, 0], size_UV: [8, 8], step_UV: [8, 0], frames_per_second: 10, max_frame: 4, ...flip } } },
        },
      )
    const u0 = (e: Emitter) => Math.round(attr(e, 'aUv')[0]! * 128)
    const a = fb({})
    a.step(0.25)
    expect(u0(a)).toBe(16)
    a.step(1)
    expect(u0(a)).toBe(24)
    const l = fb({ loop: true })
    l.step(0.55)
    expect(u0(l)).toBe(8)
    const st = fb({ stretch_to_lifetime: true })
    st.step(5.1)
    // lifetime 10 s, max 4 frames: just past half way = frame 2
    expect(u0(st)).toBe(16)
  })

  it('gradient tint interpolates between stops', () => {
    const e = instant(
      { 'minecraft:emitter_shape_point': {} },
      {
        'minecraft:emitter_rate_instant': { num_particles: 1 },
        'minecraft:particle_appearance_tinting': { color: { interpolant: 'v.particle_age', gradient: { '1.0': '#FFFFFFFF', '0.0': '#FF000000' } } },
      },
    )
    e.step(0.5)
    const c = [...attr(e, 'aColor').slice(0, 4)]
    expect(c[3]).toBe(1)
    expect(c[0]).toBeCloseTo(0.5, 1)
    e.step(2)
    expect([...attr(e, 'aColor').slice(0, 4)]).toEqual([1, 1, 1, 1])
  })

  it('spin and rotation rate', () => {
    const e = instant(
      { 'minecraft:emitter_shape_point': {} },
      { 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:particle_initial_spin': { rotation: 90, rotation_rate: 180 } },
    )
    e.step(1)
    // 90 + 180 deg/s * 1 s = 270 deg
    expect(attr(e, 'aRot')[0]).toBeCloseTo((270 * Math.PI) / 180, 1)
  })

  it('curves are evaluated into variables', () => {
    const e = instant(
      { 'minecraft:emitter_shape_point': {} },
      { 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:particle_appearance_billboard': { size: ['variable.grow', 'v.grow'] } },
    )
    const g = new Emitter(
      scheme(
        { ...{ 'minecraft:emitter_rate_instant': { num_particles: 1 }, 'minecraft:emitter_lifetime_once': { active_time: 1 }, 'minecraft:particle_lifetime_expression': { max_lifetime: 10 } }, 'minecraft:particle_appearance_billboard': { size: ['variable.grow', 'v.grow'] } },
        { 'variable.grow': { type: 'linear', input: 'v.particle_age', horizontal_range: 1, nodes: [0, 1] } },
      ),
      lib,
      undefined,
      () => new Matrix4(),
    )
    g.setEnabled(true)
    g.step(0.5)
    expect(attr(g, 'aSize')[0]).toBeCloseTo(0.5, 1)
    e.step(0.1)
    expect(attr(e, 'aSize')[0]).toBe(0)
  })

  it('emitter initialization and per-update expressions run in the emitter scope', () => {
    const e = emitter({
      'minecraft:emitter_initialization': { creation_expression: 'v.rate = 20;', per_update_expression: 'v.size = 0.5;' },
      'minecraft:emitter_rate_steady': { spawn_rate: 'v.rate', max_particles: 100 },
      'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
      'minecraft:particle_appearance_billboard': { size: ['v.size', 'v.size'] },
    })
    e.step(1.01)
    expect(count(e)).toBe(20)
    expect(attr(e, 'aSize')[0]).toBe(0.5)
  })

  it('dispose releases geometry, material and texture', () => {
    const tex = new Texture()
    const e = new Emitter(scheme({}), lib, tex, () => new Matrix4())
    const t = vi.spyOn(tex, 'dispose')
    const g = vi.spyOn(e.object.geometry, 'dispose')
    const m = vi.spyOn(e.object.material as ShaderMaterial, 'dispose')
    e.dispose()
    expect(t).toHaveBeenCalled()
    expect(g).toHaveBeenCalled()
    expect(m).toHaveBeenCalled()
    expect((e.object.material as ShaderMaterial).uniforms.map!.value).toBe(tex)
  })
})
