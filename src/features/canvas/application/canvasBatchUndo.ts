import { findCanvasProjectInstance, getCanvasProjectInstance, requireCanvasProjectInstance } from './canvasProjectInstances'
import type { CanvasHistoryState, CanvasNode, CanvasEdge } from '@/stores/canvasStore'
import { CanvasApplicationError } from './canvasApplicationError'
import { runPersistedCanvasUndo, type CanvasUndoPersistenceState } from './canvasPersistenceService'

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

export const canvasBatchUndos = new Map<string, CanvasBatchUndo>()

export async function undoCanvasBatch(projectId: string, undoRef: string): Promise<Record<string, unknown> | null> {
  if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
  const record = canvasBatchUndos.get(undoRef)
  if (!record) return null
  requireCanvasProjectInstance(projectId)
  await runPersistedCanvasUndo(projectId, undoRef, () => {
    const canvas = requireCanvasProjectInstance(projectId).store.getState()
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
  canvasBatchUndos.delete(undoRef)
  return { projectId, undoRef, operation: 'batch', status: 'undone' }
}

