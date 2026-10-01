import { ref, watch } from 'vue'

// Player skin used by emotes and the player previews. The default skin isn't on the Lunar CDN, so a
// placeholder is drawn here; a Minecraft username loads that player's skin from mc-heads.net (CORS *).
const KEY = 'assetviewer.skin'
let saved = ''
try {
  saved = localStorage.getItem(KEY) ?? ''
} catch {}
export const skinName = ref(saved)
watch(skinName, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {}
})

type Rect = [number, number, number, number]
function fill(g: OffscreenCanvasRenderingContext2D, color: string, ...rects: Rect[]) {
  g.fillStyle = color
  for (const r of rects) g.fillRect(...r)
}

/** A plain 64x64 skin in the standard layout: skin tone, hair, eyes, shirt, trousers, shoes. */
function placeholder(): OffscreenCanvas {
  const c = new OffscreenCanvas(64, 64)
  const g = c.getContext('2d')!
  const skin = '#c69c7b'
  const hair = '#3b2a1e'
  const shirt = '#2f8f8a'
  const pants = '#3a4a8c'
  const shoes = '#555'
  // head (base layer)
  fill(g, skin, [0, 8, 32, 8], [8, 0, 16, 8])
  fill(g, hair, [8, 0, 8, 8], [0, 8, 32, 2], [24, 8, 8, 8], [16, 0, 8, 8])
  fill(g, '#fff', [9, 12, 2, 1], [13, 12, 2, 1])
  fill(g, '#3b5fa8', [10, 12, 1, 1], [13, 12, 1, 1])
  fill(g, '#8a5a44', [11, 14, 2, 1])
  // body, arms (right at 40,16; left at 32,48), legs (right at 0,16; left at 16,48)
  fill(g, shirt, [16, 16, 24, 16], [40, 16, 16, 16], [32, 48, 16, 16])
  fill(g, skin, [40, 26, 16, 6], [44, 16, 4, 4], [32, 58, 16, 6], [36, 48, 4, 4])
  fill(g, pants, [0, 16, 16, 16], [16, 48, 16, 16])
  fill(g, shoes, [0, 29, 16, 3], [16, 61, 16, 3], [8, 16, 4, 4], [24, 48, 4, 4])
  return c
}

const cache = new Map<string, Promise<ImageBitmap>>()

/** The skin bitmap for `name` (placeholder if empty or the lookup fails); legacy 64x32 skins are expanded. */
export function skinBitmap(name = skinName.value.trim()): Promise<ImageBitmap> {
  let p = cache.get(name)
  if (!p) {
    p = (async () => {
      if (!name) return createImageBitmap(placeholder())
      try {
        const res = await fetch(`https://mc-heads.net/skin/${encodeURIComponent(name)}`)
        if (!res.ok) throw new Error(String(res.status))
        const img = await createImageBitmap(await res.blob())
        if (img.height >= 64) return img
        // Old 64x32 skins: the left limbs reuse the right ones.
        const c = new OffscreenCanvas(64, 64)
        const g = c.getContext('2d')!
        g.drawImage(img, 0, 0)
        g.drawImage(img, 0, 16, 16, 16, 16, 48, 16, 16)
        g.drawImage(img, 40, 16, 16, 16, 32, 48, 16, 16)
        return createImageBitmap(c)
      } catch (e) {
        console.warn('skin lookup failed', name, e)
        cache.delete(name)
        return createImageBitmap(placeholder())
      }
    })()
    cache.set(name, p)
  }
  return p
}
