import { v4 as uuidv4 } from 'uuid'

import type { CanvasBatchOperation } from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import { createLogger } from '@/core/logging'
import { useCanvasStore, type CanvasHistoryState, type CanvasNode, type CanvasEdge } from '@/stores/canvasStore'

import {
  addCanvasNode,
  CanvasApplicationError,
  connectCanvasNodes,
  requireCurrentCanvasProject,
} from './canvasApplicationService'
import {
  deleteCanvasNodes,
  disconnectCanvasEdge,
  duplicateCanvasNode,
  groupCanvasNodes,
  selectCanvasNode,
  updateCanvasNode,
} from './canvasMutationService'
import { parseCanvasNodeData } from '../domain/nodeControlRegistry'

interface CanvasBatchPlan {
  planRef: string
  projectId: string
  createdCanvasRevision: number
  createdNodes: CanvasNode[]
  createdEdges: CanvasEdge[]
  operations: CanvasBatchOperation[]
  createdAt: number
  committed: boolean
}

interface CanvasBatchUndo extends CanvasUndoPersistenceState {
  undoRef: string
  projectId: string
  beforeNodes: CanvasNode[]
  beforeEdges: CanvasEdge[]
  beforeHistory: CanvasHistoryState
  beforeSelectedNodeId: string | null
  afterNodes: CanvasNode[]
  afterEdges: CanvasEdge[]
}

// canvasStore 的节点与连线写入始终替换数组引用。事务冲突检测直接保存快照引用即可；
// 若在这里序列化整张画布，工具条每创建一个轻量节点都会同步遍历全部节点、媒体数据与历史，
// 其耗时会随项目体量增长，并阻塞 React 提交新节点的首帧。

const plans = new Map<string, CanvasBatchPlan>()
const undos = new Map<string, CanvasBatchUndo>()
import { pauseCanvasProjectPersistence } from '@/stores/projectStore'
import { confirmCanvasPersistence, runPersistedCanvasUndo, createCanvasMutationCheckpoint, isCanvasMutationCheckpointCurrent, assertCanvasCommitContext, CanvasTransactionConflictError, type CanvasCommitOptions, type CanvasUndoPersistenceState } from './canvasPersistenceService'
const PLAN_TTL_MS = 15 * 60_000
const logger = createLogger('features.canvas.batch')

function cleanupExpiredPlans(): void {
  const threshold = Date.now() - PLAN_TTL_MS
  for (const [key, plan] of plans) if (plan.createdAt < threshold || plan.committed) plans.delete(key)
}

function requireNode(nodeId: string): CanvasNode {
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node) throw new CanvasApplicationError('NOT_FOUND', `画布节点不存在：${nodeId}`, true, { nodeId })
  return node
}

function validateOperation(operation: CanvasBatchOperation): void {
  if (operation.kind === 'add_node') {
    parseCanvasNodeData(operation.nodeType, operation.data)
    if (operation.placement.mode === 'right_of_node') requireNode(operation.placement.anchorNodeId)
    return
  }
  if (operation.kind === 'duplicate_node') {
    requireNode(operation.nodeId)
    if (operation.placement.mode === 'right_of_node') requireNode(operation.placement.anchorNodeId)
    return
  }
  if (operation.kind === 'update_node') {
    const node = requireNode(operation.nodeId)
    parseCanvasNodeData(node.type, operation.data)
    return
  }
  if (operation.kind === 'delete_nodes' || operation.kind === 'group_nodes') {
    for (const nodeId of operation.nodeIds) requireNode(nodeId)
    return
  }
  if (operation.kind === 'connect_nodes') {
    requireNode(operation.sourceNodeId)
    requireNode(operation.targetNodeId)
    return
  }
  if (operation.kind === 'disconnect_edge') {
    if (!useCanvasStore.getState().edges.some((edge) => edge.id === operation.edgeId)) {
      throw new CanvasApplicationError('NOT_FOUND', `画布连接不存在：${operation.edgeId}`, true, { edgeId: operation.edgeId })
    }
    return
  }
  if (operation.nodeId) requireNode(operation.nodeId)
}

function operationSummary(operation: CanvasBatchOperation, index: number): Record<string, unknown> {
  return {
    index,
    kind: operation.kind,
    targetIds: Object.fromEntries(Object.entries(operation).filter(([key]) => key.endsWith('Id') || key.endsWith('Ids')).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])),
  }
}

export function planCanvasBatch(
  projectId: string,
  operations: CanvasBatchOperation[],
  canvasRevision: number,
): Record<string, unknown> {
  cleanupExpiredPlans()
  requireCurrentCanvasProject(projectId)
  operations.forEach(validateOperation)
  const canvas = useCanvasStore.getState()
  const planRef = `canvas-plan:${uuidv4()}`
  plans.set(planRef, {
    planRef,
    projectId,
    createdCanvasRevision: canvasRevision,
    createdNodes: canvas.nodes,
    createdEdges: canvas.edges,
    operations: structuredClone(operations),
    createdAt: Date.now(),
    committed: false,
  })
  return {
    planRef,
    projectId,
    canvasRevision,
    operationCount: operations.length,
    operations: operations.map(operationSummary),
    reversible: true,
  }
}

export function previewCanvasBatch(planRef: string): Record<string, unknown> {
  cleanupExpiredPlans()
  const plan = plans.get(planRef)
  if (!plan) throw new CanvasApplicationError('NOT_FOUND', '画布批量计划不存在或已过期')
  requireCurrentCanvasProject(plan.projectId)
  return {
    planRef: plan.planRef,
    projectId: plan.projectId,
    createdCanvasRevision: plan.createdCanvasRevision,
    operations: plan.operations.map(operationSummary),
    summary: `将按顺序执行 ${plan.operations.length} 个画布操作，完成后生成一个撤销引用。`,
    reversible: true,
  }
}

async function executeOperation(projectId: string, operation: CanvasBatchOperation, options: CanvasCommitOptions): Promise<Record<string, unknown>> {
  assertCanvasCommitContext(projectId, options)
  switch (operation.kind) {
    case 'add_node': return addCanvasNode({ projectId, nodeType: operation.nodeType, placement: operation.placement, data: operation.data }, options)
    case 'duplicate_node': return duplicateCanvasNode({ projectId, nodeId: operation.nodeId, placement: operation.placement }, options)
    case 'update_node': return updateCanvasNode({ projectId, nodeId: operation.nodeId, data: operation.data }, options)
    case 'delete_nodes': return deleteCanvasNodes(projectId, operation.nodeIds, options)
    case 'connect_nodes': return connectCanvasNodes({ projectId, sourceNodeId: operation.sourceNodeId, targetNodeId: operation.targetNodeId }, options)
    case 'disconnect_edge': return disconnectCanvasEdge(projectId, operation.edgeId, options)
    case 'group_nodes': return groupCanvasNodes(projectId, operation.nodeIds, 'spatial', options)
    case 'select_node': {
      const result = selectCanvasNode(projectId, operation.nodeId)
      await confirmCanvasPersistence(projectId, options)
      return result
    }
  }
}

type CanvasAtomicExecutor = (options: CanvasCommitOptions) => Promise<Record<string, unknown>[]>

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
): Promise<{ appliedOperations: Record<string, unknown>[]; undoRef: string }> {
  requireCurrentCanvasProject(projectId)
  const canvas = useCanvasStore.getState()
  // store 写入遵循不可变更新，撤销历史本身也一直保存节点/连线引用。这里保留事务前引用即可；
  // 深拷贝最多 50 步历史会让一次轻量节点创建随画布体量同步放大，直接阻塞新节点首帧。
  const beforeNodes = canvas.nodes
  const beforeEdges = canvas.edges
  const beforeHistory = canvas.history
  const beforeSelectedNodeId = canvas.selectedNodeId
  logger.info('画布批量写入开始', {
    event: 'canvas.batch.apply.start', projectId, operationCount, ...logContext,
  })

  const checkpoint = createCanvasMutationCheckpoint(projectId)
  const releasePersistence = pauseCanvasProjectPersistence(projectId)
  const persistenceEffects: Array<() => void> = []
  let results: Record<string, unknown>[]
  try {
    results = await execute({
      deferCommit: true,
      checkpoint,
      afterPersistenceConfirmed: (effect) => persistenceEffects.push(effect),
    })
  } catch (error) {
    if (!isCanvasMutationCheckpointCurrent(checkpoint)) {
      releasePersistence()
      throw new CanvasTransactionConflictError(projectId, error)
    }
    useCanvasStore.getState().setCanvasData(beforeNodes, beforeEdges, beforeHistory)
    useCanvasStore.getState().setSelectedNode(beforeSelectedNodeId)
    const recovery = confirmCanvasPersistence(projectId)
    releasePersistence()
    await recovery
    logger.error('画布批量写入失败', error, {
      event: 'canvas.batch.apply.failed', projectId, operationCount, ...logContext,
    })
    throw error
  }

  if (!isCanvasMutationCheckpointCurrent(checkpoint)) {
    releasePersistence()
    throw new CanvasTransactionConflictError(projectId)
  }
  const after = useCanvasStore.getState()
  const undoRef = `canvas-batch-undo:${uuidv4()}`
  undos.set(undoRef, {
    undoRef,
    projectId,
    beforeNodes,
    beforeEdges,
    beforeHistory,
    beforeSelectedNodeId,
    afterNodes: after.nodes,
    afterEdges: after.edges,
  })
  // 整批只留一条撤销记录：步骤内部各自记录的历史在这里合并。
  const groupedPast = [...beforeHistory.past, { nodes: beforeNodes, edges: beforeEdges }]
    .slice(-Math.max(after.history.past.length, 1))
  const groupedHistory: CanvasHistoryState = {
    past: groupedPast,
    future: [],
  }
  // 当前 nodes/edges 已由受控 store 写入生成，无需借用 setCanvasData 再迁移整张画布及全部历史。
  useCanvasStore.setState({
    history: groupedHistory,
    dragHistorySnapshot: null,
    activeHistoryGroup: null,
  })
  const completion = confirmCanvasPersistence(projectId)
  releasePersistence()
  await completion
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
 * 批量能力（plan/commit 两段式）与反射层的集合写入都调用它，不要再写第二份「抓快照—执行—
 * 失败回滚—合并撤销历史」的循环。项目里已经因为「同一语义两条实现」吃过四次亏，画布这条
 * 是唯一还没分叉的，别在这里开第一刀。
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

export async function commitCanvasBatch(planRef: string): Promise<Record<string, unknown>> {
  cleanupExpiredPlans()
  const plan = plans.get(planRef)
  if (!plan) throw new CanvasApplicationError('NOT_FOUND', '画布批量计划不存在或已过期')
  if (plan.committed) throw new CanvasApplicationError('CONFLICT', '画布批量计划已经提交')
  requireCurrentCanvasProject(plan.projectId)
  const canvas = useCanvasStore.getState()
  if (canvas.nodes !== plan.createdNodes || canvas.edges !== plan.createdEdges) {
    throw new CanvasApplicationError('STALE_CONTEXT', '画布批量计划创建后项目已发生变化，请重新规划', true, {
      planRef,
      projectId: plan.projectId,
    })
  }
  // 写入本身走共享内核，这里只负责计划态的校验与标记
  const { appliedOperations, undoRef } = await applyCanvasOperationsAtomically(
    plan.projectId,
    plan.operations,
    { planRef },
  )
  plan.committed = true
  return {
    planRef,
    projectId: plan.projectId,
    appliedOperations,
    operationCount: appliedOperations.length,
    undoRef,
    status: 'committed',
  }
}

export async function undoCanvasBatch(projectId: string, undoRef: string): Promise<Record<string, unknown> | null> {
  const record = undos.get(undoRef)
  if (!record) return null
  requireCurrentCanvasProject(projectId)
  await runPersistedCanvasUndo(projectId, undoRef, () => {
    const canvas = useCanvasStore.getState()
    if (
      record.projectId !== projectId
      || canvas.nodes !== record.afterNodes
      || canvas.edges !== record.afterEdges
    ) {
      throw new CanvasApplicationError('STALE_CONTEXT', '批量操作后画布已发生其它变化，该批量撤销引用失效')
    }
    canvas.setCanvasData(record.beforeNodes, record.beforeEdges, record.beforeHistory)
    canvas.setSelectedNode(record.beforeSelectedNodeId)
  }, record)
  undos.delete(undoRef)
  return { projectId, undoRef, operation: 'batch', status: 'undone' }
}

export function resetCanvasBatchStateForTests(): void {
  plans.clear()
  undos.clear()
}
