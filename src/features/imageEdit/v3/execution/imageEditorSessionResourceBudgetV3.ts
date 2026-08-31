import {
  ImageEditResourceBudget,
  type ImageEditMemorySnapshot,
  type ImageEditResourceBudgetOptions,
} from '@/core/imageEdit/v3/resourceBudget'

interface ImageEditorGlobalResourceBudgetEntryV3 {
  budget: ImageEditResourceBudget
  sessions: Map<string, Map<string, symbol>>
}

export interface ImageEditorSessionResourceBudgetLeaseV3 {
  readonly budget: ImageEditResourceBudget
  release(): void
}

export interface ImageEditorSessionResourceBudgetSnapshotV3 {
  readonly sessionId: string
  readonly consumers: number
  readonly globalConsumers: number
  readonly activeSessions: number
  readonly memory: ImageEditMemorySnapshot
}

export interface ImageEditorGlobalResourceBudgetSnapshotV3 {
  readonly consumers: number
  readonly activeSessions: number
  readonly memory: ImageEditMemorySnapshot
}

let globalBudgetEntry: ImageEditorGlobalResourceBudgetEntryV3 | null = null

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim()
  if (!normalized) throw new Error('图片编辑资源账本会话 ID 不能为空')
  return normalized
}

function normalizeConsumerId(consumerId: string): string {
  const normalized = consumerId.trim()
  if (!normalized) throw new Error('图片编辑资源账本使用者 ID 不能为空')
  return normalized
}

export interface AcquireImageEditorSessionResourceBudgetOptionsV3 {
  consumerId: string
  budgetOptions?: ImageEditResourceBudgetOptions
}

/**
 * 当前渲染进程内的所有编辑会话、代理、视口瓦片、Worker 工作集与导出共享唯一硬预算。
 * 调用方必须在自身资源全部释放后归还 lease；最后一个调用方离开且没有遗留内存 lease
 * 时重置 registry，避免测试或后续独立编辑会话继承旧的自定义预算。
 */
export function acquireImageEditorSessionResourceBudgetV3(
  sessionId: string,
  options: AcquireImageEditorSessionResourceBudgetOptionsV3,
): ImageEditorSessionResourceBudgetLeaseV3 {
  const normalized = normalizeSessionId(sessionId)
  const consumerId = normalizeConsumerId(options.consumerId)
  if (
    globalBudgetEntry
    && globalBudgetEntry.sessions.size === 0
    && globalBudgetEntry.budget.snapshot().leaseCount === 0
  ) globalBudgetEntry = null
  let entry = globalBudgetEntry
  if (!entry) {
    entry = {
      budget: new ImageEditResourceBudget(options.budgetOptions),
      sessions: new Map(),
    }
    globalBudgetEntry = entry
  } else if (options.budgetOptions) {
    throw new Error('已有全局图片编辑资源账本时不能重新指定预算')
  }
  const consumers = entry.sessions.get(normalized) ?? new Map<string, symbol>()
  entry.sessions.set(normalized, consumers)
  const token = Symbol(consumerId)
  consumers.set(consumerId, token)
  let released = false
  return {
    budget: entry.budget,
    release: () => {
      if (released) return
      released = true
      const current = globalBudgetEntry
      if (!current || current !== entry) return
      const currentConsumers = current.sessions.get(normalized)
      if (!currentConsumers || currentConsumers.get(consumerId) !== token) return
      currentConsumers.delete(consumerId)
      if (currentConsumers.size === 0) current.sessions.delete(normalized)
      if (current.sessions.size === 0 && current.budget.snapshot().leaseCount === 0) {
        globalBudgetEntry = null
      }
    },
  }
}

function countGlobalConsumers(entry: ImageEditorGlobalResourceBudgetEntryV3): number {
  return [...entry.sessions.values()].reduce((total, consumers) => total + consumers.size, 0)
}

export function inspectImageEditorSessionResourceBudgetV3(
  sessionId: string,
): ImageEditorSessionResourceBudgetSnapshotV3 | null {
  const normalized = normalizeSessionId(sessionId)
  const entry = globalBudgetEntry
  const consumers = entry?.sessions.get(normalized)
  return entry && consumers
    ? {
        sessionId: normalized,
        consumers: consumers.size,
        globalConsumers: countGlobalConsumers(entry),
        activeSessions: entry.sessions.size,
        memory: entry.budget.snapshot(),
      }
    : null
}

export function inspectImageEditorGlobalResourceBudgetV3(): ImageEditorGlobalResourceBudgetSnapshotV3 | null {
  const entry = globalBudgetEntry
  return entry
    ? {
        consumers: countGlobalConsumers(entry),
        activeSessions: entry.sessions.size,
        memory: entry.budget.snapshot(),
      }
    : null
}
