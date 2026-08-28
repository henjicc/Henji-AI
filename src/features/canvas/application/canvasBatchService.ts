import { v4 as uuidv4 } from 'uuid'

import type { CanvasBatchOperation } from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import { createLogger } from '@/core/logging'
import { useCanvasStore, type CanvasHistoryState, type CanvasNode, type CanvasEdge } from '@/stores/canvasStore'

import {
  addCanvasNode,
  CanvasApplicationError,
  connectCanvasNodes,
  persistCanvasState,
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
  createdFingerprint: string
  operations: CanvasBatchOperation[]
  createdAt: number
  committed: boolean
}

interface CanvasBatchUndo {
  undoRef: string
  projectId: string
  beforeNodes: CanvasNode[]
  beforeEdges: CanvasEdge[]
  beforeHistory: CanvasHistoryState
  afterFingerprint: string
}

const plans = new Map<string, CanvasBatchPlan>()
const undos = new Map<string, CanvasBatchUndo>()
const PLAN_TTL_MS = 15 * 60_000
const logger = createLogger('features.canvas.batch')

function cleanupExpiredPlans(): void {
  const threshold = Date.now() - PLAN_TTL_MS
  for (const [key, plan] of plans) if (plan.createdAt < threshold || plan.committed) plans.delete(key)
}

function fingerprint(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: edge.data,
    })),
  })
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
  const planRef = `canvas-plan:${uuidv4()}`
  plans.set(planRef, {
    planRef,
    projectId,
    createdCanvasRevision: canvasRevision,
    createdFingerprint: fingerprint(useCanvasStore.getState().nodes, useCanvasStore.getState().edges),
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

async function executeOperation(projectId: string, operation: CanvasBatchOperation): Promise<Record<string, unknown>> {
  switch (operation.kind) {
    case 'add_node': return addCanvasNode({ projectId, nodeType: operation.nodeType, placement: operation.placement, data: operation.data })
    case 'duplicate_node': return duplicateCanvasNode({ projectId, nodeId: operation.nodeId, placement: operation.placement })
    case 'update_node': return updateCanvasNode({ projectId, nodeId: operation.nodeId, data: operation.data })
    case 'delete_nodes': return deleteCanvasNodes(projectId, operation.nodeIds)
    case 'connect_nodes': return connectCanvasNodes({ projectId, sourceNodeId: operation.sourceNodeId, targetNodeId: operation.targetNodeId })
    case 'disconnect_edge': return disconnectCanvasEdge(projectId, operation.edgeId)
    case 'group_nodes': return groupCanvasNodes(projectId, operation.nodeIds)
    case 'select_node': return selectCanvasNode(projectId, operation.nodeId)
  }
}

type CanvasAtomicExecutor = () => Promise<Record<string, unknown>[]>

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
  const beforeNodes = structuredClone(canvas.nodes)
  const beforeEdges = structuredClone(canvas.edges)
  const beforeHistory = structuredClone(canvas.history)
  logger.info('画布批量写入开始', {
    event: 'canvas.batch.apply.start', projectId, operationCount, ...logContext,
  })

  let results: Record<string, unknown>[]
  try {
    results = await execute()
  } catch (error) {
    useCanvasStore.getState().setCanvasData(beforeNodes, beforeEdges, beforeHistory)
    persistCanvasState()
    logger.error('画布批量写入失败', error, {
      event: 'canvas.batch.apply.failed', projectId, operationCount, ...logContext,
    })
    throw error
  }

  const after = useCanvasStore.getState()
  const undoRef = `canvas-batch-undo:${uuidv4()}`
  undos.set(undoRef, {
    undoRef,
    projectId,
    beforeNodes,
    beforeEdges,
    beforeHistory,
    afterFingerprint: fingerprint(after.nodes, after.edges),
  })
  // 整批只留一条撤销记录：步骤内部各自记录的历史在这里合并。
  const groupedHistory: CanvasHistoryState = {
    past: [...beforeHistory.past, { nodes: beforeNodes, edges: beforeEdges }],
    future: [],
  }
  useCanvasStore.getState().setCanvasData(after.nodes, after.edges, groupedHistory)
  persistCanvasState()
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
 * - 任一操作失败，整批回滚到调用前状态，异常原样上抛
 * - 成功后整批合成**一条**撤销历史，用户按一次撤销就能整体退回
 * - 返回的 undoRef 可交给 `undoCanvasBatch` 精确回退，且带指纹校验防止过期引用
 */
export async function applyCanvasOperationsAtomically(
  projectId: string,
  operations: CanvasBatchOperation[],
  logContext: Record<string, unknown> = {},
): Promise<{ appliedOperations: Record<string, unknown>[]; undoRef: string }> {
  return await runCanvasTransaction(projectId, operations.length, async () => {
    const results: Record<string, unknown>[] = []
    for (const [index, operation] of operations.entries()) {
      results.push({
        index,
        kind: operation.kind,
        ...await executeOperation(projectId, operation),
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
  if (fingerprint(canvas.nodes, canvas.edges) !== plan.createdFingerprint) {
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

export function undoCanvasBatch(projectId: string, undoRef: string): Record<string, unknown> | null {
  const record = undos.get(undoRef)
  if (!record) return null
  requireCurrentCanvasProject(projectId)
  const canvas = useCanvasStore.getState()
  if (record.projectId !== projectId || fingerprint(canvas.nodes, canvas.edges) !== record.afterFingerprint) {
    throw new CanvasApplicationError('STALE_CONTEXT', '批量操作后画布已发生其它变化，该批量撤销引用失效')
  }
  canvas.setCanvasData(record.beforeNodes, record.beforeEdges, record.beforeHistory)
  persistCanvasState()
  undos.delete(undoRef)
  return { projectId, undoRef, operation: 'batch', status: 'undone' }
}

export function resetCanvasBatchStateForTests(): void {
  plans.clear()
  undos.clear()
}
