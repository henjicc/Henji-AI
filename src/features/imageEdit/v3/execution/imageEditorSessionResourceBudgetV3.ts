import {
  ImageEditResourceBudget,
  type ImageEditMemorySnapshot,
  type ImageEditResourceBudgetOptions,
} from '@/core/imageEdit/v3/resourceBudget'

interface ImageEditorSessionResourceBudgetEntryV3 {
  budget: ImageEditResourceBudget
  consumers: Map<string, symbol>
}

export interface ImageEditorSessionResourceBudgetLeaseV3 {
  readonly budget: ImageEditResourceBudget
  release(): void
}

export interface ImageEditorSessionResourceBudgetSnapshotV3 {
  readonly sessionId: string
  readonly consumers: number
  readonly memory: ImageEditMemorySnapshot
}

const sessionBudgets = new Map<string, ImageEditorSessionResourceBudgetEntryV3>()

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
 * 同一编辑会话内的代理、视口瓦片、Worker 工作集与成品共享唯一硬预算。
 * 调用方必须在自身资源全部释放后归还 lease；最后一个调用方离开时移除 registry 条目。
 */
export function acquireImageEditorSessionResourceBudgetV3(
  sessionId: string,
  options: AcquireImageEditorSessionResourceBudgetOptionsV3,
): ImageEditorSessionResourceBudgetLeaseV3 {
  const normalized = normalizeSessionId(sessionId)
  const consumerId = normalizeConsumerId(options.consumerId)
  let entry = sessionBudgets.get(normalized)
  if (!entry) {
    entry = {
      budget: new ImageEditResourceBudget(options.budgetOptions),
      consumers: new Map(),
    }
    sessionBudgets.set(normalized, entry)
  } else if (options.budgetOptions) {
    throw new Error('已有图片编辑会话资源账本时不能重新指定预算')
  }
  const token = Symbol(consumerId)
  entry.consumers.set(consumerId, token)
  let released = false
  return {
    budget: entry.budget,
    release: () => {
      if (released) return
      released = true
      const current = sessionBudgets.get(normalized)
      if (!current || current !== entry) return
      if (current.consumers.get(consumerId) !== token) return
      current.consumers.delete(consumerId)
      if (current.consumers.size > 0) return
      sessionBudgets.delete(normalized)
    },
  }
}

export function inspectImageEditorSessionResourceBudgetV3(
  sessionId: string,
): ImageEditorSessionResourceBudgetSnapshotV3 | null {
  const normalized = normalizeSessionId(sessionId)
  const entry = sessionBudgets.get(normalized)
  return entry
    ? { sessionId: normalized, consumers: entry.consumers.size, memory: entry.budget.snapshot() }
    : null
}
