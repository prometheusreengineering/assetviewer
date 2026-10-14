// Minimal image file headers, enough for dimensions.ts to read width/height.
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const pad = (b: number[], n: number) => [...b, ...Array(Math.max(0, n - b.length)).fill(0)]
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16le = (n: number) => [n & 255, (n >> 8) & 255]
const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255]
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]

export function png(w: number, h: number): Uint8Array {
  return new Uint8Array(pad([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0], 48))
}

export function gif(w: number, h: number): Uint8Array {
  return new Uint8Array(pad([...ascii('GIF89a'), ...u16le(w), ...u16le(h)], 48))
}

const riff = (fourcc: string, body: number[]) => [...ascii('RIFF'), ...u32le(100), ...ascii('WEBP'), ...ascii(fourcc), ...body]

/** Extended WebP: canvas size minus one, 24-bit little endian, at bytes 24..29. */
export function webpVP8X(w: number, h: number): Uint8Array {
  return new Uint8Array(pad(riff('VP8X', [...u32le(10), 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]), 48))
}

/** Lossless WebP: 14-bit (w-1) and (h-1) packed from byte 21. */
export function webpVP8L(w: number, h: number): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)
  return new Uint8Array(pad(riff('VP8L', [...u32le(10), 0x2f, ...u32le(bits)]), 48))
}

/** Lossy WebP: 14-bit width/height at bytes 26 and 28. */
export function webpVP8(w: number, h: number): Uint8Array {
  return new Uint8Array(pad(riff('VP8 ', [...u32le(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]), 48))
}

/** AVIF header: ftyp then (deeper) an 'ispe' box with width/height. */
export function avif(w: number, h: number): Uint8Array {
  return new Uint8Array(pad([...u32be(28), ...ascii('ftypavis'), 0, 0, 0, 0, ...ascii('avifavismsf1'), ...Array(150).fill(0), ...u32be(20), ...ascii('ispe'), 0, 0, 0, 0, ...u32be(w), ...u32be(h)], 512))
}

/**
 * A real animated GIF: `frames` solid colours (RGB) of w x h, each shown for `delaysCs` centiseconds.
 * The LZW stream sends a clear code before every pixel so codes stay 3 bits wide.
 */
export function animatedGif(w: number, h: number, colors: [number, number, number][], delaysCs: number[]): Uint8Array {
  const table = [...colors, ...Array(4).fill([0, 0, 0])].slice(0, 4).flat()
  const out = [...ascii('GIF89a'), ...u16le(w), ...u16le(h), 0xf1, 0, 0, ...table]
  out.push(0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0)
  colors.slice(0, 4).forEach((_, f) => {
    out.push(0x21, 0xf9, 4, 0, ...u16le(delaysCs[f] ?? 10), 0, 0)
    out.push(0x2c, 0, 0, 0, 0, ...u16le(w), ...u16le(h), 0)
    const codes: number[] = []
    for (let i = 0; i < w * h; i++) codes.push(4, f)
    codes.push(5)
    const bytes: number[] = []
    let acc = 0
    let n = 0
    for (const c of codes) {
      acc |= c << n
      n += 3
      while (n >= 8) {
        bytes.push(acc & 255)
        acc >>= 8
        n -= 8
      }
    }
    if (n) bytes.push(acc & 255)
    out.push(2)
    for (let i = 0; i < bytes.length; i += 255) out.push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255))
    out.push(0)
  })
  out.push(0x3b)
  return new Uint8Array(out)
}
