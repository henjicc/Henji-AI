import { useEffect, useRef } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
import {
  isTypingTarget,
  resolveClipboardMediaFile,
  type ClipboardMediaKind,
  type ClipboardSnapshot,
} from '@/features/canvas/canvasUtils'

const CLIPBOARD_MEDIA_NODE_TYPE: Record<ClipboardMediaKind, CanvasNodeType> = {
  image: CANVAS_NODE_TYPES.upload,
  video: CANVAS_NODE_TYPES.videoUpload,
  audio: CANVAS_NODE_TYPES.audioUpload,
}

interface UseCanvasShortcutsParams {
  wrapperRef: React.RefObject<HTMLDivElement>
  reactFlowInstance: ReactFlowInstance<CanvasNode, CanvasEdge>
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
  addNode: (type: CanvasNodeType, position: { x: number; y: number }, data?: Partial<CanvasNodeData>) => string
  setSelectedNode: (nodeId: string | null) => void
}

export function useCanvasShortcuts(params: UseCanvasShortcutsParams): void {
  const {
    wrapperRef,
    reactFlowInstance,
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
    addNode,
    setSelectedNode
  } = params

  const copiedSnapshotRef = useRef<ClipboardSnapshot | null>(null)
  const pasteImageHandledRef = useRef(false)
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY }
    }
    document.addEventListener('mousemove', handlePointerMove)
    return () => {
      document.removeEventListener('mousemove', handlePointerMove)
    }
  }, [])

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
      if (isTypingTarget(event.target)) return

      const media = resolveClipboardMediaFile(event)
      if (!media) return

      if (selectedUploadNodeId && media.kind === 'image') {
        event.preventDefault()
        pasteImageHandledRef.current = true
        canvasEventBus.publish('upload-node/paste-image', {
          nodeId: selectedUploadNodeId,
          file: media.file,
        })
        return
      }

      // 画布级粘贴：鼠标停留在画布内时，粘贴图片/视频/音频会以鼠标位置为基准新建节点
      const pointerPosition = pointerPositionRef.current
      const containerRect = wrapperRef.current?.getBoundingClientRect()
      const isPointerInsideCanvas = Boolean(
        pointerPosition && containerRect
        && pointerPosition.x >= containerRect.left && pointerPosition.x <= containerRect.right
        && pointerPosition.y >= containerRect.top && pointerPosition.y <= containerRect.bottom
      )
      if (!isPointerInsideCanvas || !pointerPosition) return

      event.preventDefault()
      pasteImageHandledRef.current = true

      const nodeType = CLIPBOARD_MEDIA_NODE_TYPE[media.kind]
      const flowPosition = reactFlowInstance.screenToFlowPosition(pointerPosition)
      const newNodeId = addNode(nodeType, flowPosition)
      setSelectedNode(newNodeId)
      window.setTimeout(() => {
        canvasEventBus.publish('canvas/paste-media', { nodeId: newNodeId, file: media.file })
      }, 0)
      scheduleCanvasPersist(0)
    }

    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [addNode, reactFlowInstance, scheduleCanvasPersist, selectedUploadNodeId, setSelectedNode, wrapperRef])

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
        // 是否为剪贴板媒体粘贴（新建节点/写入选中上传节点）由 document 的 paste 事件监听器判定，
        // 这里统一延后一帧检查 pasteImageHandledRef，避免与内部节点复制粘贴重复触发
        const copied = copiedSnapshotRef.current
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
    undo
  ])
}
