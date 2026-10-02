// McHorse "Blockbuster OBJ" (.bobj), the format of Lunar emotes: an OBJ with an armature, per-vertex bone
// weights and keyframed actions. Coordinates are Minecraft-style (Y up, 1 unit = 1 block).
import { Bone, BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Material } from 'three'

export interface BobjBone {
  name: string
  parent: string
  /** Rest matrix of the bone head in armature space. */
  mat: Matrix4
}

export interface BobjMesh {
  name: string
  pos: number[]
  uv: number[]
  normal: number[]
  /** Per emitted vertex: [bone, weight] pairs. */
  weights: [string, number][][]
}

export interface Kf {
  t: number
  v: number
  interp: string
  lx: number
  ly: number
  rx: number
  ry: number
}
interface Channel {
  kind: string
  axis: number
  kfs: Kf[]
}
export interface BobjAction {
  name: string
  /** Last keyframe tick. */
  length: number
  bones: Map<string, Channel[]>
}

export interface BobjFile {
  bones: BobjBone[]
  meshes: Map<string, BobjMesh>
  actions: Map<string, BobjAction>
}

export function parseBobj(text: string): BobjFile {
  const bones: BobjBone[] = []
  const meshes = new Map<string, BobjMesh>()
  const actions = new Map<string, BobjAction>()
  // OBJ indices are file-wide, so vertex data is collected globally.
  const V: number[] = []
  const VW: [string, number][][] = []
  const VT: number[] = []
  const VN: number[] = []
  let mesh: BobjMesh | undefined
  let action: BobjAction | undefined
  let channels: Channel[] | undefined
  let kfs: Kf[] | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const sp = line.indexOf(' ')
    const key = sp < 0 ? line : line.slice(0, sp)
    switch (key) {
      case 'v': {
        const [, x, y, z] = line.split(' ')
        V.push(+x!, +y!, +z!)
        VW.push([])
        break
      }
      case 'vw': {
        const [, b, w] = line.split(' ')
        VW[VW.length - 1]!.push([b!, +w!])
        break
      }
      case 'vt': {
        const [, u, v] = line.split(' ')
        VT.push(+u!, +v!)
        break
      }
      case 'vn': {
        const [, x, y, z] = line.split(' ')
        VN.push(+x!, +y!, +z!)
        break
      }
      case 'o':
        mesh = { name: line.slice(2).trim(), pos: [], uv: [], normal: [], weights: [] }
        meshes.set(mesh.name, mesh)
        break
      case 'f': {
        if (!mesh) break
        const corners = line.slice(2).trim().split(/\s+/).map((c) => c.split('/').map((n) => (n ? Number(n) - 1 : -1)))
        // Triangles in practice; larger polygons are fanned.
        for (let i = 1; i + 1 < corners.length; i++) {
          for (const [vi, ti, ni] of [corners[0]!, corners[i]!, corners[i + 1]!]) {
            mesh.pos.push(V[vi! * 3]!, V[vi! * 3 + 1]!, V[vi! * 3 + 2]!)
            // OBJ v points up; the textures are uploaded without a flip.
            mesh.uv.push(ti! >= 0 ? VT[ti! * 2]! : 0, ti! >= 0 ? 1 - VT[ti! * 2 + 1]! : 0)
            mesh.normal.push(ni! >= 0 ? VN[ni! * 3]! : 0, ni! >= 0 ? VN[ni! * 3 + 1]! : 1, ni! >= 0 ? VN[ni! * 3 + 2]! : 0)
            mesh.weights.push(VW[vi!] ?? [])
          }
        }
        break
      }
      case 'arm_bone': {
        // `arm_bone name parent tx ty tz m00..m33`; the parent is empty for roots (double space).
        const t = line.split(' ')
        const n = t.slice(3).filter((x) => x !== '').map(Number)
        const m = n.slice(3, 19) as Parameters<Matrix4['set']>
        bones.push({ name: t[1]!, parent: t[2] ?? '', mat: new Matrix4().set(...m) })
        break
      }
      case 'an':
        action = { name: line.slice(3).trim(), length: 0, bones: new Map() }
        actions.set(action.name, action)
        break
      case 'ao':
        channels = []
        action?.bones.set(line.slice(3).trim(), channels)
        break
      case 'ag': {
        const [, kind, axis] = line.split(' ')
        kfs = []
        channels?.push({ kind: kind!, axis: Number(axis), kfs })
        break
      }
      case 'kf': {
        const [, t, v, interp, lx, ly, rx, ry] = line.split(' ')
        kfs?.push({ t: +t!, v: +v!, interp: interp ?? 'LINEAR', lx: +(lx ?? t!), ly: +(ly ?? v!), rx: +(rx ?? t!), ry: +(ry ?? v!) })
        if (action && +t! > action.length) action.length = +t!
        break
      }
    }
  }
  return { bones, meshes, actions }
}

/** Only the `an <name>` block of a (large) actions file, so the rest isn't parsed. */
export function extractAction(text: string, name: string): string | undefined {
  const head = `\nan ${name}\n`
  const start = text.indexOf(head)
  if (start < 0) return undefined
  const end = text.indexOf('\nan ', start + head.length)
  return text.slice(start + 1, end < 0 ? text.length : end + 1)
}

/** Names of all actions in an actions file. */
export function actionNames(text: string): string[] {
  return [...text.matchAll(/^an (\S+)/gm)].map((m) => m[1]!)
}

export interface BobjSkeleton {
  skeleton: Skeleton
  bones: Map<string, Bone>
  /** Bone rest transform relative to its parent. */
  rel: Map<string, Matrix4>
  roots: Bone[]
}

export function buildSkeleton(armature: BobjBone[]): BobjSkeleton {
  const bones = new Map<string, Bone>()
  const rel = new Map<string, Matrix4>()
  const mats = new Map(armature.map((b) => [b.name, b.mat]))
  const list: Bone[] = []
  const inverses: Matrix4[] = []
  for (const b of armature) {
    const bone = new Bone()
    bone.name = b.name
    // Poses are written straight into bone.matrix (see BobjAnimator).
    bone.matrixAutoUpdate = false
    const parent = b.parent ? mats.get(b.parent) : undefined
    const r = parent ? parent.clone().invert().multiply(b.mat) : b.mat.clone()
    rel.set(b.name, r)
    bone.matrix.copy(r)
    bones.set(b.name, bone)
    list.push(bone)
    inverses.push(b.mat.clone().invert())
  }
  const roots: Bone[] = []
  for (const b of armature) {
    const parent = b.parent ? bones.get(b.parent) : undefined
    if (parent) parent.add(bones.get(b.name)!)
    else roots.push(bones.get(b.name)!)
  }
  return { skeleton: new Skeleton(list, inverses), bones, rel, roots }
}

/** A skinned mesh bound to `skel`; vertices keep their four strongest weights. */
export function skinnedMesh(m: BobjMesh, skel: BobjSkeleton, material: Material): SkinnedMesh {
  const index = new Map(skel.skeleton.bones.map((b, i) => [b.name, i]))
  const n = m.weights.length
  const si = new Uint16Array(n * 4)
  const sw = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const ws = m.weights[i]!.filter(([b]) => index.has(b)).sort((a, b) => b[1] - a[1]).slice(0, 4)
    const sum = ws.reduce((s, [, w]) => s + w, 0)
    if (!ws.length || sum <= 0) {
      sw[i * 4] = 1
      continue
    }
    ws.forEach(([b, w], k) => {
      si[i * 4 + k] = index.get(b)!
      sw[i * 4 + k] = w / sum
    })
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(m.pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(m.uv, 2))
  g.setAttribute('normal', new Float32BufferAttribute(m.normal, 3))
  g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4))
  const mesh = new SkinnedMesh(g, material)
  mesh.name = m.name
  // Animated limbs leave the rest-pose bounds.
  mesh.frustumCulled = false
  mesh.bind(skel.skeleton, new Matrix4())
  return mesh
}

export function cubic(a: number, b: number, c: number, d: number, s: number) {
  const u = 1 - s
  return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d
}

export function evalChannel(k: Kf[], t: number): number {
  const first = k[0]!
  const last = k[k.length - 1]!
  if (t <= first.t) return first.v
  if (t >= last.t) return last.v
  let lo = 0
  let hi = k.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (k[mid]!.t <= t) lo = mid
    else hi = mid
  }
  const a = k[lo]!
  const b = k[hi]!
  const x = (t - a.t) / (b.t - a.t)
  switch (a.interp) {
    case 'CONSTANT':
      return a.v
    case 'LINEAR':
      return a.v + (b.v - a.v) * x
    case 'SINE':
      return a.v + ((b.v - a.v) * (1 - Math.cos(Math.PI * x))) / 2
    default: {
      // Blender bezier: solve the curve's x for t, then read its y.
      const x1 = Math.min(Math.max(a.rx, a.t), b.t)
      const x2 = Math.min(Math.max(b.lx, a.t), b.t)
      let s0 = 0
      let s1 = 1
      let s = x
      for (let i = 0; i < 24; i++) {
        s = (s0 + s1) / 2
        if (cubic(a.t, x1, x2, b.t, s) < t) s0 = s
        else s1 = s
      }
      return cubic(a.v, a.ry, b.ly, b.v, s)
    }
  }
}

const _t = new Vector3()
const _s = new Vector3()
const _q = new Quaternion()
const _e = new Euler()
const _m = new Matrix4()

/** Poses a skeleton from a Blockbuster action: bone = rest · T(location) · R(euler XYZ) · S(scale). */
export function poseSkeleton(skel: BobjSkeleton, action: BobjAction | undefined, tick: number) {
  for (const [name, bone] of skel.bones) {
    const rest = skel.rel.get(name)!
    const chans = action?.bones.get(name)
    if (!chans) {
      bone.matrix.copy(rest)
    } else {
      const loc = [0, 0, 0]
      const rot = [0, 0, 0]
      const scl = [1, 1, 1]
      for (const c of chans) {
        if (!c.kfs.length) continue
        const v = evalChannel(c.kfs, tick)
        if (c.kind === 'location') loc[c.axis] = v
        else if (c.kind === 'rotation') rot[c.axis] = v
        else if (c.kind === 'scale') scl[c.axis] = v
      }
      // Blender's XYZ euler applies X first, which is three's 'ZYX' order.
      _q.setFromEuler(_e.set(rot[0]!, rot[1]!, rot[2]!, 'ZYX'))
      _m.compose(_t.set(loc[0]!, loc[1]!, loc[2]!), _q, _s.set(scl[0]!, scl[1]!, scl[2]!))
      bone.matrix.multiplyMatrices(rest, _m)
    }
    bone.matrixWorldNeedsUpdate = true
  }
}
