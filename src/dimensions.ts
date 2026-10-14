/** Reads image width/height from the first bytes of a WebP, PNG, GIF or AVIF file (AVIF needs ~512 bytes). */
export function imageSize(b: Uint8Array): [number, number] | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o: number, s: string) => b.length >= o + s.length && [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
    if (tag(12, 'VP8X') && b.length >= 30) return [1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))]
    if (tag(12, 'VP8L') && b.length >= 25) {
      const v = dv.getUint32(21, true)
      return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]
    }
    if (tag(12, 'VP8 ') && b.length >= 30) return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff]
  } else if (b[0] === 0x89 && tag(1, 'PNG') && b.length >= 24) return [dv.getUint32(16), dv.getUint32(20)]
  else if (tag(0, 'GIF') && b.length >= 10) return [dv.getUint16(6, true), dv.getUint16(8, true)]
  else if (tag(4, 'ftyp')) {
    // HEIF/AVIF: the first image spatial extents property ('ispe': version/flags, width, height).
    for (let i = 8; i + 16 <= b.length; i++) if (tag(i, 'ispe')) return [dv.getUint32(i + 8), dv.getUint32(i + 12)]
  }
  return undefined
}

/** Fetches just the file header (Range request; if the server ignores Range, the body is cancelled after the first chunk). */
export async function fetchImageSize(url: string, signal?: AbortSignal, bytes = 48): Promise<[number, number] | undefined> {
  const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal })
  if (!res.ok) return undefined
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  while (n < bytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    n += value.length
  }
  reader.cancel().catch(() => {})
  const all = new Uint8Array(n)
  let o = 0
  for (const c of chunks) (all.set(c, o), (o += c.length))
  return imageSize(all)
}
