import { createSnapshot, hasCanvasContentChanged, MAX_HISTORY_STEPS, restoreCanvasSnapshot } from '@/stores/canvasStoreHelpers';
import { findCanvasProjectInstance, getCanvasProjectInstance, leaseCanvasProject, requireCanvasProjectInstance } from './canvasProjectInstances';
import { v4 as uuidv4 } from 'uuid';
import { ZodError } from 'zod';
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure';

import { createLogger } from '@/core/logging';
import { type CanvasHistoryState } from '@/stores/canvasStore';

import { addCanvasNode, connectCanvasNodes } from './canvasApplicationService';
import { applyCanvasNodePropertyPatches, applyStoryboardFramePatches, deleteCanvasNodes, disconnectCanvasEdge, type CanvasNodePropertyPatch } from './canvasMutationService';

/** 通用集合写入翻译成的画布步骤：新建节点、删除节点、连线、断开连线。 */
export type CanvasBatchOperation =
  | { kind: 'add_node'; nodeType: string; placement: { mode: 'viewport_center' } | { mode: 'right_of_node'; anchorNodeId: string }
    /** 新建时一并写入的可写属性（标题、正文、位置、节点数据…），与建好之后再改走同一个写入内核。 */
    properties?: Omit<CanvasNodePropertyPatch, 'nodeId'> }
  | { kind: 'delete_nodes'; nodeIds: string[] }
  | { kind: 'connect_nodes'; sourceNodeId: string; targetNodeId: string; sourceHandle?: string; targetHandle?: string }
  | { kind: 'disconnect_edge'; edgeId: string }

// canvasStore 的节点与连线写入始终替换数组引用。事务冲突检测直接保存快照引用即可；
// 若在这里序列化整张画布，工具条每创建一个轻量节点都会同步遍历全部节点、媒体数据与历史，
// 其耗时会随项目体量增长，并阻塞 React 提交新节点的首帧。

import { canvasBatchUndos as undos } from './canvasBatchUndo'
export { undoCanvasBatch } from './canvasBatchUndo'
import { pauseCanvasProjectPersistence } from './canvasPersistenceService';
import { confirmCanvasPersistence, createCanvasMutationCheckpoint, isCanvasMutationCheckpointCurrent, assertCanvasCommitContext, CanvasTransactionConflictError, CanvasTransactionRolledBackError, CanvasPersistenceError, CanvasSourceCompensationError, type CanvasCommitOptions, type CanvasTransactionRuntime } from './canvasPersistenceService';
const logger = createLogger('features.canvas.batch')

async function executeOperation(projectId: string, operation: CanvasBatchOperation, options: CanvasCommitOptions): Promise<Record<string, unknown>> {
  if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
  assertCanvasCommitContext(projectId, options)
  switch (operation.kind) {
    case 'add_node': {
      const created = await addCanvasNode({ projectId, nodeType: operation.nodeType, placement: operation.placement }, options)
      if (operation.properties && Object.keys(operation.properties).length) {
        const patch = { ...operation.properties, nodeId: String(created.nodeId) }
        await applyCanvasNodePropertyPatches(projectId, [patch], options)
        if (patch.storyboardFrames) await applyStoryboardFramePatches(projectId, patch.nodeId, patch.storyboardFrames, options)
      }
      return created
    }
    case 'delete_nodes': return deleteCanvasNodes(projectId, operation.nodeIds, options)
    case 'connect_nodes': return connectCanvasNodes({ projectId, sourceNodeId: operation.sourceNodeId, targetNodeId: operation.targetNodeId,
      sourceHandle: operation.sourceHandle, targetHandle: operation.targetHandle }, options)
    case 'disconnect_edge': return disconnectCanvasEdge(projectId, operation.edgeId, options)
  }
}

type CanvasAtomicExecutor = (options: CanvasCommitOptions) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>

/**
 * 共享画布事务内核。当后续操作需要使用前一步产生的节点 id 时，
 * 不能预先写成静态 CanvasBatchOperation[]，但仍必须复用这一份
 * 「抓快照—执行—失败回滚—合并历史—持久化」语义。
 */
export async function runCanvasTransaction(
  projectId: string,
  operationCount: number,
  execute: CanvasAtomicExecutor,
  logContext: Record<string, unknown> = {},
  runtime?: CanvasTransactionRuntime,
): Promise<{ appliedOperations: Record<string, unknown>[]; undoRef: string }> {
  if (runtime) return await executeCanvasTransaction(projectId, operationCount, execute, logContext, runtime)
  // 界面直接写入不带 runtime（调用方没占租约）：批次含异步步骤时用户可能中途切走页面，
  // 后台释放或离开不能在批次中途关闭会话，所以整批期间占一份租约。
  // 画布正在离开时拿不到租约：界面卸载时发出的收尾写入（全景快照、图层回写等）仍要照常落到这次离开里，不拒绝。
  const instance = findCanvasProjectInstance(projectId) ?? await getCanvasProjectInstance(projectId)
  let releaseLease: () => void
  try { releaseLease = leaseCanvasProject(instance) } catch {
    return await executeCanvasTransaction(projectId, operationCount, execute, logContext)
  }
  try { return await executeCanvasTransaction(projectId, operationCount, execute, logContext) }
  finally { releaseLease() }
}

async function executeCanvasTransaction(
  projectId: string,
  operationCount: number,
  execute: CanvasAtomicExecutor,
  logContext: Record<string, unknown>,
  runtime?: CanvasTransactionRuntime,
): Promise<{ appliedOperations: Record<string, unknown>[]; undoRef: string }> {
  if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
  if (runtime ? !runtime.isCurrent() : false) throw new CanvasTransactionConflictError(projectId, undefined, false)
  if (!runtime) requireCanvasProjectInstance(projectId)
  const store = runtime?.store ?? requireCanvasProjectInstance(projectId).store
  const persist = runtime?.persist ?? (() => confirmCanvasPersistence(projectId))
  const canvas = store.getState()
  // store 写入遵循不可变更新，撤销历史本身也一直保存节点/连线引用。这里保留事务前引用即可；
  // 深拷贝最多 50 步历史会让一次轻量节点创建随画布体量同步放大，直接阻塞新节点首帧。
  const beforeNodes = canvas.nodes
  const beforeEdges = canvas.edges
  const beforeHistory = canvas.history
  const beforeSelectedNodeId = canvas.selectedNodeId
  logger.info('画布批量写入开始', {
    event: 'canvas.batch.apply.start', projectId, operationCount, ...logContext,
  })

  const checkpoint = createCanvasMutationCheckpoint(projectId, runtime)
  // 每个写入阶段结束才把检查点推进到当前画布；仍等于事务前引用，说明本事务还没写过。
  const transactionWrote = () => checkpoint.nodes !== beforeNodes || checkpoint.edges !== beforeEdges || checkpoint.history !== beforeHistory
  const releasePersistence = runtime ? runtime.pause() : pauseCanvasProjectPersistence(projectId)
  const persistenceEffects: Array<() => void> = []
  const rollbackEffects: Array<() => Promise<void>> = []
  let results: Record<string, unknown>[]
  try {
    const execution = execute({
      deferCommit: true,
      checkpoint,
      afterPersistenceConfirmed: (effect) => persistenceEffects.push(effect),
      afterRollbackConfirmed: (effect) => rollbackEffects.push(effect),
    })
    // 无 I/O 的组合写入在同一个同步阶段封存，避免 React 挂载/测量插入半成品事务。
    results = Array.isArray(execution) ? execution : await execution
  } catch (error) {
    if (!isCanvasMutationCheckpointCurrent(checkpoint)) {
      releasePersistence()
      // 来源副本属于本事务的外部写入，画布检查点看不到它。
      throw new CanvasTransactionConflictError(projectId, error, transactionWrote() || error instanceof CanvasSourceCompensationError)
    }
    // 只有事务仍保持原始快照的参数校验失败，才有证据认定未写入。
    // 已修改后失败、外部并发冲突、回滚保存失败均不得伪装成“未执行”。
    const rejectedBeforeMutation = error instanceof ZodError
      && checkpoint.nodes === beforeNodes && checkpoint.edges === beforeEdges && checkpoint.history === beforeHistory
    const view = store.getState()
    const selectedNodeId = beforeNodes.some((node) => node.id === view.selectedNodeId)
      ? view.selectedNodeId : beforeSelectedNodeId
    const activeToolDialog = beforeNodes.some((node) => node.id === view.activeToolDialog?.nodeId)
      ? view.activeToolDialog : null
    restoreCanvasSnapshot(store.setState, beforeNodes, beforeEdges, beforeHistory)
    store.setState({ selectedNodeId, activeToolDialog })
    const recovery = persist()
    releasePersistence()
    await recovery
    // 步骤自己报告来源补偿未完成时，合并进同一份失败，不能包成“已回滚”。
    const original = error instanceof CanvasSourceCompensationError ? error.errors[0] : error
    const compensationFailures: unknown[] = error instanceof CanvasSourceCompensationError ? error.errors.slice(1) : []
    for (const effect of rollbackEffects.reverse()) {
      try { await effect() } catch (compensationError) { compensationFailures.push(compensationError) }
    }
    if (compensationFailures.length) {
      const failure = new CanvasSourceCompensationError(original, compensationFailures)
      logger.error('画布批事务来源补偿失败', failure, { event: 'canvas.batch.rollback.failed', projectId })
      throw failure
    }
    logger[rejectedBeforeMutation ? 'warn' : 'error']('画布批量写入失败', error, {
      event: 'canvas.batch.apply.failed', projectId, operationCount, ...logContext,
    })
    throw rejectedBeforeMutation ? new ApplicationPreflightFailure(error) : new CanvasTransactionRolledBackError(error)
  }

  if (!isCanvasMutationCheckpointCurrent(checkpoint)) {
    releasePersistence()
    throw new CanvasTransactionConflictError(projectId, undefined, transactionWrote())
  }
  const after = store.getState()
  const undoRef = `canvas-batch-undo:${uuidv4()}`
  undos.set(undoRef, {
    undoRef,
    projectId,
    beforeNodes: createSnapshot(beforeNodes, beforeEdges).nodes,
    beforeEdges,
    beforeHistory,
    beforeSelectedNodeId,
    afterNodes: after.nodes,
    afterEdges: after.edges,
  })
  // 整批只留一条撤销记录：步骤内部各自记录的历史在这里合并。
  const groupedHistory: CanvasHistoryState = hasCanvasContentChanged(canvas, after) ? {
    past: [...beforeHistory.past, createSnapshot(beforeNodes, beforeEdges)].slice(-MAX_HISTORY_STEPS),
    future: [],
  } : beforeHistory
  // 当前 nodes/edges 已由受控 store 写入生成，无需借用 setCanvasData 再迁移整张画布及全部历史。
  store.setState({
    history: groupedHistory,
    dragHistorySnapshot: null,
    activeHistoryGroup: null,
  })
  const completion = persist()
  releasePersistence()
  try { await completion }
  catch (error) {
    if (error instanceof CanvasPersistenceError) {
      const oldIds = new Set(beforeNodes.map((node) => node.id))
      const refs = after.nodes.filter((node) => !oldIds.has(node.id)).map((node) => ({ kind: 'canvas.node', id: `${projectId}:${node.id}` }))
      error.transactionFacts = {
        status: 'failed', code: 'EXECUTION_FAILED', message: error.message, recoverable: true,
        resultRefs: refs,
        effects: refs.length ? [{ effect: 'create', entityType: 'canvas.node', refs, propertyIds: [], origin: { kind: 'direct' } }] : [],
        persistence: { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'projection',
          recovery: { capabilityId: 'retry_canvas_document_save', target: { kind: 'canvas.document', id: projectId }, replayMutation: false } },
        partial: { completedStepIndexes: results.map((_, index) => index), compensatedStepIndexes: [], uncompensatedStepIndexes: results.map((_, index) => index) },
        recoveryVerification: { conditions: refs.map((target) => ({ kind: 'entity_exists', target })),
          evidence: refs.map((target) => ({ kind: 'entity_state', target, fact: '原事务已创建此结果节点，等待保存确认。', capturedAt: new Date().toISOString() })) },
      }
    }
    throw error
  }
  for (const effect of persistenceEffects) {
    try {
      effect()
    } catch (error) {
      // 业务数据已经持久化成功；后置协调失败只能单独记录并由领域任务重入恢复，
      // 不能把已经完成的画布事务谎报成失败。
      logger.error('画布持久化后置协调启动失败', error, {
        event: 'canvas.batch.after_persistence.failed', projectId, ...logContext,
      })
    }
  }
  logger.info('画布批量写入完成', {
    event: 'canvas.batch.apply.completed', projectId, operationCount: results.length, undoRef, ...logContext,
  })
  return { appliedOperations: results, undoRef }
}

/**
 * 原子地应用一组画布操作，**这是画布批量写入的唯一内核**。
 *
 * 反射层的集合写入调用它，不要再写第二份「抓快照—执行—失败回滚—合并撤销历史」的循环。
 * 项目里已经因为「同一语义两条实现」吃过四次亏，画布这条是唯一还没分叉的，别在这里开第一刀。
 *
 * 语义保证：
 * - 业务失败仅在本批次仍持有状态时补偿；出现新编辑或存储拒绝时保留现场并报告恢复动作
 * - 成功后整批合成**一条**撤销历史，用户按一次撤销就能整体退回
 * - 返回的 undoRef 可交给 `undoCanvasBatch` 精确回退，且带指纹校验防止过期引用
 */
export async function applyCanvasOperationsAtomically(
  projectId: string,
  operations: CanvasBatchOperation[],
  logContext: Record<string, unknown> = {},
): Promise<{ appliedOperations: Record<string, unknown>[]; undoRef: string }> {
  if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
  return await runCanvasTransaction(projectId, operations.length, async (options) => {
    const results: Record<string, unknown>[] = []
    for (const [index, operation] of operations.entries()) {
      results.push({
        index,
        kind: operation.kind,
        ...await executeOperation(projectId, operation, options),
      })
    }
    return results
  }, logContext)
}

export function resetCanvasBatchStateForTests(): void {
  undos.clear()
}
