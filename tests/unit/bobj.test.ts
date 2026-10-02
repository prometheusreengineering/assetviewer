import { Euler, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { actionNames, buildSkeleton, cubic, evalChannel, extractAction, parseBobj, poseSkeleton, skinnedMesh, type Kf } from '../../src/three/bobj'
import { ACTIONS, BOBJ } from '../fixtures/bobj'

const kf = (t: number, v: number, interp = 'LINEAR', extra: Partial<Kf> = {}): Kf => ({ t, v, interp, lx: t, ly: v, rx: t, ry: v, ...extra })

describe('parseBobj', () => {
  const f = parseBobj(BOBJ)

  it('reads bones; an empty parent token marks a root', () => {
    expect(f.bones.map((b) => [b.name, b.parent])).toEqual([
      ['root', ''],
      ['child', 'root'],
    ])
    expect(new Vector3().setFromMatrixPosition(f.bones[1]!.mat).toArray()).toEqual([0, 1, 0])
  })

  it('emits one vertex per face corner with file-wide indices, flipped v and default normals', () => {
    const body = f.meshes.get('body')!
    expect(body.pos).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(body.uv).toEqual([0, 1, 1, 1, 0, 0])
    expect(body.normal).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
    expect(body.weights).toEqual([[['root', 1]], [['root', 0.25], ['child', 0.75]], [['child', 2]]])
    const bare = f.meshes.get('bare')!
    expect(bare.uv).toEqual([0, 0, 0, 0, 0, 0])
    expect(bare.normal).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0])
  })

  it('fans polygons into triangles', () => {
    const quad = f.meshes.get('quad')!
    expect(quad.pos.length / 3).toBe(6)
    expect(quad.pos.slice(9, 18)).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(quad.weights[4]).toEqual([])
  })

  it('reads actions with channels per bone and the last keyframe tick as length', () => {
    expect([...f.actions.keys()]).toEqual(['emote_wave', 'emote_bezier'])
    const wave = f.actions.get('emote_wave')!
    expect(wave.length).toBe(20)
    const ch = wave.bones.get('child')!
    expect(ch.map((c) => [c.kind, c.axis, c.kfs.length])).toEqual([
      ['location', 1, 2],
      ['rotation', 2, 2],
      ['scale', 0, 2],
    ])
    expect(ch[0]!.kfs[1]).toEqual({ t: 10, v: 2, interp: 'LINEAR', lx: 10, ly: 2, rx: 10, ry: 2 })
    expect(f.actions.get('emote_bezier')!.bones.get('root')![0]!.kfs[0]).toEqual({ t: 0, v: 0, interp: 'BEZIER', lx: 0, ly: 0, rx: 3, ry: 0 })
  })

  it('a keyframe without interpolation defaults to LINEAR', () => {
    const a = parseBobj(ACTIONS).actions.get('first')!
    expect(a.bones.get('root')![0]!.kfs[0]!.interp).toBe('LINEAR')
  })

  it('ignores faces before any object and unknown lines; handles CRLF', () => {
    const g = parseBobj('v 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 2 3\r\nxyz foo\r\no m\r\nf 1 2 3\r\n')
    expect([...g.meshes.keys()]).toEqual(['m'])
    expect(g.meshes.get('m')!.pos).toHaveLength(9)
  })
})

describe('extractAction / actionNames', () => {
  it('slices one action block', () => {
    expect(extractAction(ACTIONS, 'first')).toBe('an first\nao root\nag location 0\nkf 0 0\n')
    expect(extractAction(ACTIONS, 'second')).toBe('an second\nao root\n')
    expect(extractAction(ACTIONS, 'third')).toBe('an third\nkf 5 1\n')
    expect(extractAction(ACTIONS, 'fourth')).toBeUndefined()
    // a prefix of another name doesn't match
    expect(extractAction(ACTIONS, 'firs')).toBeUndefined()
  })
  it('needs a line before the block (an action on the first line of a file is not found)', () => {
    expect(extractAction('an only\nkf 1 1\n', 'only')).toBeUndefined()
  })
  it('a block at the very end without a trailing newline', () => {
    expect(extractAction('x\nan last\nkf 1 1', 'last')).toBe('an last\nkf 1 1')
  })
  it('lists every action', () => {
    expect(actionNames(ACTIONS)).toEqual(['first', 'second', 'third'])
    expect(actionNames(BOBJ)).toEqual(['emote_wave', 'emote_bezier'])
  })
})

describe('buildSkeleton', () => {
  const f = parseBobj(BOBJ)
  const s = buildSkeleton(f.bones)
  it('builds a hierarchy with parent-relative rest matrices', () => {
    expect(s.roots.map((b) => b.name)).toEqual(['root'])
    const child = s.bones.get('child')!
    expect(child.parent).toBe(s.bones.get('root'))
    expect(child.matrixAutoUpdate).toBe(false)
    expect(new Vector3().setFromMatrixPosition(s.rel.get('child')!).toArray()).toEqual([0, 1, 0])
    expect(s.skeleton.bones).toHaveLength(2)
    expect(new Vector3().setFromMatrixPosition(s.skeleton.boneInverses[1]!).toArray()).toEqual([0, -1, 0])
  })
  it('a bone whose parent is missing becomes a root', () => {
    const t = buildSkeleton([{ name: 'orphan', parent: 'ghost', mat: new Matrix4() }])
    expect(t.roots.map((b) => b.name)).toEqual(['orphan'])
  })
})

describe('skinnedMesh', () => {
  const f = parseBobj(BOBJ)
  const s = buildSkeleton(f.bones)
  it('normalises weights, keeps the strongest four and gives unweighted vertices full weight on bone 0', () => {
    const m = skinnedMesh({ ...f.meshes.get('body')!, weights: [[['root', 1]], [['root', 0.25], ['child', 0.75]], [['child', 2]]] }, s, new MeshBasicMaterial())
    const w = m.geometry.getAttribute('skinWeight').array
    const i = m.geometry.getAttribute('skinIndex').array
    expect([...w.slice(0, 4)]).toEqual([1, 0, 0, 0])
    expect([...w.slice(4, 8)]).toEqual([0.75, 0.25, 0, 0])
    expect([...i.slice(4, 8)]).toEqual([1, 0, 0, 0])
    expect([...w.slice(8, 12)]).toEqual([1, 0, 0, 0])
    expect([...i.slice(8, 12)]).toEqual([1, 0, 0, 0])
    expect(m.name).toBe('body')
    expect(m.frustumCulled).toBe(false)
    expect(m.skeleton).toBe(s.skeleton)
  })
  it('drops unknown bones and caps at four influences', () => {
    const many: [string, number][] = [['root', 0.1], ['child', 0.2], ['ghost', 5], ['root', 0.3], ['child', 0.4], ['root', 0.05]]
    const m = skinnedMesh({ name: 'x', pos: [0, 0, 0], uv: [0, 0], normal: [0, 1, 0], weights: [many, [['ghost', 1]], []] }, s, new MeshBasicMaterial())
    const w = [...m.geometry.getAttribute('skinWeight').array]
    expect(w.slice(0, 4).reduce((a, b) => a + b)).toBeCloseTo(1)
    expect(w[0]).toBeCloseTo(0.4)
    expect(w[3]).toBeCloseTo(0.1)
    expect(w.slice(4, 8)).toEqual([1, 0, 0, 0])
    expect(w.slice(8, 12)).toEqual([1, 0, 0, 0])
  })
})

describe('evalChannel', () => {
  it('clamps before the first and after the last keyframe', () => {
    const k = [kf(5, 1), kf(10, 3)]
    expect(evalChannel(k, 0)).toBe(1)
    expect(evalChannel(k, 50)).toBe(3)
    expect(evalChannel([kf(0, 7)], 3)).toBe(7)
  })
  it('LINEAR, CONSTANT and SINE', () => {
    expect(evalChannel([kf(0, 0), kf(10, 10)], 2.5)).toBeCloseTo(2.5)
    expect(evalChannel([kf(0, 0, 'CONSTANT'), kf(10, 10)], 9.9)).toBe(0)
    expect(evalChannel([kf(0, 0, 'SINE'), kf(10, 10)], 5)).toBeCloseTo(5)
    expect(evalChannel([kf(0, 0, 'SINE'), kf(10, 10)], 2.5)).toBeCloseTo(10 * (1 - Math.cos(Math.PI / 4)) / 2)
  })
  it('finds the right segment among many keys', () => {
    const k = Array.from({ length: 50 }, (_, i) => kf(i * 2, i))
    expect(evalChannel(k, 31)).toBeCloseTo(15.5)
    expect(evalChannel(k, 98)).toBe(49)
  })
  it('BEZIER: linear handles give a straight line; ease handles slow the ends', () => {
    const lin = [kf(0, 0, 'BEZIER', { rx: 10 / 3, ry: 10 / 3 }), kf(10, 10, 'BEZIER', { lx: 20 / 3, ly: 20 / 3 })]
    expect(evalChannel(lin, 2)).toBeCloseTo(2, 3)
    expect(evalChannel(lin, 7)).toBeCloseTo(7, 3)
    const ease = [kf(0, 0, 'BEZIER', { rx: 3, ry: 0 }), kf(10, 10, 'BEZIER', { lx: 7, ly: 10 })]
    expect(evalChannel(ease, 5)).toBeCloseTo(5, 3)
    expect(evalChannel(ease, 1)).toBeLessThan(1)
    expect(evalChannel(ease, 9)).toBeGreaterThan(9)
  })
  it('BEZIER handles outside the segment are clamped to it', () => {
    const k = [kf(0, 0, 'BEZIER', { rx: -50, ry: 0 }), kf(10, 10, 'BEZIER', { lx: 99, ly: 10 })]
    const v = evalChannel(k, 5)
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(10)
  })
  it('cubic is the Bernstein form', () => {
    expect(cubic(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5)
    expect(cubic(4, 0, 0, 8, 0)).toBe(4)
    expect(cubic(4, 0, 0, 8, 1)).toBe(8)
  })
})

describe('poseSkeleton', () => {
  const f = parseBobj(BOBJ)
  const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m).toArray()

  it('without an action every bone takes its rest matrix', () => {
    const s = buildSkeleton(f.bones)
    s.bones.get('child')!.matrix.makeScale(5, 5, 5)
    poseSkeleton(s, undefined, 3)
    expect(s.bones.get('child')!.matrix.equals(s.rel.get('child')!)).toBe(true)
    expect(s.bones.get('child')!.matrixWorldNeedsUpdate).toBe(true)
  })

  it('applies location, rotation (Blender XYZ = three ZYX) and scale on top of rest', () => {
    const s = buildSkeleton(f.bones)
    const wave = f.actions.get('emote_wave')!
    poseSkeleton(s, wave, 5)
    const m = s.bones.get('child')!.matrix
    expect(pos(m)).toEqual([0, 2, 0])
    const sc = new Vector3()
    const q = new Quaternion()
    m.decompose(new Vector3(), q, sc)
    expect(sc.x).toBeCloseTo(2)
    expect(sc.y).toBeCloseTo(1)
    // CONSTANT rotation stays at 0 until tick 20
    expect(q.angleTo(new Quaternion())).toBeCloseTo(0)
    poseSkeleton(s, wave, 20)
    const r = new Quaternion()
    s.bones.get('child')!.matrix.decompose(new Vector3(), r, new Vector3())
    expect(r.angleTo(new Quaternion().setFromEuler(new Euler(0, 0, 1.5, 'ZYX')))).toBeCloseTo(0)
    // bones without channels keep their rest
    expect(s.bones.get('root')!.matrix.equals(s.rel.get('root')!)).toBe(true)
  })

  it('combines rotations in ZYX order', () => {
    const s = buildSkeleton([{ name: 'b', parent: '', mat: new Matrix4() }])
    const ch = (axis: number, v: number) => ({ kind: 'rotation', axis, kfs: [kf(0, v)] })
    poseSkeleton(s, { name: 'a', length: 0, bones: new Map([['b', [ch(0, 0.3), ch(1, 0.5), ch(2, 0.7), { kind: 'location', axis: 0, kfs: [] }]]]) }, 0)
    const want = new Matrix4().makeRotationFromEuler(new Euler(0.3, 0.5, 0.7, 'ZYX'))
    const got = s.bones.get('b')!.matrix
    got.elements.forEach((e, i) => expect(e).toBeCloseTo(want.elements[i]!))
  })
})
