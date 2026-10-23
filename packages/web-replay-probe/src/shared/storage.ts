import type { IdbDatabaseDump, IdbStoreDump, StorageSnapshot } from '../protocol'
import { decodeValue, encodeValue } from './codec'

export const SESSION_KEY = '__henji_web_replay_session'

function entries(storage: Storage): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && key !== SESSION_KEY) out.push([key, storage.getItem(key) ?? ''])
  }
  return out
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
}

async function dumpDatabase(name: string, version: number): Promise<IdbDatabaseDump> {
  const db = await request(indexedDB.open(name))
  try {
    const storeNames = [...db.objectStoreNames]
    if (!storeNames.length) return { name, version: db.version || version, stores: [] }
    // One readonly transaction over every store: app writes created after it wait until the dump is read.
    const tx = db.transaction(storeNames, 'readonly')
    const raw = await Promise.all(storeNames.map(async storeName => {
      const store = tx.objectStore(storeName)
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())])
      return {
        name: storeName, keyPath: store.keyPath as string | string[] | null, autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map(indexName => { const index = store.index(indexName); return { name: indexName, keyPath: index.keyPath as string | string[], unique: index.unique, multiEntry: index.multiEntry } }),
        keys, values,
      }
    }))
    const stores: IdbStoreDump[] = await Promise.all(raw.map(async s => ({
      name: s.name, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: s.indexes,
      records: await Promise.all(s.keys.map(async (key, i) => ({ key: await encodeValue(key), value: await encodeValue(s.values[i]) }))),
    })))
    return { name, version: db.version, stores }
  } finally { db.close() }
}

/** Reads storage as it is before the app's own code runs (call from the first module). */
export async function snapshotStorage(): Promise<StorageSnapshot> {
  const local = entries(localStorage)
  const session = entries(sessionStorage)
  const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
  const indexedDBDumps = await Promise.all(databases.filter(d => d.name).map(d => dumpDatabase(d.name!, d.version ?? 1)))
  return { local, session, indexedDB: indexedDBDumps }
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => resolve() })
}

async function restoreDatabase(dump: IdbDatabaseDump): Promise<void> {
  await deleteDatabase(dump.name)
  const open = indexedDB.open(dump.name, Math.max(1, dump.version))
  open.onupgradeneeded = () => {
    const db = open.result
    for (const s of dump.stores) {
      const store = db.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement })
      for (const index of s.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry })
    }
  }
  const db = await request(open)
  try {
    if (!dump.stores.length) return
    const tx = db.transaction(dump.stores.map(s => s.name), 'readwrite')
    for (const s of dump.stores) {
      const store = tx.objectStore(s.name)
      for (const record of s.records) {
        const value = decodeValue(record.value)
        if (s.keyPath === null) store.put(value, decodeValue(record.key) as IDBValidKey)
        else store.put(value)
      }
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error) })
  } finally { db.close() }
}

/** Replaces every storage area of the current origin with the snapshot. */
export async function restoreStorage(snapshot: StorageSnapshot): Promise<void> {
  localStorage.clear()
  for (const [k, v] of snapshot.local) localStorage.setItem(k, v)
  for (const [k, v] of snapshot.session) sessionStorage.setItem(k, v)
  const existing = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
  for (const d of existing) if (d.name && !snapshot.indexedDB.some(x => x.name === d.name)) await deleteDatabase(d.name)
  for (const dump of snapshot.indexedDB) await restoreDatabase(dump)
}
