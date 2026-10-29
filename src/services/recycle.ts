import { getPlatform } from '@/platform/runtime'
import type { RecycledItem } from '@/core/localRecords/recycle'

type RestoreFinish = (restored: boolean) => void | Promise<void>
const preparations = new Set<(item: RecycledItem) => Promise<RestoreFinish>>()
const listeners = new Set<(item: RecycledItem) => void | Promise<void>>()
export const listDeleted = (): Promise<RecycledItem[]> => getPlatform().settings.listDeleted()
export async function restoreDeleted(id: string): Promise<void> {
  const item = (await listDeleted()).find(item => item.id === id)
  if (!item) throw new Error('这项内容已恢复或已过保留期。')
  const finishes: RestoreFinish[] = []
  let restored = false
  try {
    for (const prepare of preparations) finishes.push(await prepare(item))
    await getPlatform().settings.restoreDeleted(id)
    restored = true
  } finally { for (const finish of finishes.reverse()) await finish(restored) }
  for (const listener of listeners) await listener(item)
}
export function subscribeRestored(listener: (item: RecycledItem) => void | Promise<void>): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function registerRecycleRestorePreparation(prepare: (item: RecycledItem) => Promise<RestoreFinish>): () => void { preparations.add(prepare); return () => preparations.delete(prepare) }
