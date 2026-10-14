import { singleFrame, type FrameLayout } from './rig'

/** Fewest frames worth keeping before frames are scaled down instead of dropped. */
const MIN_FRAMES = 32

export interface AtlasPlan {
  cols: number
  rows: number
  /** Cell size in px (frames scaled by powers of two when they don't fit). */
  cellW: number
  cellH: number
  /** Source frame index shown in each cell. */
  picks: number[]
}

/**
 * Packs `count` frames of `frameW` x `frameH` into a grid no larger than `maxSide` square. Every frame is kept
 * when they fit; otherwise frames are sampled evenly in order, and halved in size while fewer than
 * MIN_FRAMES would fit (a cloak is 352x272 per frame, a trim texture has 3000 frames).
 */
export function atlasLayout(frameW: number, frameH: number, count: number, maxSide = 1024): AtlasPlan {
  const cell = (s: number) => [Math.max(1, Math.round(frameW * s)), Math.max(1, Math.round(frameH * s))] as const
  const fits = (s: number) => {
    const [w, h] = cell(s)
    return Math.floor(maxSide / w) * Math.floor(maxSide / h)
  }
  let scale = 1
  const want = Math.min(count, MIN_FRAMES)
  while (fits(scale) < want && scale > 1 / 64) scale /= 2
  const [cellW, cellH] = cell(scale)
  const n = Math.max(1, Math.min(count, fits(scale)))
  const cols = Math.max(1, Math.min(n, Math.floor(maxSide / cellW)))
  const rows = Math.ceil(n / cols)
  const picks = Array.from({ length: n }, (_, i) => Math.floor((i * count) / n))
  return { cols, rows, cellW, cellH, picks }
}

export interface DecodedImage {
  bitmap: ImageBitmap
  layout: FrameLayout
  /** Frames in the source file (the atlas may hold fewer). */
  sourceFrames: number
}

const MIME: Record<string, string> = { webp: 'image/webp', avif: 'image/avif', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
export const mimeOf = (path: string) => MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'

/**
 * Decodes an animated WebP/AVIF/GIF into a grid atlas with per-frame timing (WebCodecs ImageDecoder).
 * Without ImageDecoder, or for a still image, it is the first frame.
 */
export async function decodeFrames(buf: ArrayBuffer, mime: string, maxSide = 1024): Promise<DecodedImage> {
  const still = async (): Promise<DecodedImage> => ({ bitmap: await createImageBitmap(new Blob([buf], { type: mime })), layout: singleFrame(), sourceFrames: 1 })
  if (typeof ImageDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return still()
  let decoder: ImageDecoder | undefined
  try {
    if (!(await ImageDecoder.isTypeSupported(mime))) return still()
    decoder = new ImageDecoder({ data: buf, type: mime })
    await decoder.tracks.ready
    await decoder.completed
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1
    if (count <= 1) return still()
    const first = (await decoder.decode({ frameIndex: 0 })).image
    const plan = atlasLayout(first.displayWidth, first.displayHeight, count, maxSide)
    first.close()
    const canvas = new OffscreenCanvas(plan.cols * plan.cellW, plan.rows * plan.cellH)
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    // Start time of each picked frame (µs); a cell shows until the next pick starts.
    const starts: number[] = []
    let total = 0
    for (let i = 0; i < plan.picks.length; i++) {
      const frame = (await decoder.decode({ frameIndex: plan.picks[i]! })).image
      g.drawImage(frame, (i % plan.cols) * plan.cellW, Math.floor(i / plan.cols) * plan.cellH, plan.cellW, plan.cellH)
      starts.push(frame.timestamp)
      if (plan.picks[i] === count - 1) total = frame.timestamp + (frame.duration ?? 0)
      frame.close()
    }
    if (!total) {
      const last = (await decoder.decode({ frameIndex: count - 1 })).image
      total = last.timestamp + (last.duration ?? 0)
      last.close()
    }
    const t0 = starts[0] ?? 0
    // Frames without durations (or a zero total) play at 10 fps.
    const ends = starts.map((_, i) => ((i + 1 < starts.length ? starts[i + 1]! : total) - t0) / 1000)
    const fixed = !(ends[ends.length - 1]! > 0) || ends.some((e, i) => i > 0 && e < ends[i - 1]!)
    const layout: FrameLayout = { cols: plan.cols, rows: plan.rows, count: plan.picks.length, ends: fixed ? ends.map((_, i) => (i + 1) * 100) : ends }
    return { bitmap: canvas.transferToImageBitmap(), layout, sourceFrames: count }
  } catch {
    return still()
  } finally {
    decoder?.close()
  }
}
