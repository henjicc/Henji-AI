import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import type { MemorySnapshot } from '@/core/assistant/memoryEntries'
const logger = createLogger('features.assistant.memory')
const listeners = new Set<() => void>()
let subscribed = false
let snapshot: MemorySnapshot | undefined
export function subscribeMemory(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function cachedMemory(): MemorySnapshot | undefined { return snapshot }
export async function refreshMemory(): Promise<MemorySnapshot> {
  if (!subscribed && getPlatform().assistant.onMemoryChange) { subscribed = true; getPlatform().assistant.onMemoryChange(() => { void refreshMemory().catch(error => { logger.error('记忆刷新失败', error, { event: 'memory.refresh.failed' }) }) }) }
  const next = await getPlatform().assistant.getMemoryState()
  const changed = !snapshot || snapshot.revision !== next.revision
  snapshot = next
  if (changed) listeners.forEach(listener => listener())
  return snapshot
}

/** 正式界面显示恢复办法，协议代码与校验结构留在日志和能力结果里。 */
export function memoryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim().startsWith('[') ? '这条记忆无法保存，请检查内容和长度。' : message.replace(/^(?:Error:\s*)?[A-Z_]+[：:]\s*/, '')
}
