import type { MemoryEntry, MemoryHistoryEntry } from '@/core/assistant/memoryEntries'
import type { MemoryWrite } from '@/core/assistant/memoryOperations'

/** 风格领域注入持久化实现，记忆运行时不反向加载编辑器。 */
export interface StyleMemoryStorage {
  list(): Promise<string[]>
  read(id: string): Promise<MemoryEntry[]>
  write(input: MemoryWrite & { target: { layer: 'style'; ownerId: string } }): Promise<MemoryHistoryEntry | null>
}
let storage: StyleMemoryStorage | undefined
export function registerStyleMemoryStorage(value: StyleMemoryStorage): void { storage = value }
export function styleMemoryStorage(): StyleMemoryStorage {
  if (!storage) throw new Error('MEMORY_NOT_READY：风格库尚未就绪，请等待工作区加载后重试。')
  return storage
}
