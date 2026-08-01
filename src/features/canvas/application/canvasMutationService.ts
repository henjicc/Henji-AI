import { useCanvasStore } from '@/stores/canvasStore'

import type { CanvasNodePlacement } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import type { CanvasNodeData } from '../domain/canvasNodes'
import { extractCanvasNodeData } from '../domain/nodeControlRegistry'
import {
  addCanvasNode,
  CanvasApplicationError,
  persistCanvasState,
  rememberCanvasUndo,
  requireCurrentCanvasProject,
} from './canvasApplicationService'

function requireNode(projectId: string, nodeId: string): { id: string; type: string; data: CanvasNodeData } {
  requireCurrentCanvasProject(projectId)
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId)
  if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId })
  return { id: node.id, type: node.type, data: node.data }
}

export function duplicateCanvasNode(input: {
  projectId: string
  nodeId: string
  placement: CanvasNodePlacement
}): Record<string, unknown> {
  const node = requireNode(input.projectId, input.nodeId)
  const data = extractCanvasNodeData(node.type, node.data as Record<string, unknown>)
  const result = addCanvasNode({
    projectId: input.projectId,
    nodeType: node.type,
    placement: input.placement,
    data,
  })
  return { ...result, duplicatedFromNodeId: node.id }
}

export function updateCanvasNode(input: {
  projectId: string
  nodeId: string
  data: Record<string, unknown>
}): Record<string, unknown> {
  const node = requireNode(input.projectId, input.nodeId)
  const safeData = extractCanvasNodeData(node.type, input.data)
  const canvas = useCanvasStore.getState()
  const beforeDepth = canvas.history.past.length
  canvas.updateNodeData(node.id, safeData)
  if (useCanvasStore.getState().history.past.length === beforeDepth) {
    throw new CanvasApplicationError('INVALID_INPUT', '节点数据未发生可保存的变化', true, { nodeId: node.id })
  }
  const undoRef = rememberCanvasUndo(input.projectId, 'update_node')
  persistCanvasState()
  return { projectId: input.projectId, nodeId: node.id, updatedKeys: Object.keys(safeData), undoRef }
}

export function deleteCanvasNodes(projectId: string, nodeIds: string[]): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const existing = new Set(useCanvasStore.getState().nodes.map((node) => node.id))
  const unique = [...new Set(nodeIds)].filter((nodeId) => existing.has(nodeId))
  if (unique.length === 0) throw new CanvasApplicationError('NOT_FOUND', '没有可删除的画布节点', true)
  useCanvasStore.getState().deleteNodes(unique)
  const undoRef = rememberCanvasUndo(projectId, 'delete_nodes')
  persistCanvasState()
  return { projectId, deletedNodeIds: unique, undoRef }
}

export function selectCanvasNode(projectId: string, nodeId: string | null): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  if (nodeId) requireNode(projectId, nodeId)
  useCanvasStore.getState().setSelectedNode(nodeId)
  return { projectId, selectedNodeId: nodeId }
}

export function groupCanvasNodes(projectId: string, nodeIds: string[]): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const groupNodeId = useCanvasStore.getState().groupNodes(nodeIds)
  if (!groupNodeId) throw new CanvasApplicationError('INVALID_INPUT', '至少需要两个存在且不相互嵌套的节点才能分组', true)
  const undoRef = rememberCanvasUndo(projectId, 'group_nodes')
  persistCanvasState()
  return { projectId, groupNodeId, undoRef }
}

export function disconnectCanvasEdge(projectId: string, edgeId: string): Record<string, unknown> {
  requireCurrentCanvasProject(projectId)
  const edge = useCanvasStore.getState().edges.find((item) => item.id === edgeId)
  if (!edge) throw new CanvasApplicationError('NOT_FOUND', '画布连接不存在', true, { edgeId })
  useCanvasStore.getState().deleteEdge(edge.id)
  const undoRef = rememberCanvasUndo(projectId, 'disconnect_edge')
  persistCanvasState()
  return { projectId, edgeId: edge.id, undoRef }
}
