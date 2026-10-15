// The first "Remember on this device" kept every picked file as its own Blob in idb-keyval's default database.
// Chrome's browser process runs out of memory (and takes the whole browser down) deleting or overwriting such a
// record of ~5,500 file-backed Blobs, so it is never touched again: it is read once with plain IndexedDB (an
// idb-keyval connection would stay open and block the delete) and the whole database is dropped, which survives.
const DB = 'keyval-store'
const STORE = 'keyval'

const idb = (): IDBFactory | undefined => (typeof indexedDB === 'undefined' ? undefined : indexedDB)

/** The values stored under `keys` in the old database, or undefined when there is none. */
export async function readLegacy(keys: string[]): Promise<Map<string, unknown> | undefined> {
  const f = idb()
  if (!f) return undefined
  // Opening a missing database would create it: ask first where the browser can tell.
  if (f.databases && !(await f.databases()).some((d) => d.name === DB)) return undefined
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = f.open(DB)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  try {
    if (!db.objectStoreNames.contains(STORE)) return undefined
    const tx = db.transaction(STORE, 'readonly')
    const values = await Promise.all(
      keys.map(
        (k) =>
          new Promise<unknown>((resolve, reject) => {
            const g = tx.objectStore(STORE).get(k)
            g.onsuccess = () => resolve(g.result)
            g.onerror = () => reject(g.error)
          }),
      ),
    )
    return new Map(keys.map((k, i) => [k, values[i]]))
  } finally {
    db.close()
  }
}

/** Deletes the old database (it can take a while with many blobs; nothing waits for it). */
export function dropLegacy(): void {
  const f = idb()
  if (!f) return
  try {
    f.deleteDatabase(DB)
  } catch {}
}
