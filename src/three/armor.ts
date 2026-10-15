// Stand-in armor for the outfit builder (Mojang's armor textures can't be shipped): vanilla's armor boxes
// (helmet and chestplate inflated 1 px, leggings 0.5 px, boots 1 px) in a drawn iron-grey plate texture. The
// bones are Essential's player parts under `root`, so it is dressed like an Essential cosmetic.
import type { GeoFile } from './geoModel'

export type ArmorPiece = 'helmet' | 'chestplate' | 'leggings' | 'boots'

type Cube = { origin: [number, number, number]; size: [number, number, number]; uv: [number, number]; inflate: number }
const W = 64
const H = 64

/** The cubes of each piece per player part (Bedrock px, y up). */
const PIECES: Record<ArmorPiece, Record<string, Cube[]>> = {
  helmet: { head: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 1 }] },
  chestplate: {
    body: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], inflate: 1 }],
    arm_right: [{ origin: [-8, 15, -2], size: [4, 9, 4], uv: [40, 16], inflate: 1 }],
    arm_left: [{ origin: [4, 15, -2], size: [4, 9, 4], uv: [40, 16], inflate: 1 }],
  },
  leggings: {
    body: [{ origin: [-4, 12, -2], size: [8, 3, 4], uv: [16, 32], inflate: 0.5 }],
    leg_right: [{ origin: [-3.9, 3, -2], size: [4, 9, 4], uv: [0, 32], inflate: 0.5 }],
    leg_left: [{ origin: [-0.1, 3, -2], size: [4, 9, 4], uv: [0, 32], inflate: 0.5 }],
  },
  boots: {
    leg_right: [{ origin: [-3.9, 0, -2], size: [4, 4, 4], uv: [0, 48], inflate: 1 }],
    leg_left: [{ origin: [-0.1, 0, -2], size: [4, 4, 4], uv: [0, 48], inflate: 1 }],
  },
}
// Essential's part pivots (geometry.steve.json).
const PIVOTS: Record<string, [number, number, number]> = {
  head: [0, 24, 0],
  body: [0, 24, 0],
  arm_right: [-5, 22, 0],
  arm_left: [5, 22, 0],
  leg_right: [-1.9, 12, 0],
  leg_left: [1.9, 12, 0],
}

/** Geometry of the given armor pieces. */
export function armorGeo(pieces: ArmorPiece[]): GeoFile {
  const parts = new Map<string, Cube[]>()
  for (const p of pieces) for (const [part, cubes] of Object.entries(PIECES[p])) parts.set(part, [...(parts.get(part) ?? []), ...cubes])
  const bones = [{ name: 'root', pivot: [0, 0, 0] }, ...[...parts].map(([name, cubes]) => ({ name, parent: 'root', pivot: PIVOTS[name], cubes }))]
  return { 'minecraft:geometry': [{ description: { texture_width: W, texture_height: H }, bones }] } as unknown as GeoFile
}

/** Box-UV face rectangles of a cube (x, y, w, h in texture px). */
function faces(c: Cube): [number, number, number, number][] {
  const [u, v] = c.uv
  const [w, h, d] = c.size.map(Math.ceil) as [number, number, number]
  return [
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u, v + d, d, h],
    [u + d, v + d, w, h],
    [u + d + w, v + d, d, h],
    [u + d + w + d, v + d, w, h],
  ]
}

/** Iron-grey plates: seeded noise with a darker rim on every face, so the pieces read as armor. */
export function armorTexture(): OffscreenCanvas {
  const c = new OffscreenCanvas(W, H)
  const g = c.getContext('2d')
  if (!g) return c
  let s = 7
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const cubes = Object.values(PIECES).flatMap((p) => Object.values(p).flat())
  const done = new Set<string>()
  for (const cube of cubes) {
    for (const [x, y, w, h] of faces(cube)) {
      const key = `${x},${y},${w},${h}`
      if (done.has(key)) continue
      done.add(key)
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          const rim = px === x || py === y || px === x + w - 1 || py === y + h - 1
          const v = rim ? 105 + r() * 20 : 185 + r() * 40
          g.fillStyle = `rgb(${v},${v},${v + 6})`
          g.fillRect(px, py, 1, 1)
        }
      }
    }
  }
  return c
}
