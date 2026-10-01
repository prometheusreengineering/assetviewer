import { getFileText, getIndexBuffer } from '../../cdn'
import { LUNAR_INDEXES } from '../../config'
import type { CosmeticItem } from '../types'

export const PREFIX = 'assets/lunar/'

export interface LunarEntry {
  item: CosmeticItem
  /** Path (relative to PREFIX) of the .gek.json or the flat .webp. */
  path: string
  /** Shared OBJ model key (legacy hats/bandannas/masks), or '' if none. */
  modelKey: string
}

export interface LunarCatalog {
  /** full path -> sha1 */
  files: Map<string, string>
  entries: LunarEntry[]
  /** folder name -> full path of the .obj inside it */
  objs: Map<string, string>
}

async function loadFileMap(): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const decoder = new TextDecoder()
  for (const id of LUNAR_INDEXES) {
    for (const line of decoder.decode(await getIndexBuffer(id)).split('\n')) {
      const [path, hash] = line.split(' ')
      if (path && hash) files.set(path, hash)
    }
  }
  return files
}

/** Catalog CSV columns: id,,,name,,flag,type,modelKey,path,flag,themes|..,colors|.. */
function parseCatalog(csv: string, files: Map<string, string>): LunarEntry[] {
  const entries: LunarEntry[] = []
  for (const line of csv.split('\n')) {
    const c = line.trim().split(',')
    if (c.length < 12) continue
    const path = c[8]!
    const modelKey = c[7] === 'NONE' ? '' : c[7]!
    const isGek = path.endsWith('.gek.json')
    entries.push({
      path,
      modelKey,
      item: {
        id: c[0]!,
        name: c[3] || c[0]!,
        category: c[6]!,
        render: isGek || modelKey !== '' ? '3d' : 'image',
        fields: {
          themes: c[10] ? c[10].split('|') : [],
          colors: c[11] ? c[11].split('|') : [],
          animated: files.has(PREFIX + path + '.mcmeta'),
        },
      },
    })
  }
  return entries
}

export async function loadLunarCatalog(): Promise<LunarCatalog> {
  const files = await loadFileMap()
  const csvHash = files.get(PREFIX + 'cosmetics/index')
  if (!csvHash) throw new Error('cosmetics/index missing from CDN index')
  const entries = parseCatalog(await getFileText(csvHash), files)

  const objs = new Map<string, string>()
  for (const path of files.keys()) {
    if (path.endsWith('.obj') && path.includes('/cosmetics/models/')) {
      objs.set(path.split('/').slice(-2, -1)[0]!, path)
    }
  }
  return { files, entries, objs }
}
