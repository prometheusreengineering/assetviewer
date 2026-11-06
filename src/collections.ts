import { effectScope, reactive, watch } from 'vue'
import { notify } from './dialogs'

// Named lists of item ids per provider, saved in localStorage. "Favorites" always exists (id 'fav').
export interface Collection {
  id: string
  name: string
  items: string[]
}

export const FAV = 'fav'
export const COLLECTION_PREFIX = 'col-'
const KEY_PREFIX = 'assetviewer.collections.'
const key = (provider: string) => KEY_PREFIX + provider
const state = reactive<Record<string, Collection[]>>({})
// Detached: the first read can happen during a component's setup, and a watcher created there would stop
// saving when that component unmounts. The lists live as long as the page.
const saving = effectScope(true)
let warnedQuota = false

function parse(text: string | null): Collection[] {
  let saved: Collection[] = []
  try {
    const v = JSON.parse(text ?? '[]')
    if (Array.isArray(v)) saved = v.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.items))
  } catch {}
  if (!saved.some((c) => c.id === FAV)) saved.unshift({ id: FAV, name: 'Favorites', items: [] })
  return saved
}

function read(provider: string): Collection[] {
  try {
    return parse(localStorage.getItem(key(provider)))
  } catch {
    return parse(null)
  }
}

function save(provider: string, lists: Collection[]) {
  try {
    const json = JSON.stringify(lists)
    // Unchanged (it just came from another tab): writing it back would only echo.
    if (localStorage.getItem(key(provider)) !== json) localStorage.setItem(key(provider), json)
    warnedQuota = false
  } catch {
    if (warnedQuota) return
    warnedQuota = true
    void notify('Collections not saved', "This browser refused to store your collections (storage may be full or blocked). Changes will be lost when the page closes.", 'pi pi-exclamation-triangle')
  }
}

function lists(provider: string): Collection[] {
  if (!state[provider]) {
    state[provider] = read(provider)
    saving.run(() => watch(() => state[provider]!, (v) => save(provider, v), { deep: true }))
  }
  return state[provider]!
}

// Another tab changed them: take its version, or the next save here would overwrite that tab's changes.
globalThis.addEventListener?.('storage', (e) => {
  if (e.key === null) {
    for (const provider of Object.keys(state)) state[provider] = read(provider)
  } else if (e.key.startsWith(KEY_PREFIX)) {
    const provider = e.key.slice(KEY_PREFIX.length)
    if (state[provider]) state[provider] = parse(e.newValue)
  }
})

const newId = () => Math.random().toString(36).slice(2, 8)
const NOT_A_FILE = 'Not an Asset Viewer collections file'

/** Reads a collections file completely first, so a bad entry can't leave a half-applied import. */
function parseImport(text: string, provider: string): { name: string; ids: string[] }[] {
  const data = JSON.parse(text) as { provider?: unknown; collections?: unknown } | null
  if (!Array.isArray(data?.collections)) throw new Error(NOT_A_FILE)
  // Ids only mean something to the provider they came from: they would count but never show here.
  if (typeof data.provider === 'string' && data.provider !== provider) throw new Error("This file's collections belong to another provider")
  return data.collections.map((c: { name?: unknown; items?: unknown } | null) => {
    if (!c || typeof c !== 'object') throw new Error(NOT_A_FILE)
    const items = c.items ?? []
    if (!Array.isArray(items)) throw new Error(NOT_A_FILE)
    // Entries without an id are skipped; there's nothing to add for them.
    const ids = items.map((it: { id?: unknown } | string | null) => (typeof it === 'string' ? it : it?.id)).filter((id): id is string => typeof id === 'string' && !!id)
    return { name: typeof c.name === 'string' && c.name.trim() ? c.name : 'Imported', ids }
  })
}

export function useCollections(provider: string) {
  const all = () => lists(provider)
  const get = (id: string) => all().find((c) => c.id === id)
  const create = (name: string): Collection => {
    const c = { id: newId(), name: name.trim() || 'Untitled', items: [] }
    all().push(c)
    return all()[all().length - 1]!
  }
  return {
    all,
    get,
    has: (listId: string, itemId: string) => !!get(listId)?.items.includes(itemId),
    /** Lists that contain the item. */
    of: (itemId: string) => all().filter((c) => c.items.includes(itemId)).map((c) => c.id),
    toggle(listId: string, itemId: string) {
      const c = get(listId)
      if (!c) return
      const i = c.items.indexOf(itemId)
      if (i >= 0) c.items.splice(i, 1)
      else c.items.push(itemId)
    },
    set(listId: string, itemId: string, on: boolean) {
      const c = get(listId)
      if (!c || c.items.includes(itemId) === on) return
      if (on) c.items.push(itemId)
      else c.items.splice(c.items.indexOf(itemId), 1)
    },
    create,
    rename(id: string, name: string) {
      const c = get(id)
      if (c && name.trim()) c.name = name.trim()
    },
    remove(id: string) {
      if (id === FAV) return
      const l = all()
      const i = l.findIndex((c) => c.id === id)
      if (i >= 0) l.splice(i, 1)
    },
    /** JSON with item names for readability; import only needs the ids. */
    exportJson(ids: string[], nameOf: (itemId: string) => string | undefined): string {
      const pick = all().filter((c) => ids.includes(c.id))
      return JSON.stringify(
        { app: 'assetviewer', provider, collections: pick.map((c) => ({ name: c.name, items: c.items.map((id) => ({ id, name: nameOf(id) })) })) },
        null,
        2,
      )
    },
    /** Merges lists by name; returns how many items were added. */
    importJson(text: string): number {
      let added = 0
      for (const { name, ids } of parseImport(text, provider)) {
        const target = all().find((x) => x.name === name) ?? create(name)
        for (const id of ids) {
          if (!target.items.includes(id)) {
            target.items.push(id)
            added++
          }
        }
      }
      return added
    },
  }
}
