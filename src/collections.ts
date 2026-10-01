import { reactive, watch } from 'vue'

// Named lists of item ids per provider, saved in localStorage. "Favorites" always exists (id 'fav').
export interface Collection {
  id: string
  name: string
  items: string[]
}

export const FAV = 'fav'
export const COLLECTION_PREFIX = 'col-'
const key = (provider: string) => `assetviewer.collections.${provider}`
const state = reactive<Record<string, Collection[]>>({})

function lists(provider: string): Collection[] {
  if (!state[provider]) {
    let saved: Collection[] = []
    try {
      const v = JSON.parse(localStorage.getItem(key(provider)) ?? '[]')
      if (Array.isArray(v)) saved = v.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.items))
    } catch {}
    if (!saved.some((c) => c.id === FAV)) saved.unshift({ id: FAV, name: 'Favorites', items: [] })
    state[provider] = saved
    watch(
      () => state[provider],
      (v) => {
        try {
          localStorage.setItem(key(provider), JSON.stringify(v))
        } catch {}
      },
      { deep: true },
    )
  }
  return state[provider]!
}

const newId = () => Math.random().toString(36).slice(2, 8)

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
      const data = JSON.parse(text) as { collections?: { name?: string; items?: ({ id?: string } | string)[] }[] }
      if (!Array.isArray(data.collections)) throw new Error('Not an Asset Viewer collections file')
      let added = 0
      for (const c of data.collections) {
        const name = String(c.name ?? 'Imported')
        const target = all().find((x) => x.name === name) ?? create(name)
        for (const it of c.items ?? []) {
          const id = typeof it === 'string' ? it : it?.id
          if (id && !target.items.includes(id)) {
            target.items.push(id)
            added++
          }
        }
      }
      return added
    },
  }
}
