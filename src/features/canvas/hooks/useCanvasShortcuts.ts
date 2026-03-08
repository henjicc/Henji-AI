import { useEffect, useRef } from 'react'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { isTypingTarget, resolveClipboardImageFile, type ClipboardSnapshot } from '@/features/canvas/canvasUtils'

interface UseCanvasShortcutsParams {
  selectedUploadNodeId: string | null
  selectedNodeIds: string[]
  selectedNodeId: string | null
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  deleteNode: (nodeId: string) => void
  deleteNodes: (nodeIds: string[]) => void
  groupNodes: (nodeIds: string[]) => string | null
  undo: () => boolean
  redo: () => boolean
  scheduleCanvasPersist: (delayMs?: number) => void
  duplicateNodes: (sourceNodeIds: string[]) => { firstNodeId: string | null } | null
  setSelectedNode: (nodeId: string | null) => void
}

export function useCanvasShortcuts(params: UseCanvasShortcutsParams): void {
  const {
    selectedUploadNodeId,
    selectedNodeIds,
    selectedNodeId,
    nodes,
    edges,
    deleteNode,
    deleteNodes,
    groupNodes,
    undo,
    redo,
    scheduleCanvasPersist,
    duplicateNodes,
    setSelectedNode
  } = params

  const copiedSnapshotRef = useRef<ClipboardSnapshot | null>(null)
  const pasteImageHandledRef = useRef(false)

  useEffect(() => {
    if (selectedNodeIds.length === 1) {
      if (selectedNodeId !== selectedNodeIds[0]) {
        setSelectedNode(selectedNodeIds[0])
      }
      return
    }

    if (selectedNodeId !== null) {
      setSelectedNode(null)
    }
  }, [selectedNodeId, selectedNodeIds, setSelectedNode])

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      pasteImageHandledRef.current = false
      if (!selectedUploadNodeId || isTypingTarget(event.target)) return

      const imageFile = resolveClipboardImageFile(event)
      if (!imageFile) return

      event.preventDefault()
      pasteImageHandledRef.current = true
      canvasEventBus.publish('upload-node/paste-image', {
        nodeId: selectedUploadNodeId,
        file: imageFile,
      })
    }

    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [selectedUploadNodeId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      const commandPressed = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const isUndo = commandPressed && key === 'z' && !event.shiftKey
      const isRedo = commandPressed && (key === 'y' || (key === 'z' && event.shiftKey))
      const isGroup = commandPressed && key === 'g'
      const isCopy = commandPressed && key === 'c' && !event.shiftKey
      const isPaste = commandPressed && key === 'v' && !event.shiftKey

      if (isCopy) {
        if (selectedNodeIds.length === 0) return
        event.preventDefault()
        const selectedIdSet = new Set(selectedNodeIds)
        copiedSnapshotRef.current = {
          nodes: nodes.filter((node) => selectedIdSet.has(node.id)),
          edges: edges.filter(
            (edge) => selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target)
          ),
        }
        return
      }

      if (isPaste) {
        const copied = copiedSnapshotRef.current
        if (selectedUploadNodeId) {
          pasteImageHandledRef.current = false
          window.setTimeout(() => {
            if (pasteImageHandledRef.current) {
              pasteImageHandledRef.current = false
              return
            }
            if (!copied || copied.nodes.length === 0) return
            void duplicateNodes(copied.nodes.map((node) => node.id))
          }, 0)
          return
        }

        if (!copied || copied.nodes.length === 0) return
        event.preventDefault()
        void duplicateNodes(copied.nodes.map((node) => node.id))
        return
      }

      if (isUndo || isRedo) {
        event.preventDefault()
        const changed = isUndo ? undo() : redo()
        if (changed) {
          scheduleCanvasPersist(0)
        }
        return
      }

      if (isGroup) {
        if (selectedNodeIds.length < 2) return
        event.preventDefault()
        const createdGroupId = groupNodes(selectedNodeIds)
        if (createdGroupId) {
          scheduleCanvasPersist(0)
        }
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      const idsToDelete = selectedNodeIds.length > 0
        ? selectedNodeIds
        : selectedNodeId
          ? [selectedNodeId]
          : []
      if (idsToDelete.length === 0) return

      event.preventDefault()
      if (idsToDelete.length === 1) {
        deleteNode(idsToDelete[0])
      } else {
        deleteNodes(idsToDelete)
      }
      scheduleCanvasPersist(0)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    deleteNode,
    deleteNodes,
    duplicateNodes,
    edges,
    groupNodes,
    nodes,
    redo,
    scheduleCanvasPersist,
    selectedNodeId,
    selectedNodeIds,
    selectedUploadNodeId,
    undo
  ])
}
