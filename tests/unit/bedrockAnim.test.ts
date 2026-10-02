import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import { AnimationPlayer, type AnimFile } from '../../src/three/animation/bedrockAnim'
import { parseFunctions } from '../../src/three/animation/molang'
import type { Bone } from '../../src/three/geoModel'

const DEG = Math.PI / 180
const bone = (name: string, basePos: [number, number, number] = [0, 0, 0], baseRot: [number, number, number] = [0, 0, 0]): Bone => {
  const group = new Group()
  group.name = name
  return { group, basePos, baseRot } as Bone
}
const rig = (...bones: Bone[]) => new Map(bones.map((b) => [b.group.name, b]))
const lib = new Map() as ReturnType<typeof parseFunctions>

describe('state selection', () => {
  const file = (names: string[]): AnimFile => ({ animations: Object.fromEntries(names.map((n) => [n, { bones: {} }])) })
  it('prefers idle, else the first non-gui animation, else the first', () => {
    expect(new AnimationPlayer(rig(), file(['gui', 'idle', 'walk']), lib).state).toBe('idle')
    expect(new AnimationPlayer(rig(), file(['gui', 'walk']), lib).state).toBe('walk')
    expect(new AnimationPlayer(rig(), file(['gui']), lib).state).toBe('gui')
    expect(new AnimationPlayer(rig(), file([]), lib).state).toBe('')
    expect(new AnimationPlayer(rig(), { animations: undefined as never }, lib).states).toEqual([])
  })
  it('honours a preferred list in order', () => {
    expect(new AnimationPlayer(rig(), file(['idle', 'main']), lib, ['main', 'idle']).state).toBe('main')
    expect(new AnimationPlayer(rig(), file(['idle', 'main', 'gui']), lib).states).toEqual(['idle', 'main', 'gui'])
  })
  it('setState ignores unknown states', () => {
    const p = new AnimationPlayer(rig(), file(['idle', 'walk']), lib)
    p.setState('nope')
    expect(p.state).toBe('idle')
    p.setState('walk')
    expect(p.state).toBe('walk')
  })
})

describe('channels', () => {
  it('constant arrays, numeric strings, Molang strings and {vector}', () => {
    const b = bone('b', [1, 2, 3], [10, 0, 0])
    const p = new AnimationPlayer(
      rig(b),
      {
        animations: {
          idle: {
            bones: {
              b: { rotation: [5, '15', 'q.anim_time * 10'], position: { vector: [1, 0, -1] }, scale: 2 },
            },
          },
        },
      },
      lib,
    )
    p.tick(500)
    // base rotation + channel, through the Bedrock -> three conversion (x and z mirrored)
    expect(b.group.rotation.x).toBeCloseTo(-15 * DEG)
    expect(b.group.rotation.y).toBeCloseTo(15 * DEG)
    expect(b.group.rotation.z).toBeCloseTo(-5 * DEG)
    expect(b.group.rotation.order).toBe('ZYX')
    expect(b.group.position.toArray()).toEqual([2, 2, 2])
    expect(b.group.scale.toArray()).toEqual([2, 2, 2])
  })

  it('a non-numeric empty string evaluates to 0', () => {
    const b = bone('b')
    const p = new AnimationPlayer(rig(b), { animations: { idle: { bones: { b: { position: ['', ' ', 3] } } } } }, lib)
    p.tick(0)
    expect(b.group.position.toArray()).toEqual([0, 0, 3])
  })

  it('interpolates keyframes linearly and clamps outside them', () => {
    const b = bone('b')
    const p = new AnimationPlayer(
      rig(b),
      {
        animations: {
          idle: {
            animation_length: 10,
            bones: {
              b: {
                position: {
                  '0.5': [0, 0, 0],
                  '1.5': { post: [10, 20, 30] },
                  '2.5': { pre: [20, 20, 30], post: [0, 0, 0] },
                  '3.5': { vector: [0, 0, 0] },
                  ignored: [99, 99, 99],
                } as never,
              },
            },
          },
        },
      },
      lib,
    )
    const at = (s: number) => (p.tick(s * 1000), b.group.position.toArray())
    expect(at(0)).toEqual([0, 0, 0])
    expect(at(1)).toEqual([5, 10, 15])
    expect(at(1.5)).toEqual([10, 20, 30])
    // `post` wins over `pre` for the frame's value
    expect(at(2)).toEqual([5, 10, 15])
    expect(at(9)).toEqual([0, 0, 0])
  })

  it('a keyframe object without numeric keys is no track', () => {
    const b = bone('b', [4, 4, 4])
    const p = new AnimationPlayer(rig(b), { animations: { idle: { bones: { b: { position: { foo: [1, 1, 1] } as never } } } } }, lib)
    p.tick(0)
    expect(b.group.position.toArray()).toEqual([4, 4, 4])
  })

  it('uses Molang functions from the library', () => {
    const fns = parseFunctions('lunar.twice(a.x): |-\n  return a.x * 2;\n')
    const b = bone('b')
    const p = new AnimationPlayer(rig(b), { animations: { idle: { bones: { b: { position: ['lunar.twice(3)', 0, 0] } } } } }, fns)
    p.tick(0)
    expect(b.group.position.x).toBe(6)
  })
})

describe('timing', () => {
  const file: AnimFile = {
    animations: {
      idle: { animation_length: 2, bones: { b: { position: { '0': [0, 0, 0], '2': [20, 0, 0] } } } },
      once: { animation_length: 2, loop: false, bones: { b: { position: { '0': [0, 0, 0], '2': [20, 0, 0] } } } },
      open: { bones: { b: { position: ['q.anim_time', 'q.life_time', 'q.delta_time * 60'] } } },
    },
  }
  it('loops by default', () => {
    const b = bone('b')
    const p = new AnimationPlayer(rig(b), file, lib)
    p.tick(1000)
    expect(b.group.position.x).toBeCloseTo(10)
    p.tick(3000)
    expect(b.group.position.x).toBeCloseTo(10)
  })
  it('holds the last frame when loop is false', () => {
    const b = bone('b')
    const p = new AnimationPlayer(rig(b), file, lib, ['once'])
    p.tick(5000)
    expect(b.group.position.x).toBeCloseTo(20)
  })
  it('anim_time runs on without a length; setState restarts it', () => {
    const b = bone('b')
    const p = new AnimationPlayer(rig(b), file, lib, ['open'])
    p.tick(7000)
    expect(b.group.position.toArray()).toEqual([7, 7, 1])
    p.setState('idle')
    p.setState('open')
    p.tick(8000)
    expect(b.group.position.x).toBeCloseTo(1)
    expect(b.group.position.y).toBeCloseTo(8)
  })
})

describe('bones without tracks', () => {
  it('are reset to their base pose', () => {
    const a = bone('a', [1, 2, 3], [0, 90, 0])
    const b = bone('b')
    a.group.position.set(9, 9, 9)
    a.group.scale.set(0, 0, 0)
    const p = new AnimationPlayer(rig(a, b), { animations: { idle: { bones: { b: { rotation: [0, 0, 0] } } } } }, lib)
    p.tick(0)
    expect(a.group.position.toArray()).toEqual([1, 2, 3])
    expect(a.group.scale.toArray()).toEqual([1, 1, 1])
    expect(b.group.scale.toArray()).toEqual([1, 1, 1])
  })
  it('nothing happens for an unknown state', () => {
    const a = bone('a')
    a.group.position.set(5, 5, 5)
    const p = new AnimationPlayer(rig(a), { animations: {} }, lib)
    p.tick(100)
    expect(a.group.position.toArray()).toEqual([5, 5, 5])
  })
})
