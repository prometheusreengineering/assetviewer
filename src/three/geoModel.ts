import {
  BoxGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  LinearMipmapLinearFilter,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  Texture,
} from 'three'

interface FaceUv {
  uv: [number, number]
  uv_size?: [number, number]
}
interface GeoCube {
  origin: [number, number, number]
  size: [number, number, number]
  inflate?: number
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  mirror?: boolean
  uv?: [number, number] | Partial<Record<'north' | 'south' | 'east' | 'west' | 'up' | 'down', FaceUv>>
}
interface GeoBone {
  name: string
  parent?: string
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  mirror?: boolean
  cubes?: GeoCube[]
}
export interface GeoFile {
  'minecraft:geometry': {
    description: { texture_width?: number; texture_height?: number }
    bones: GeoBone[]
  }[]
}

const DEG = Math.PI / 180
// Three.js BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'] as const
type Face = (typeof FACE_ORDER)[number]

export function createTexture(bitmap: ImageBitmap): Texture {
  const tex = new Texture(bitmap as unknown as HTMLImageElement)
  tex.flipY = false
  tex.colorSpace = SRGBColorSpace
  // Crisp pixels up close, mipmapped when minified so spinning cards don't shimmer.
  tex.magFilter = NearestFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

export function createMaterial(map: Texture) {
  return new MeshLambertMaterial({ map, alphaTest: 0.3, alphaToCoverage: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
}

function faceRects(cube: GeoCube): Record<Face, [number, number, number, number]> {
  const [w, h, d] = cube.size.map((n) => Math.floor(Math.abs(n))) as [number, number, number]
  const rects = {} as Record<Face, [number, number, number, number]>
  if (Array.isArray(cube.uv)) {
    const [u, v] = cube.uv
    rects.north = [u + d, v + d, w, h]
    rects.east = [u, v + d, d, h]
    rects.south = [u + d + w + d, v + d, w, h]
    rects.west = [u + d + w, v + d, d, h]
    rects.up = [u + d, v, w, d]
    rects.down = [u + d + w, v + d, w, -d]
    if (cube.mirror) {
      for (const f of Object.keys(rects) as Face[]) {
        const [fu, fv, fw, fh] = rects[f]
        rects[f] = [fu + fw, fv, -fw, fh]
      }
      ;[rects.east, rects.west] = [rects.west, rects.east]
    }
  } else if (cube.uv) {
    for (const f of FACE_ORDER) {
      const fu = cube.uv[f]
      if (fu) rects[f] = [fu.uv[0], fu.uv[1], fu.uv_size?.[0] ?? 0, fu.uv_size?.[1] ?? 0]
    }
  }
  return rects
}

// Coplanar faces from overlapping cubes z-fight; a tiny per-cube growth breaks the tie deterministically.
function buildCube(cube: GeoCube, texW: number, texH: number, material: MeshLambertMaterial, index: number): Mesh {
  const inf = (cube.inflate ?? 0) + (index % 40) * 0.008
  // Some models mirror a cube by giving it negative sizes (paired with a plain copy for two-sided faces); a
  // negative BoxGeometry would put every face texture on the opposite side, leaving sides see-through.
  const geo = new BoxGeometry(Math.abs(cube.size[0]) + inf * 2, Math.abs(cube.size[1]) + inf * 2, Math.abs(cube.size[2]) + inf * 2)
  const rects = faceRects(cube)
  const uvs: number[] = []
  const faces = geo.getIndex()!
  const keep: number[] = []
  FACE_ORDER.forEach((f, i) => {
    const r = rects[f]
    // Faces without texture area (the edges of flat planes, faces the model leaves out) are dropped: drawn,
    // they sample one texel and outline every flat part with a hairline once the cube is inflated.
    if (!r || !r[2] || !r[3]) {
      uvs.push(0, 0, 0, 0, 0, 0, 0, 0)
      return
    }
    const [u, v, w, h] = r
    // vertex order per face as seen from outside: TL, TR, BL, BR
    uvs.push(u / texW, v / texH, (u + w) / texW, v / texH, u / texW, (v + h) / texH, (u + w) / texW, (v + h) / texH)
    for (let k = 0; k < 6; k++) keep.push(faces.getX(i * 6 + k))
  })
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(keep)
  geo.clearGroups()
  return new Mesh(geo, material)
}

export function rotationOf(rot?: [number, number, number]): Euler {
  // Bedrock rotates ZYX; X and Z are mirrored relative to three.js.
  return rot ? new Euler(-rot[0] * DEG, rot[1] * DEG, -rot[2] * DEG, 'ZYX') : new Euler()
}

export interface Bone {
  group: Group
  baseRot: [number, number, number]
  basePos: [number, number, number]
}

/** Builds a three.js object from a Bedrock `minecraft:geometry` model (units: 1/16 block, scaled to blocks). */
export function buildGeoModel(geo: GeoFile, material: MeshLambertMaterial): Object3D {
  return buildGeoRig(geo, material).root
}

/** Like buildGeoModel, but also returns the bone groups so they can be animated. */
export function buildGeoRig(geo: GeoFile, material: MeshLambertMaterial): { root: Object3D; bones: Map<string, Bone> } {
  const g = geo['minecraft:geometry'][0]
  const texW = g.description.texture_width ?? 16
  const texH = g.description.texture_height ?? 16

  const groups = new Map<string, Group>()
  const pivots = new Map<string, [number, number, number]>()
  for (const bone of g.bones) {
    const group = new Group()
    group.name = bone.name
    groups.set(bone.name, group)
    pivots.set(bone.name, bone.pivot ?? [0, 0, 0])
  }

  let cubeIndex = 0
  const root = new Group()
  const bones = new Map<string, Bone>()
  for (const bone of g.bones) {
    const group = groups.get(bone.name)!
    const pivot = pivots.get(bone.name)!
    const parentPivot = (bone.parent && pivots.get(bone.parent)) || [0, 0, 0]
    group.position.set(pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2])
    group.rotation.copy(rotationOf(bone.rotation))
    bones.set(bone.name, {
      group,
      baseRot: bone.rotation ?? [0, 0, 0],
      basePos: [group.position.x, group.position.y, group.position.z],
    })
    ;(bone.parent ? groups.get(bone.parent) : undefined)?.add(group)
    if (!bone.parent || !groups.has(bone.parent)) root.add(group)
    // Some models parent bones to one they don't define (e.g. a sword under "armorRightArm"); keep the name for dressing.
    if (bone.parent && !groups.has(bone.parent)) group.userData.missingParent = bone.parent

    for (const cube of bone.cubes ?? []) {
      const mesh = buildCube(cube.mirror === undefined && bone.mirror ? { ...cube, mirror: true } : cube, texW, texH, material, cubeIndex++)
      const center = [
        cube.origin[0] + cube.size[0] / 2,
        cube.origin[1] + cube.size[1] / 2,
        cube.origin[2] + cube.size[2] / 2,
      ]
      if (cube.rotation) {
        const cp = cube.pivot ?? [0, 0, 0]
        const holder = new Group()
        holder.position.set(cp[0] - pivot[0], cp[1] - pivot[1], cp[2] - pivot[2])
        holder.rotation.copy(rotationOf(cube.rotation))
        mesh.position.set(center[0] - cp[0], center[1] - cp[1], center[2] - cp[2])
        holder.add(mesh)
        group.add(holder)
      } else {
        mesh.position.set(center[0] - pivot[0], center[1] - pivot[1], center[2] - pivot[2])
        group.add(mesh)
      }
    }
  }
  root.scale.setScalar(1 / 16)
  return { root, bones }
}
