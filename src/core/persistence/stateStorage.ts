import type { PersistenceContract } from './migrations'
import { readLocalPersistenceJson } from './versionedJson'

export interface PersistenceStringStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Zustand sees the upgraded version in memory, so hydration never eagerly writes migrated data. */
export function guardedStateStorage(key: string, contract: PersistenceContract, storage: PersistenceStringStorage): PersistenceStringStorage {
  let failure: unknown
  return {
    getItem: name => {
      const text = storage.getItem(name)
      if (text === null || name !== key) { if (name === key) failure = undefined; return text }
      try {
        const state = readLocalPersistenceJson(text, key, contract, storage, 'state')
        failure = undefined
        return JSON.stringify({ version: contract.version, state })
      } catch (error) { failure = error; throw error }
    },
    setItem: (name, value) => { if (failure && name === key && storage.getItem(name) !== null) throw failure; storage.setItem(name, value) },
    removeItem: name => { if (failure && name === key && storage.getItem(name) !== null) throw failure; storage.removeItem(name) },
  }
}

export function guardedPlainStorage(key: string, contract: PersistenceContract, storage: Pick<PersistenceStringStorage, 'getItem' | 'setItem'>, onReadFailure: (error: unknown) => void): Pick<PersistenceStringStorage, 'getItem' | 'setItem'> {
  let failure: unknown
  return {
    getItem: name => {
      const text = storage.getItem(name)
      if (text === null || name !== key) { if (name === key) failure = undefined; return text }
      try { const value = readLocalPersistenceJson(text, key, contract, storage, 'self'); failure = undefined; return JSON.stringify(value) }
      catch (error) { failure = error; onReadFailure(error); return null }
    },
    setItem: (name, value) => { if (failure && name === key && storage.getItem(name) !== null) throw failure; storage.setItem(name, value) },
  }
}
