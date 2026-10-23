import { getDb } from '../db'
import { MemoryEntryStore } from './entry-store'
let memoryStore: MemoryEntryStore | null = null
export function getAgentMemoryStore(): MemoryEntryStore {
  memoryStore ??= new MemoryEntryStore(getDb())
  return memoryStore
}
