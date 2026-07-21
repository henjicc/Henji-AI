import { useCallback } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { readAssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasEdge, CanvasNode, CanvasNodeData, CanvasNodeType } from '../domain/canvasNodes'
import { assetSourceNodeData, assetSourceNodeType } from '../application/assetMediaAssignment'

interface Options {
  reactFlowInstance: ReactFlowInstance<CanvasNode, CanvasEdge>
  addNode: (type: CanvasNodeType, position: { x: number; y: number }, data?: Partial<CanvasNodeData>) => string
  schedulePersist: () => void
}

export function useCanvasAssetDrop({ reactFlowInstance, addNode, schedulePersist }: Options): {
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
} {
  const onDragOver = useCallback((event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('application/x-henji-drag-data')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDrop = useCallback((event: React.DragEvent): void => {
    const payload = readAssetDragPayload(event.dataTransfer)
    if (!payload) return
    event.preventDefault()
    addNode(assetSourceNodeType(payload.type), reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }), assetSourceNodeData(payload))
    schedulePersist()
  }, [addNode, reactFlowInstance, schedulePersist])
  return { onDragOver, onDrop }
}
