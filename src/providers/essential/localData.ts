// Essential's catalog and files come from the viewer's own disk: the dumps written by the Prometheus patch
// (one JSON per cosmetic) and Essential's own cosmetic cache. Nothing is hosted or bundled with the site.

/** A folder that can be listed and read; paths are relative, `/`-separated. Folder names end with `/`. */
export interface DirSource {
  list(path: string): Promise<string[]>
  read(path: string): Promise<ArrayBuffer | undefined>
}

export interface EssentialFolders {
  /** `.minecraft/prometheus/essential/dumps`: `<CATEGORY>/<ID>.json` */
  dumps: DirSource
  /** `.minecraft/essential/cosmetic-cache`: files named by their sha256, `<h0>/<h1>/<h[2:]>` */
  cache?: DirSource
}

const parts = (path: string) => path.split('/').filter(Boolean)

/** A folder picked with `showDirectoryPicker` (Chromium): walked lazily, so picking `.minecraft` stays cheap. */
export function handleSource(root: FileSystemDirectoryHandle): DirSource {
  const dir = async (path: string) => {
    let d = root
    for (const p of parts(path)) d = await d.getDirectoryHandle(p)
    return d
  }
  return {
    async list(path) {
      try {
        const out: string[] = []
        for await (const h of (await dir(path)) as unknown as AsyncIterable<FileSystemHandle>) out.push(h.kind === 'directory' ? h.name + '/' : h.name)
        return out
      } catch {
        return []
      }
    },
    async read(path) {
      const ps = parts(path)
      try {
        const file = await (await dir(ps.slice(0, -1).join('/'))).getFileHandle(ps.at(-1)!)
        return await (await file.getFile()).arrayBuffer()
      } catch {
        return undefined
      }
    },
  }
}

/** Files from `<input webkitdirectory>` (every browser): paths drop the picked folder's own name. */
export function filesSource(files: Iterable<File>): DirSource {
  const map = new Map<string, File>()
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name
    map.set(rel, f)
  }
  return listingSource([...map.keys()], async (p) => map.get(p)?.arrayBuffer())
}

/** In-memory files (tests). */
export function memorySource(files: Record<string, Uint8Array | string>): DirSource {
  const enc = new TextEncoder()
  return listingSource(Object.keys(files), async (p) => {
    const f = files[p]
    if (f === undefined) return undefined
    return (typeof f === 'string' ? enc.encode(f) : f).slice().buffer as ArrayBuffer
  })
}

/** A source over a flat list of file paths and a reader. */
export function listingSource(paths: string[], read: (path: string) => Promise<ArrayBuffer | undefined>): DirSource {
  return {
    async list(path) {
      const prefix = parts(path).join('/')
      const out = new Set<string>()
      for (const p of paths) {
        if (prefix && !p.startsWith(prefix + '/')) continue
        const rest = prefix ? p.slice(prefix.length + 1) : p
        const [head, ...tail] = rest.split('/')
        if (head) out.add(tail.length ? head + '/' : head)
      }
      return [...out]
    },
    read: (path) => read(parts(path).join('/')),
  }
}

/** The same source seen from one of its subfolders. */
export function subSource(src: DirSource, prefix: string): DirSource {
  const join = (p: string) => [...parts(prefix), ...parts(p)].join('/')
  return { list: (p) => src.list(join(p)), read: (p) => src.read(join(p)) }
}

const DUMPS = 'prometheus/essential/dumps'
const CACHE = 'essential/cosmetic-cache'
const isCategory = (name: string) => /^[A-Z][A-Z_]+\/$/.test(name)

/**
 * Finds the dumps and the cache under a picked folder: `.minecraft` itself, its `prometheus` or `essential`
 * folders, or the dumps folder directly (then there is no cache unless it is picked separately).
 */
export async function resolveFolders(root: DirSource): Promise<Partial<EssentialFolders>> {
  const out: Partial<EssentialFolders> = {}
  const has = async (path: string) => (await root.list(path)).length > 0
  if (await has(DUMPS)) out.dumps = subSource(root, DUMPS)
  else if (await has('essential/dumps')) out.dumps = subSource(root, 'essential/dumps')
  else if ((await root.list('')).some(isCategory)) out.dumps = root
  if (await has(CACHE)) out.cache = subSource(root, CACHE)
  else if (await has('cosmetic-cache')) out.cache = subSource(root, 'cosmetic-cache')
  else if (!out.dumps && (await root.list('')).every((n) => /^[0-9a-f]\/$/.test(n)) && (await root.list('')).length) out.cache = root
  return out
}

/** Where Essential's cache keeps a file with this sha256. */
export const cachePath = (sha256: string) => `${sha256[0]}/${sha256[1]}/${sha256.slice(2)}`

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reads every dump: `<CATEGORY>/<ID>.json` -> parsed JSON (unreadable files are skipped). */
export async function readDumps(dumps: DirSource): Promise<unknown[]> {
  const out: unknown[] = []
  const dec = new TextDecoder()
  for (const cat of (await dumps.list('')).filter((n) => n.endsWith('/'))) {
    const files = (await dumps.list(cat)).filter((n) => n.endsWith('.json'))
    const read = await Promise.all(files.map((f) => dumps.read(cat + f)))
    for (const buf of read) {
      if (!buf) continue
      try {
        out.push(JSON.parse(dec.decode(buf)))
      } catch {}
    }
  }
  return out
}

export interface AssetRef {
  url: string
  sha256: string
}

/**
 * A file's bytes: from the local cache, else downloaded from the URL in the viewer's own dump (kept in the
 * browser's Cache Storage). Downloads must match the dump's sha256.
 */
export async function assetBytes(folders: EssentialFolders, ref: AssetRef, download: (url: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  const local = folders.cache && (await folders.cache.read(cachePath(ref.sha256)))
  if (local) return local
  if (!/^https:\/\//.test(ref.url)) throw new Error(`Not in the local cache: ${ref.sha256}`)
  const buf = await download(ref.url)
  if ((await sha256(buf)) !== ref.sha256) throw new Error(`Checksum mismatch for ${ref.sha256}`)
  return buf
}
