import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import { flushCanvasProjectSnapshot, useProjectStore } from '@/stores/projectStore'
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation'

const logger = createLogger('features.canvas.persistence')

export interface CanvasMutationCheckpoint {
  projectId: string
  nodes: unknown
  edges: unknown
  history: unknown
  conflicted: boolean
}
export interface CanvasCommitOptions {
  operationCorrelation?: ApplicationPersistenceCorrelation
  deferCommit?: boolean
  checkpoint?: CanvasMutationCheckpoint
  /** 批事务最终持久化成功后才允许触发的外部副作用；回滚或写盘失败时不会执行。 */
  afterPersistenceConfirmed?: (effect: () => void) => void
}

export function assertCanvasPersistenceEffectRegistration(options: CanvasCommitOptions): void {
  if (options.deferCommit && !options.afterPersistenceConfirmed) {
    throw new Error('延迟画布事务缺少持久化后置协调器，不能安全处理外部副作用')
  }
}

export function runAfterCanvasPersistence(options: CanvasCommitOptions, effect: () => void): void {
  if (options.deferCommit) options.afterPersistenceConfirmed!(effect)
  else effect()
}

export class CanvasTransactionConflictError extends Error {
  readonly code = 'STALE_CONTEXT'
  readonly memoryState = 'preserved'
  readonly persistenceState = 'unconfirmed'
  readonly recovery = { capabilityId: 'retry_canvas_project_save', replayMutation: false }
  constructor(readonly projectId: string, readonly cause?: unknown) {
    super('画布事务期间出现新的编辑，已保留当前内容；请重试保存并检查结果后重新规划，不会覆盖新编辑')
    this.name = 'CanvasTransactionConflictError'
  }
}

export function createCanvasMutationCheckpoint(projectId: string): CanvasMutationCheckpoint {
  const { nodes, edges, history } = useCanvasStore.getState()
  return { projectId, nodes, edges, history, conflicted: false }
}

export function isCanvasMutationCheckpointCurrent(checkpoint: CanvasMutationCheckpoint): boolean {
  const canvas = useCanvasStore.getState()
  return !checkpoint.conflicted && useProjectStore.getState().currentProjectId === checkpoint.projectId
    && canvas.nodes === checkpoint.nodes && canvas.edges === checkpoint.edges && canvas.history === checkpoint.history
}

export function assertCanvasCommitContext(projectId: string, options: CanvasCommitOptions): void {
  if (!options.checkpoint) return
  if (options.checkpoint.projectId !== projectId || !isCanvasMutationCheckpointCurrent(options.checkpoint)) {
    options.checkpoint.conflicted = true
    throw new CanvasTransactionConflictError(projectId)
  }
}

/** 将连续同步 store 写入记作本事务的一步；异步资源准备必须放在此步骤之外。 */
export function runCanvasMutationStage<T>(options: CanvasCommitOptions, mutate: () => T): T {
  if (options.checkpoint) assertCanvasCommitContext(options.checkpoint.projectId, options)
  try { return mutate() }
  finally {
    if (options.checkpoint) {
      const { nodes, edges, history } = useCanvasStore.getState()
      Object.assign(options.checkpoint, { nodes, edges, history })
    }
  }
}

export function retainsCanvasMutation(error: unknown): boolean {
  return error instanceof CanvasPersistenceError || error instanceof CanvasTransactionConflictError
}

export class CanvasPersistenceError extends Error {
  readonly code = 'PERSISTENCE_FAILED'
  readonly retryable = true
  readonly recovery = { capabilityId: 'retry_canvas_project_save', replayMutation: false }
  readonly memoryState = 'modified'
  readonly persistenceState = 'unconfirmed'
  constructor(readonly projectId: string, readonly cause: unknown) {
    super('画布修改已保留在当前会话，但保存未确认。请重试保存，不要重复新增、删除或撤销操作。')
    this.name = 'CanvasPersistenceError'
  }
}

/** 自动保存只排队；正式业务操作用 confirmCanvasPersistence 等待同一存储链。 */
export function persistCanvasState(): void {
  const canvas = useCanvasStore.getState()
  useProjectStore.getState().saveCurrentProject(
    canvas.nodes, canvas.edges, canvas.currentViewport, canvas.history,
  )
}

export async function confirmCanvasPersistence(
  projectId: string,
  options: CanvasCommitOptions = {},
): Promise<void> {
  if (options.deferCommit) {
    if (options.checkpoint) {
      const { nodes, edges, history } = useCanvasStore.getState()
      Object.assign(options.checkpoint, { nodes, edges, history })
    }
    return
  }
  if (useProjectStore.getState().currentProjectId !== projectId) {
    throw new Error('当前画布项目已切换，请返回原项目后重试保存')
  }
  persistCanvasState()
  logger.debug('画布保存确认开始', { event: 'canvas.persistence.confirm.start', projectId })
  try {
    await flushCanvasProjectSnapshot(projectId, options.operationCorrelation)
    logger.info('画布保存确认完成', { event: 'canvas.persistence.confirm.completed', projectId })
  } catch (error) {
    logger.error('画布保存尚未确认', error, { event: 'canvas.persistence.confirm.failed', projectId })
    throw new CanvasPersistenceError(projectId, error)
  }
}

const pendingUndos = new Map<string, { projectId: string; nodes: unknown; edges: unknown; history: unknown }>()
export interface CanvasUndoPersistenceState { persistenceUndoApplied?: boolean }
const MAX_PENDING_UNDOS = 100

function expirePendingUndo(token: string): void {
  pendingUndos.delete(token)
}

useCanvasStore.subscribe((canvas) => {
  for (const [token, pending] of pendingUndos) {
    if (pending.nodes !== canvas.nodes || pending.edges !== canvas.edges || pending.history !== canvas.history) {
      expirePendingUndo(token)
    }
  }
})
useProjectStore.subscribe((project) => {
  for (const [token, pending] of pendingUndos) {
    if (pending.projectId !== project.currentProjectId) expirePendingUndo(token)
  }
})

/** 保存失败后的同一撤销只重试写盘；新编辑使旧重试失效，不能再次撤销或覆盖新内容。 */
export async function runPersistedCanvasUndo(
  projectId: string,
  token: string,
  apply: () => void,
  owner: CanvasUndoPersistenceState,
): Promise<void> {
  const pending = pendingUndos.get(token)
  // 已应用事实由原撤销记录持有，不随有限资源缓存淘汰而遗忘。
  if (owner.persistenceUndoApplied && !pending) throw new Error('撤销引用已失效，请重试保存当前画布，不要重复撤销')
  if (pending) {
    const canvas = useCanvasStore.getState()
    if (pending.projectId !== projectId || pending.nodes !== canvas.nodes
      || pending.edges !== canvas.edges || pending.history !== canvas.history) {
      throw new Error('撤销后画布已发生新的编辑，请使用重试保存保留当前内容，不要重复撤销')
    }
  } else {
    apply()
    owner.persistenceUndoApplied = true
    const { nodes, edges, history } = useCanvasStore.getState()
    pendingUndos.set(token, { projectId, nodes, edges, history })
    while (pendingUndos.size > MAX_PENDING_UNDOS) expirePendingUndo(pendingUndos.keys().next().value!)
  }
  await confirmCanvasPersistence(projectId)
  pendingUndos.delete(token)
}
