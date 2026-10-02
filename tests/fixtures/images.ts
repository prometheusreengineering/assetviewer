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
