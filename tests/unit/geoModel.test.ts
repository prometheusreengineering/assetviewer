import { DoubleSide, Group, Mesh, MeshLambertMaterial, NearestFilter, LinearMipmapLinearFilter, SRGBColorSpace, Texture, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCube, buildGeoModel, buildGeoRig, createMaterial, createTexture, faceRects, rotationOf, type GeoCube, type GeoFile } from '../../src/three/geoModel'

const DEG = Math.PI / 180
const mat = () => new MeshLambertMaterial()
const cube = (c: Partial<GeoCube>): GeoCube => ({ origin: [0, 0, 0], size: [2, 3, 4], ...c })
/** UV pairs of one BoxGeometry face (4 vertices) in px. */
const faceUv = (m: Mesh, face: number, texW = 64, texH = 64) => {
  const uv = m.geometry.getAttribute('uv').array
  return Array.from({ length: 4 }, (_, k) => [Math.round(uv[(face * 4 + k) * 2]! * texW * 1000) / 1000, Math.round(uv[(face * 4 + k) * 2 + 1]! * texH * 1000) / 1000])
}

describe('faceRects', () => {
  it('box UV layout (Java/Bedrock): north at (u+d, v+d)', () => {
    const r = faceRects(cube({ uv: [10, 20] }))
    // w=2 h=3 d=4
    expect(r.north).toEqual([14, 24, 2, 3])
    expect(r.east).toEqual([10, 24, 4, 3])
    expect(r.south).toEqual([20, 24, 2, 3])
    expect(r.west).toEqual([16, 24, 4, 3])
    expect(r.up).toEqual([14, 20, 2, 4])
    expect(r.down).toEqual([16, 24, 2, -4])
  })
  it('floors fractional sizes and uses absolute values', () => {
    expect(faceRects(cube({ size: [-2.7, 3.2, 4.9], uv: [0, 0] })).north).toEqual([4, 4, 2, 3])
  })
  it('mirror flips every face horizontally and swaps east/west', () => {
    const plain = faceRects(cube({ uv: [10, 20] }))
    const m = faceRects(cube({ uv: [10, 20], mirror: true }))
    expect(m.north).toEqual([16, 24, -2, 3])
    expect(m.east).toEqual([plain.west[0] + plain.west[2], 24, -4, 3])
    expect(m.west).toEqual([plain.east[0] + plain.east[2], 24, -4, 3])
  })
  it('per-face UV, missing faces and uv_size are left out / zero', () => {
    const r = faceRects(cube({ uv: { north: { uv: [1, 2], uv_size: [3, 4] }, up: { uv: [5, 6] } } }))
    expect(r.north).toEqual([1, 2, 3, 4])
    expect(r.up).toEqual([5, 6, 0, 0])
    expect(r.south).toBeUndefined()
  })
  it('no uv at all gives no faces', () => {
    expect(faceRects(cube({}))).toEqual({})
  })
})

describe('buildCube', () => {
  it('sizes the box with a per-index inflate step that repeats every 40 cubes', () => {
    const size = (i: number, inflate?: number) => {
      const m = buildCube(cube({ uv: [0, 0], inflate }), 64, 64, mat(), i, false)
      m.geometry.computeBoundingBox()
      return m.geometry.boundingBox!.getSize(new Vector3()).toArray().map((n) => Math.round(n * 1000) / 1000)
    }
    expect(size(0)).toEqual([2, 3, 4])
    expect(size(1)).toEqual([2.016, 3.016, 4.016])
    expect(size(40)).toEqual([2, 3, 4])
    expect(size(0, 0.5)).toEqual([3, 4, 5])
  })
  it('negative sizes build the same positive box', () => {
    const m = buildCube(cube({ size: [-2, 3, -4], uv: [0, 0] }), 64, 64, mat(), 0, false)
    m.geometry.computeBoundingBox()
    expect(m.geometry.boundingBox!.getSize(new Vector3()).toArray()).toEqual([2, 3, 4])
  })
  it('keeps all 6 faces for a full box, in three.js order +x -x +y -y +z -z', () => {
    const m = buildCube(cube({ uv: [10, 20] }), 64, 64, mat(), 0, false)
    expect(m.geometry.getIndex()!.count).toBe(36)
    // +z = south: TL, TR, BL, BR
    expect(faceUv(m, 4)).toEqual([[20, 24], [22, 24], [20, 27], [22, 27]])
    // +x = east
    expect(faceUv(m, 0)).toEqual([[10, 24], [14, 24], [10, 27], [14, 27]])
    expect(m.geometry.groups).toEqual([])
  })
  it('drops faces without texture area (edges of flat planes)', () => {
    const flat = buildCube(cube({ size: [4, 4, 0], uv: [0, 0] }), 64, 64, mat(), 0, false)
    // d = 0: east, west, up, down have no area; north and south remain
    expect(flat.geometry.getIndex()!.count).toBe(12)
    const partial = buildCube(cube({ uv: { north: { uv: [0, 0], uv_size: [2, 3] } } }), 64, 64, mat(), 0, false)
    expect(partial.geometry.getIndex()!.count).toBe(6)
  })
  it('flipU mirrors each face texture in place', () => {
    const m = buildCube(cube({ uv: [10, 20] }), 64, 64, mat(), 0, true)
    expect(faceUv(m, 4)).toEqual([[22, 24], [20, 24], [22, 27], [20, 27]])
  })
})

describe('rotationOf', () => {
  it('converts Bedrock degrees to a ZYX Euler with x and z mirrored', () => {
    const e = rotationOf([10, 20, 30])
    expect([e.x, e.y, e.z].map((n) => n / DEG).map((n) => Math.round(n))).toEqual([-10, 20, -30])
    expect(e.order).toBe('ZYX')
    expect(rotationOf().toArray()).toEqual(new Group().rotation.toArray())
  })
})

describe('buildGeoRig', () => {
  const GEO: GeoFile = {
    'minecraft:geometry': [
      {
        description: { texture_width: 32, texture_height: 32 },
        bones: [
          { name: 'root', pivot: [0, 0, 0] },
          { name: 'arm', parent: 'root', pivot: [4, 10, 0], rotation: [0, 0, 45], mirror: true, cubes: [{ origin: [4, 8, -1], size: [2, 4, 2], uv: [0, 0] }] },
          { name: 'hand', parent: 'arm', pivot: [5, 6, 0], cubes: [{ origin: [4, 4, -1], size: [2, 2, 2], uv: [8, 0], pivot: [5, 5, 0], rotation: [90, 0, 0] }] },
          { name: 'sword', parent: 'armorRightArm', pivot: [1, 2, 3] },
        ],
      },
    ],
  }
  const { root, bones } = buildGeoRig(GEO, mat())

  it('builds bone groups at parent-relative pivots, scaled to blocks', () => {
    expect(root.scale.toArray()).toEqual([1 / 16, 1 / 16, 1 / 16])
    expect([...bones.keys()]).toEqual(['root', 'arm', 'hand', 'sword'])
    const arm = bones.get('arm')!
    expect(arm.group.parent).toBe(bones.get('root')!.group)
    expect(arm.basePos).toEqual([4, 10, 0])
    expect(arm.baseRot).toEqual([0, 0, 45])
    expect(arm.group.rotation.z).toBeCloseTo(-45 * DEG)
    expect(bones.get('hand')!.basePos).toEqual([1, -4, 0])
    expect(bones.get('root')!.baseRot).toEqual([0, 0, 0])
  })
  it('places cubes at their center relative to the bone pivot', () => {
    const arm = bones.get('arm')!.group
    const mesh = arm.children.find((c) => c instanceof Mesh) as Mesh
    expect(mesh.position.toArray()).toEqual([1, 0, 0])
  })
  it('rotated cubes sit in a holder at the cube pivot', () => {
    const hand = bones.get('hand')!.group
    const holder = hand.children.find((c) => c instanceof Group && c.children[0] instanceof Mesh)!
    expect(holder.position.toArray()).toEqual([0, -1, 0])
    expect(holder.rotation.x).toBeCloseTo(-90 * DEG)
    expect(holder.children[0]!.position.toArray()).toEqual([0, 0, 0])
  })
  it('a bone with an unknown parent is a root that remembers the parent name', () => {
    const sword = bones.get('sword')!.group
    expect(sword.parent).toBe(root)
    expect(sword.userData.missingParent).toBe('armorRightArm')
    expect(bones.get('root')!.group.parent).toBe(root)
  })
  it('a bone mirror applies to cubes without their own mirror flag', () => {
    const arm = bones.get('arm')!.group
    const mesh = arm.children.find((c) => c instanceof Mesh) as Mesh
    // mirrored north (+z is south; -z north = face 5): u runs right to left
    const uv = mesh.geometry.getAttribute('uv').array
    expect(uv[5 * 8]! * 32).toBeCloseTo(4)
    expect(uv[5 * 8 + 2]! * 32).toBeCloseTo(2)
  })
  it('defaults the texture size to 16 and buildGeoModel returns the root', () => {
    const g: GeoFile = { 'minecraft:geometry': [{ description: {}, bones: [{ name: 'b', cubes: [{ origin: [0, 0, 0], size: [16, 16, 16], uv: [0, 0] }] }] }] }
    const m = buildGeoModel(g, mat())
    const mesh = m.children[0]!.children[0] as Mesh
    const uv = mesh.geometry.getAttribute('uv').array
    // north face u from 16..32 px on a 16 px texture
    expect(uv[5 * 8]).toBeCloseTo(1)
    expect(uv[5 * 8 + 2]).toBeCloseTo(2)
  })
})

describe('createTexture / createMaterial', () => {
  it('texture: no flip, sRGB, crisp magnification, mipmapped minification', () => {
    const t = createTexture({ width: 4, height: 4 } as ImageBitmap)
    expect(t.flipY).toBe(false)
    expect(t.colorSpace).toBe(SRGBColorSpace)
    expect(t.magFilter).toBe(NearestFilter)
    expect(t.minFilter).toBe(LinearMipmapLinearFilter)
    expect(t.generateMipmaps).toBe(true)
    expect(t.anisotropy).toBe(8)
    expect(t.version).toBeGreaterThan(0)
  })
  it('material: cut-out alpha, double sided, polygon offset', () => {
    const map = new Texture()
    const m = createMaterial(map)
    expect(m.map).toBe(map)
    expect(m.alphaTest).toBe(0.3)
    expect(m.alphaToCoverage).toBe(true)
    expect(m.side).toBe(DoubleSide)
    expect(m.polygonOffset).toBe(true)
    expect(m.polygonOffsetFactor).toBe(1)
    expect(m.polygonOffsetUnits).toBe(1)
  })
  it('patches the shaders: centroid UVs and full-resolution alpha', () => {
    const m = createMaterial(new Texture())
    const shader = {
      vertexShader: 'a\n#include <uv_pars_vertex>\nb',
      fragmentShader: '#include <uv_pars_fragment>\nmain\n#include <map_fragment>\nend',
    }
    m.onBeforeCompile(shader as never, undefined as never)
    expect(shader.vertexShader).toContain('centroid varying vec2 vMapUv')
    expect(shader.vertexShader).not.toContain('#include <uv_pars_vertex>')
    expect(shader.fragmentShader).toContain('centroid varying vec2 vMapUv')
    expect(shader.fragmentShader).toContain('#include <map_fragment>')
    expect(shader.fragmentShader).toMatch(/texelFetch\(map, .*, 0\)\.a/)
    expect(shader.fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(shader.fragmentShader.indexOf('texelFetch'))
  })
})
