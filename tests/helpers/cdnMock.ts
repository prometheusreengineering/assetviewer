import { vi } from 'vitest'
import { CDN_BASE, LUNAR_INDEXES } from '../../src/config'

export type FileBody = string | Uint8Array | object
export interface FakeCdn {
  /** full path -> hash */
  hashes: Map<string, string>
  /** hash -> bytes */
  bodies: Map<string, Uint8Array>
  fetch: ReturnType<typeof vi.fn>
  /** Requested URLs, in order. */
  requests: string[]
}

const enc = new TextEncoder()
const bytes = (b: FileBody) => (typeof b === 'string' ? enc.encode(b) : b instanceof Uint8Array ? b : enc.encode(JSON.stringify(b)))
export const fakeHash = (i: number) => i.toString(16).padStart(40, 'a')

/**
 * Serves `files` (full CDN paths, e.g. `assets/lunar/cosmetics.json`) like the Lunar CDN: the files are split
 * over the two root indexes (`path sha1 size mtime` lines) and served by hash. Sizes in the index are the byte
 * lengths unless `sizes` overrides them. Installs `fetch` and removes Cache Storage.
 */
export function installCdn(files: [string, FileBody][], sizes: Record<string, number> = {}): FakeCdn {
  const hashes = new Map<string, string>()
  const bodies = new Map<string, Uint8Array>()
  const lines: string[][] = [[], []]
  files.forEach(([path, body], i) => {
    const h = fakeHash(i + 1)
    const b = bytes(body)
    hashes.set(path, h)
    bodies.set(h, b)
    // first half in the first index, the rest in the second, so the catalog sees them in order
    lines[i < files.length / 2 ? 0 : 1]!.push(`${path} ${h} ${sizes[path] ?? b.length} 1700000000`)
  })
  // a blank line and a malformed one, like real indexes can end with
  lines[1]!.push('', 'lonely-path')
  const requests: string[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    requests.push(url)
    const idx = LUNAR_INDEXES.findIndex((id) => url === `${CDN_BASE}/index/${id}`)
    if (idx >= 0) return new Response(lines[idx]!.join('\n'))
    const m = url.match(/\/file\/([0-9a-f]+)$/)
    const body = m && bodies.get(m[1]!)
    if (!body) return new Response('not found', { status: 404 })
    const range = new Headers(init?.headers).get('Range')?.match(/bytes=(\d+)-(\d+)/)
    const out = range ? body.slice(Number(range[1]), Number(range[2]) + 1) : body
    return new Response(out.slice().buffer as ArrayBuffer, { status: range ? 206 : 200 })
  })
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('caches', undefined)
  return { hashes, bodies, fetch, requests }
}
