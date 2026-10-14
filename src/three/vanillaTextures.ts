// Stand-ins for the few vanilla Minecraft textures particles and morphs refer to (the game's own files can't be
// shipped): 16x16 seeded noise in the right palette, so dirt reads as dirt and snow as snow.

type Rgb = [number, number, number]

/** A small deterministic random sequence (same pixels every time). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function noise(g: OffscreenCanvasRenderingContext2D, palette: Rgb[], seed: number, y0 = 0, h = 16) {
  const r = rng(seed)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = 0; x < 16; x++) {
      const [cr, cg, cb] = palette[Math.floor(r() * palette.length)]!
      g.fillStyle = `rgb(${cr},${cg},${cb})`
      g.fillRect(x, y, 1, 1)
    }
  }
}

const DIRT: Rgb[] = [[134, 96, 67], [121, 85, 58], [150, 108, 74], [104, 72, 48], [185, 133, 92]]
const GRASS: Rgb[] = [[95, 159, 53], [84, 140, 47], [109, 175, 63], [73, 124, 40]]
const SNOW: Rgb[] = [[255, 255, 255], [240, 251, 251], [226, 242, 245], [248, 255, 255]]

const painters: Record<string, (g: OffscreenCanvasRenderingContext2D) => void> = {
  dirt: (g) => noise(g, DIRT, 11),
  snow: (g) => noise(g, SNOW, 23),
  grass_top: (g) => noise(g, GRASS, 37),
  grass_side: (g) => {
    noise(g, DIRT, 41)
    noise(g, GRASS, 43, 0, 3)
    // a ragged edge of grass hanging over the dirt
    const r = rng(47)
    for (let x = 0; x < 16; x++) if (r() < 0.5) noise(g, GRASS, 50 + x, 3, 1)
  },
  snowball: (g) => {
    // a round snowball on a transparent background
    const r = rng(53)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5
        const dy = y - 7.5
        if (dx * dx + dy * dy > 30) continue
        const [cr, cg, cb] = SNOW[Math.floor(r() * SNOW.length)]!
        const shade = dy > 2 ? 0.85 : 1
        g.fillStyle = `rgb(${cr * shade},${cg * shade},${cb * shade})`
        g.fillRect(x, y, 1, 1)
      }
    }
  },
}

/** The stand-in name for a vanilla texture reference (`minecraft:textures/blocks/dirt.png`, `snowball`, ...). */
export function vanillaName(ref: string): string | undefined {
  const base = ref.replace(/^minecraft:/, '').split('/').pop()!.replace(/\.png$/, '')
  if (base === 'grass' || base === 'grass_block') return 'grass_side'
  return base in painters ? base : undefined
}

/** A 16x16 stand-in image for a vanilla texture, or undefined when there is none. */
export function vanillaImage(ref: string): OffscreenCanvas | undefined {
  const name = vanillaName(ref)
  if (!name) return undefined
  const c = new OffscreenCanvas(16, 16)
  const g = c.getContext('2d')
  if (!g) return undefined
  painters[name]!(g)
  return c
}
