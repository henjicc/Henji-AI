import { getPlatform } from '@/platform/runtime'
import { applyMemoryWrite, memoryRevertWrite, duplicateMemoryWrites, type MemoryWrite } from '@/core/assistant/memoryOperations'
import { shouldOrganizeMemory, type MemoryEntry, type MemoryTarget,  type MemoryHistoryEntry } from '@/core/assistant/memoryEntries'
import { videoEditStyleLibrary } from '@/features/videoEdit/application/videoEditStyleLibrary'

import { refreshMemory } from './memoryState'
export { refreshMemory, cachedMemory, subscribeMemory } from './memoryState'
const queues = new Map<string, Promise<unknown>>()
export async function readMemory(target: MemoryTarget): Promise<MemoryEntry[]> {
  const state = await refreshMemory()
  if (!state.settings.enabled) return []
  if (target.layer === 'global') return state.entries
  if (target.layer === 'project') return getPlatform().assistant.readProjectMemory(target.ownerId)
  await videoEditStyleLibrary.ready()
  return videoEditStyleLibrary.requireStyle(target.ownerId).style.userPreferences ?? []
}

/** UI 与通用实体共用逐条写入；同一文件串行，实际执行前仍核对条目基线。 */
export async function writeMemory(input: MemoryWrite): Promise<MemoryHistoryEntry | null> {
  const key = JSON.stringify(input.target)
  const run = async (): Promise<MemoryHistoryEntry | null> => {
    const state = await refreshMemory()
    if (!state.settings.enabled) throw new Error('MEMORY_DISABLED：请先在设置中开启记忆。')
    let change: MemoryHistoryEntry | null
    if (input.target.layer !== 'style') change = await getPlatform().assistant.writeMemory(input)
    else {
      await videoEditStyleLibrary.ready()
      const previous = videoEditStyleLibrary.requireStyle(input.target.ownerId).style
      const result = applyMemoryWrite(previous.userPreferences ?? [], input, new Date(), crypto.randomUUID())
      change = result.change
      if (change) {
        await videoEditStyleLibrary.saveStyle({ ...previous, userPreferences: result.entries, version: previous.version + 1 }, undefined, true)
        try { await getPlatform().assistant.recordMemoryChange(change) }
        catch (error) { await videoEditStyleLibrary.saveStyle(previous, undefined, true); throw error }
      }
    }
    await refreshMemory()
    return change
  }
  const pending = (queues.get(key) ?? Promise.resolve()).then(run, run)
  queues.set(key, pending)
  try { return await pending } catch (error) {
    if (error instanceof Error && error.message.includes('MEMORY_CAPACITY')) await getPlatform().assistant.requestMemoryOrganization()
    throw error
  } finally { if (queues.get(key) === pending) queues.delete(key) }
}

export async function revertMemory(id: string, actor: 'user' | 'assistant' = 'user'): Promise<void> {
  const state = await refreshMemory()
  const change = state.history.find(value => value.id === id)
  if (!change) throw new Error('NOT_FOUND：这次修改已不在最近的历史中。')
  await writeMemory(memoryRevertWrite(change, await readMemory(change.target), actor))
}

/** 免费的确定性整理与模型整理共用逐条写入口；不以猜测替代语义判断。 */
export async function organizeMemory(force = false, proposals: MemoryWrite[] = []): Promise<number> {
  const state = await refreshMemory()
  if (!state.settings.enabled || (!force && !shouldOrganizeMemory(state, new Date()))) return 0
  let changed = 0
  for (const input of proposals) if (await writeMemory({ ...input, actor: 'assistant', entry: input.entry ? { ...input.entry, source: 'assistant' } : null })) changed += 1
  const projects = await getPlatform().documents.listProjects()
  const targets: MemoryTarget[] = [{ layer: 'global' }, ...projects.map(project => ({ layer: 'project' as const, ownerId: project.id }))]
  await videoEditStyleLibrary.ready()
  targets.push(...videoEditStyleLibrary.listStyles().map(entry => ({ layer: 'style' as const, ownerId: entry.style.id })))
  for (const target of targets) for (const input of duplicateMemoryWrites(target.layer, await readMemory(target), target)) {
    if (await writeMemory(input)) changed += 1
  }
  await getPlatform().assistant.markMemoryOrganized(state.changesSinceOrganization + changed)
  await refreshMemory()
  return changed
}
