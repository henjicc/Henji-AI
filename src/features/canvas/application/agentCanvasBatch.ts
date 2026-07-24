import { v4 as uuidv4 } from 'uuid'

import type { CanvasBatchOperation } from '@/core/assistant/hostContracts'
import { useCanvasStore, type CanvasHistoryState, type CanvasNode, type CanvasEdge } from '@/stores/canvasStore'

import {
  addCanvasNodeFromAgent,
  AgentCanvasActionError,
  connectCanvasNodesFromAgent,
  persistAgentCanvasState,
  requireCurrentCanvasProject,
} from './agentCanvasActions'
import {
  deleteCanvasNodesFromAgent,
  disconnectCanvasEdgeFromAgent,
  duplicateCanvasNodeFromAgent,
  groupCanvasNodesFromAgent,
  selectCanvasNodeFromAgent,
  updateCanvasNodeFromAgent,
} from './agentCanvasMutations'
import { parseAgentCanvasNodeData } from '../domain/agentCanvasCatalog'

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

function cleanupExpiredPlans(): void {
  const threshold = Date.now() - PLAN_TTL_MS
  for (const [key, plan] of plans) if (plan.createdAt < threshold || plan.committed) plans.delete(key)
}

function fingerprint(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })),
  })
}

function requireNode(nodeId: string): CanvasNode {
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node) throw new AgentCanvasActionError('NOT_FOUND', `画布节点不存在：${nodeId}`, true, { nodeId })
  return node
}

function validateOperation(operation: CanvasBatchOperation): void {
  if (operation.kind === 'add_node') {
    parseAgentCanvasNodeData(operation.nodeType, operation.data)
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
    parseAgentCanvasNodeData(node.type, operation.data)
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
      throw new AgentCanvasActionError('NOT_FOUND', `画布连接不存在：${operation.edgeId}`, true, { edgeId: operation.edgeId })
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

export function planCanvasBatchFromAgent(
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

export function previewCanvasBatchFromAgent(planRef: string): Record<string, unknown> {
  cleanupExpiredPlans()
  const plan = plans.get(planRef)
  if (!plan) throw new AgentCanvasActionError('NOT_FOUND', '画布批量计划不存在或已过期')
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
    case 'add_node': return addCanvasNodeFromAgent({ projectId, nodeType: operation.nodeType, placement: operation.placement, data: operation.data })
    case 'duplicate_node': return duplicateCanvasNodeFromAgent({ projectId, nodeId: operation.nodeId, placement: operation.placement })
    case 'update_node': return updateCanvasNodeFromAgent({ projectId, nodeId: operation.nodeId, data: operation.data })
    case 'delete_nodes': return deleteCanvasNodesFromAgent(projectId, operation.nodeIds)
    case 'connect_nodes': return connectCanvasNodesFromAgent({ projectId, sourceNodeId: operation.sourceNodeId, targetNodeId: operation.targetNodeId })
    case 'disconnect_edge': return disconnectCanvasEdgeFromAgent(projectId, operation.edgeId)
    case 'group_nodes': return groupCanvasNodesFromAgent(projectId, operation.nodeIds)
    case 'select_node': return selectCanvasNodeFromAgent(projectId, operation.nodeId)
  }
}

export async function commitCanvasBatchFromAgent(planRef: string): Promise<Record<string, unknown>> {
  cleanupExpiredPlans()
  const plan = plans.get(planRef)
  if (!plan) throw new AgentCanvasActionError('NOT_FOUND', '画布批量计划不存在或已过期')
  if (plan.committed) throw new AgentCanvasActionError('CONFLICT', '画布批量计划已经提交')
  requireCurrentCanvasProject(plan.projectId)
  const canvas = useCanvasStore.getState()
  if (fingerprint(canvas.nodes, canvas.edges) !== plan.createdFingerprint) {
    throw new AgentCanvasActionError('STALE_CONTEXT', '画布批量计划创建后项目已发生变化，请重新规划', true, {
      planRef,
      projectId: plan.projectId,
    })
  }
  const beforeNodes = structuredClone(canvas.nodes)
  const beforeEdges = structuredClone(canvas.edges)
  const beforeHistory = structuredClone(canvas.history)
  const results: Record<string, unknown>[] = []
  try {
    for (const operation of plan.operations) results.push(await executeOperation(plan.projectId, operation))
  } catch (error) {
    useCanvasStore.getState().setCanvasData(beforeNodes, beforeEdges, beforeHistory)
    persistAgentCanvasState()
    throw error
  }
  const after = useCanvasStore.getState()
  const afterFingerprint = fingerprint(after.nodes, after.edges)
  const undoRef = `canvas-batch-undo:${uuidv4()}`
  undos.set(undoRef, {
    undoRef,
    projectId: plan.projectId,
    beforeNodes,
    beforeEdges,
    beforeHistory,
    afterFingerprint,
  })
  const groupedHistory: CanvasHistoryState = {
    past: [...beforeHistory.past, { nodes: beforeNodes, edges: beforeEdges }],
    future: [],
  }
  useCanvasStore.getState().setCanvasData(after.nodes, after.edges, groupedHistory)
  persistAgentCanvasState()
  plan.committed = true
  return {
    planRef,
    projectId: plan.projectId,
    appliedOperations: results,
    operationCount: results.length,
    undoRef,
    status: 'committed',
  }
}

export function undoCanvasBatchFromAgent(projectId: string, undoRef: string): Record<string, unknown> | null {
  const record = undos.get(undoRef)
  if (!record) return null
  requireCurrentCanvasProject(projectId)
  const canvas = useCanvasStore.getState()
  if (record.projectId !== projectId || fingerprint(canvas.nodes, canvas.edges) !== record.afterFingerprint) {
    throw new AgentCanvasActionError('STALE_CONTEXT', '批量操作后画布已发生其它变化，该批量撤销引用失效')
  }
  canvas.setCanvasData(record.beforeNodes, record.beforeEdges, record.beforeHistory)
  persistAgentCanvasState()
  undos.delete(undoRef)
  return { projectId, undoRef, operation: 'batch', status: 'undone' }
}

export function resetAgentCanvasBatchStateForTests(): void {
  plans.clear()
  undos.clear()
}
