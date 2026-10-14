import { Group, Mesh, MeshLambertMaterial, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { compile, newScope } from '../../src/three/animation/molang'
import { EffectPlayer, particleCues } from '../../src/three/effects'
import { buildGeoRig, type GeoFile } from '../../src/three/geoModel'
import { vec, type Scheme } from '../../src/three/particles'

const scheme = (extra: Record<string, unknown> = {}): Scheme => ({
  particle_effect: {
    description: { identifier: 'test:spark', basic_render_parameters: { texture: 'x' } },
    components: {
      'minecraft:emitter_rate_instant': { num_particles: 3 },
      'minecraft:emitter_lifetime_once': { active_time: 0.1 },
      'minecraft:particle_lifetime_expression': { max_lifetime: 5 },
      'minecraft:particle_appearance_billboard': { size: { first: 0.1, second: 0.1 }, uv: { texture_width: 16, texture_height: 16, uv: { first: 8, second: 0 }, uv_size: { first: 8, second: 8 } } },
      ...extra,
    },
  },
})
const drawn = (p: EffectPlayer) => {
  let n = 0
  p.object.traverse((o) => void (o instanceof Mesh && (n += o.geometry.drawRange.count)))
  // two triangles (6 vertices) per particle
  return n / 6
}

describe('particleCues', () => {
  it('reads particle_effects timelines (single or lists) of the playing animations', () => {
    const file = {
      animations: {
        'animation.x.idle': { animation_length: 2, particle_effects: { '0.0': { effect: 'test:a', locator: 'tip' }, '1.0': [{ effect: 'test:b' }, { effect: 'test:c', locator: 'base' }], bad: { effect: 'z' } } },
        'animation.x.other': { particle_effects: { '0.5': { effect: 'test:d' } } },
      },
    }
    expect(particleCues(file, ['animation.x.idle'])).toEqual([
      { anim: 'animation.x.idle', length: 2, time: 0, effect: 'test:a', locator: 'tip' },
      { anim: 'animation.x.idle', length: 2, time: 1, effect: 'test:b', locator: undefined },
      { anim: 'animation.x.idle', length: 2, time: 1, effect: 'test:c', locator: 'base' },
    ])
    // no names: every animation; without a length it loops just past its last cue (at least 1 s)
    expect(particleCues(file).map((c) => [c.effect, c.length])).toContainEqual(['test:d', 1])
  })
})

describe('EffectPlayer', () => {
  it('fires a cue as the looping animation passes it; particles outlive the emitter', () => {
    const space = new Group()
    const loc = new Object3D()
    loc.position.set(0, 2, 0)
    space.add(loc)
    space.updateMatrixWorld(true)
    const p = new EffectPlayer([{ anim: 'a', length: 1, time: 0.5, effect: 'test:spark', locator: 'tip' }], new Map([['test:spark', { scheme: scheme() }]]), new Map([['tip', loc]]), space)
    expect(p.count).toBe(1)
    p.tick(0)
    p.tick(400)
    expect(drawn(p)).toBe(0)
    p.tick(600)
    expect(drawn(p)).toBe(3)
    // the next loop restarts the emitter; the earlier particles live on (lifetime 5 s)
    p.tick(1000)
    p.tick(1400)
    p.tick(1600)
    expect(drawn(p)).toBe(6)
    // a seek restarts cleanly
    p.tick(10_000)
    expect(drawn(p)).toBe(0)
    p.dispose()
  })

  it('skips cues whose effect is unknown', () => {
    expect(new EffectPlayer([{ anim: 'a', length: 1, time: 0, effect: 'nope' }], new Map(), new Map(), new Group()).count).toBe(0)
  })
})

describe('locators', () => {
  it('are children of their bone at the model-space point', () => {
    const geo = {
      'minecraft:geometry': [{ description: {}, bones: [{ name: 'b', pivot: [0, 24, 0], locators: { tip: [0, 30, 2], turned: { offset: [1, 24, 0], rotation: [0, 90, 0] } } }] }],
    } as unknown as GeoFile
    const { locators, bones } = buildGeoRig(geo, new MeshLambertMaterial())
    expect(locators.get('tip')!.parent).toBe(bones.get('b')!.group)
    expect(locators.get('tip')!.position.toArray()).toEqual([0, 6, 2])
    expect(locators.get('turned')!.rotation.y).toBeCloseTo(Math.PI / 2)
  })
})

describe('Essential particle JSON', () => {
  it('vectors may be { first, second, third }', () => {
    const v = vec({ first: 1, second: '2 * 3', third: 4 }, new Map(), 3, [0, 0, 0])
    expect(v(newScope())).toEqual([1, 6, 4])
    expect(vec({ first: 5, second: 6 }, new Map(), 2, [0, 0])(newScope())).toEqual([5, 6])
  })

  it('Molang blocks end at their closing brace', () => {
    const s = newScope()
    compile('({({variable.size=0.09});})', new Map())(s)
    expect(s.v.size).toBeCloseTo(0.09)
    compile('{variable.a = 2; variable.b = variable.a * 3;}', new Map())(s)
    expect(s.v.b).toBe(6)
    expect(compile('{variable.c = 1;} + 4', new Map())(s)).toBe(5)
  })
})
