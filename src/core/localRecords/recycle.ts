import { z } from 'zod'

export const RECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 恢复只添加被删成员；同 ID 的后续内容保留，恢复项获得独立身份。 */
export function mergeRecycledMembers<T>(current: readonly T[], removed: readonly T[], identity: keyof T, allocateId: () => string): { values: T[]; restored: T[] } {
  const values = [...current], restored: T[] = []
  for (const item of removed) {
    const existing = values.find(value => value[identity] === item[identity])
    if (existing && JSON.stringify(existing) === JSON.stringify(item)) { restored.push(existing); continue }
    const value = existing ? { ...item, [identity]: allocateId() } : item
    values.push(value); restored.push(value)
  }
  return { values, restored }
}
export const recycledItemSchema = z.object({
  id: z.string(), name: z.string(), category: z.string(), deletedAt: z.number(), path: z.string().optional(), recordIds: z.array(z.string()).optional(),
})
export type RecycledItem = z.infer<typeof recycledItemSchema>

export interface RecyclePlatform {
  listDeleted(): Promise<RecycledItem[]>
  restoreDeleted(id: string): Promise<void>
  preserveFile(path: string, name?: string): Promise<void>
  trashFile(path: string, name?: string): Promise<void>
}

export const RECYCLE_IPC_CHANNELS = {
  listDeleted: 'recycle:list', restoreDeleted: 'recycle:restore', preserveFile: 'recycle:preserveFile', trashFile: 'recycle:trashFile',
} as const satisfies Record<keyof RecyclePlatform, string>
