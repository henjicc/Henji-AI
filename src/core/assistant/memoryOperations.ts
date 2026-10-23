import { z } from 'zod'
import { assertMemoryContentSafe } from './memoryPolicy'
export { assertMemoryContentSafe } from './memoryPolicy'
import { MEMORY_LIMITS, memoryEntriesSchema, memoryEntryInputSchema, memoryTargetSchema, type MemoryEntry, type MemoryHistoryEntry, type MemoryLayer } from './memoryEntries'

export const memoryWriteSchema = z.object({
  target: memoryTargetSchema.describe('global 无 ownerId；project 的 ownerId=正式项目ID；style 的 ownerId=风格ID，不能用文档ID或路径。'),
  id: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative().describe('新增条目必须为0；修改/删除用读取到的该条目 revision，冲突重读合并。'),
  entry: memoryEntryInputSchema.nullable(),
  actor: z.enum(['user', 'assistant']),
  reason: z.string().trim().min(1).max(200),
  reverts: z.string().optional(),
  revisionFloor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).optional(),
}).strict().superRefine((write, context) => {
  if (!write.entry) return
  // 层级约束在公开输入边界拒绝，不能等进入写入通道才发现项目条目带了全局分区。
  const parsed = memoryEntriesSchema(write.target.layer).safeParse([{
    ...write.entry, id: write.id, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z',
  }])
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: 'custom', path: ['entry', ...issue.path.slice(1)], message: issue.message })
  }
})
export type MemoryWrite = z.infer<typeof memoryWriteSchema>

export function applyMemoryWrite(entries: readonly MemoryEntry[], input: MemoryWrite, now: Date, historyId: string): { entries: MemoryEntry[]; change: MemoryHistoryEntry | null } {
  const write = memoryWriteSchema.parse(input)
  assertMemoryContentSafe(write.reason)
  const before = entries.find(entry => entry.id === write.id) ?? null
  if ((before?.revision ?? 0) !== write.expectedRevision) throw new Error('CONFLICT：这条记忆已改变，请重新读取该条目后合并修改。')
  if (write.entry) assertMemoryContentSafe(JSON.stringify(write.entry))
  const after: MemoryEntry | null = write.entry ? { ...write.entry, id: write.id, revision: Math.max(now.getTime(), (before?.revision ?? 0) + 1, (write.revisionFloor ?? 0) + 1), updatedAt: now.toISOString() } : null
  if (!before && !after) return { entries: [...entries], change: null }
  if (before && after && JSON.stringify(memoryEntryInputSchema.strip().parse(before)) === JSON.stringify(memoryEntryInputSchema.strip().parse(after))) return { entries: [...entries], change: null }
  const next = entries.filter(entry => entry.id !== write.id)
  if (after) next.push(after)
  const capacity = MEMORY_LIMITS[write.target.layer]
  if (next.length > capacity.entries || next.reduce((sum, entry) => sum + entry.content.length, 0) > capacity.characters) throw new Error('MEMORY_CAPACITY：记忆已满，请先整理再保存。')
  memoryEntriesSchema(write.target.layer).parse(next)
  return { entries: next, change: { id: historyId, target: write.target, entryId: write.id, actor: write.actor, before, after, reason: write.reason, createdAt: now.toISOString(), ...(write.reverts ? { reverts: write.reverts } : {}) } }
}

/** 撤回只允许覆盖这次变更留下的值；后续编辑必须先处理，不能借撤回抹掉。 */
export function memoryRevertWrite(change: MemoryHistoryEntry, current: readonly MemoryEntry[], actor: MemoryWrite['actor']): MemoryWrite {
  const entry = current.find(value => value.id === change.entryId) ?? null
  if ((entry?.revision ?? 0) !== (change.after?.revision ?? 0)) throw new Error('CONFLICT：这条记忆后来又修改过，请先读取并处理后续修改。')
  const original = change.before
  return { target: change.target, id: change.entryId, expectedRevision: entry?.revision ?? 0,
    entry: original ? memoryEntryInputSchema.parse({ content: original.content, source: original.source, section: original.section, precedence: original.precedence, value: original.value, reason: original.reason }) : null,
    actor, reverts: change.id, revisionFloor: Math.max(change.before?.revision ?? 0, change.after?.revision ?? 0), reason: '撤回这次记忆修改。' }
}

/** 本地可确定的重复合并；语义压缩与跨项目提升交给同一助手整理任务。 */
export function duplicateMemoryWrites(layer: MemoryLayer, entries: readonly MemoryEntry[], target: MemoryWrite['target']): MemoryWrite[] {
  const seen = new Set<string>()
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision).flatMap(entry => {
    const key = JSON.stringify([layer, entry.section, entry.content.replace(/\s+/g, '').toLocaleLowerCase(), entry.precedence, entry.value])
    if (!seen.has(key)) { seen.add(key); return [] }
    return [{ target, id: entry.id, expectedRevision: entry.revision, entry: null, actor: 'assistant' as const, reason: '整理重复记忆，保留较新的条目。' }]
  })
}
