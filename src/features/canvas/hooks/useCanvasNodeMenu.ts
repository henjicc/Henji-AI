import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  Connection,
  FinalConnectionState,
  HandleType,
  OnConnectStartParams,
  ReactFlowInstance
} from '@xyflow/react'
import type { CanvasEdge, CanvasNode, CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import {
  type CanvasNodeDefinition,
  getMenuNodeDefinitions,
  canvasNodeDefinitions,
  isConnectionCompatible,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry'
import { mediaSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import { isParamPortId } from '@/features/canvas/domain/socketTypes'
import {
  canSourceTypeConnectToTargetHandle,
  resolveCompatibleTargetHandleForSource,
} from '@/features/canvas/application/graphValueResolver'
import {
  canNodeBeManualConnectionSource,
  canNodeTypeBeManualConnectionSource,
  createPreviewPath,
  getClientPosition,
  resolveMediaFileKind,
  type CanvasMediaKind,
  type PendingConnectStart,
  type PreviewConnectionVisual
} from '@/features/canvas/canvasUtils'

interface UseCanvasNodeMenuParams {
  wrapperRef: React.RefObject<HTMLDivElement>
  reactFlowInstance: ReactFlowInstance<CanvasNode, CanvasEdge>
  nodes: CanvasNode[]
  addNode: (type: CanvasNodeType, position: { x: number; y: number }) => string
  connectNodes: (connection: Connection) => void
  scheduleCanvasPersist: (delayMs?: number) => void
  setSelectedNode: (nodeId: string | null) => void
}

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

const QUICK_ADD_GAP = 80
const DEFAULT_QUICK_ADD_SIZE: RectLike = { x: 0, y: 0, width: 220, height: 120 }

export function aggregateQuickConnectMenuDefinitions(
  definitions: CanvasNodeDefinition[]
): { types: CanvasNodeType[]; uploadKinds: CanvasMediaKind[] } {
  const uploadKinds = definitions
    .filter((definition) => definition.media?.role === 'source')
    .map((definition) => definition.media?.kind)
    .filter((kind): kind is CanvasMediaKind => Boolean(kind))
  const types = definitions
    .filter((definition) => definition.visibleInMenu)
    .map((definition) => definition.type)
  if (uploadKinds.length > 0) {
    types.push(CANVAS_NODE_TYPES.universalUpload)
  }
  return {
    types: Array.from(new Set(types)),
    uploadKinds: Array.from(new Set(uploadKinds)),
  }
}

function estimateQuickAddSize(type: CanvasNodeType): Pick<RectLike, 'width' | 'height'> {
  switch (type) {
    case CANVAS_NODE_TYPES.universalUpload:
      return { width: 240, height: 240 }
    case CANVAS_NODE_TYPES.intSource:
    case CANVAS_NODE_TYPES.floatSource:
    case CANVAS_NODE_TYPES.booleanSource:
      return { width: 160, height: 56 }
    case CANVAS_NODE_TYPES.stringSource:
      return { width: 300, height: 132 }
    case CANVAS_NODE_TYPES.imageModelSelector:
    case CANVAS_NODE_TYPES.videoModelSelector:
    case CANVAS_NODE_TYPES.audioModelSelector:
      return { width: 240, height: 56 }
    default:
      return DEFAULT_QUICK_ADD_SIZE
  }
}

function getNodeRect(node: CanvasNode): RectLike {
  const measured = node.measured
  const width = typeof measured?.width === 'number' && Number.isFinite(measured.width)
    ? measured.width
    : DEFAULT_QUICK_ADD_SIZE.width
  const height = typeof measured?.height === 'number' && Number.isFinite(measured.height)
    ? measured.height
    : DEFAULT_QUICK_ADD_SIZE.height
  return {
    x: node.position.x,
    y: node.position.y,
    width,
    height,
  }
}

function rectsOverlap(left: RectLike, right: RectLike): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function resolveQuickAddPosition(
  type: CanvasNodeType,
  requestedPosition: { x: number; y: number },
  pending: PendingConnectStart | null,
  nodes: CanvasNode[]
): { x: number; y: number } {
  if (!pending) {
    return requestedPosition
  }
  const anchorNode = nodes.find((node) => node.id === pending.nodeId)
  if (!anchorNode) {
    return requestedPosition
  }

  const anchorRect = getNodeRect(anchorNode)
  const newSize = estimateQuickAddSize(type)
  const requestedRect = {
    x: requestedPosition.x,
    y: requestedPosition.y,
    width: newSize.width,
    height: newSize.height,
  }
  if (!rectsOverlap(requestedRect, anchorRect)) {
    return requestedPosition
  }

  const nextX = pending.handleType === 'target'
    ? anchorRect.x - newSize.width - QUICK_ADD_GAP
    : anchorRect.x + anchorRect.width + QUICK_ADD_GAP

  return {
    x: nextX,
    y: requestedPosition.y - newSize.height / 2,
  }
}

export function useCanvasNodeMenu(params: UseCanvasNodeMenuParams) {
  const {
    wrapperRef,
    reactFlowInstance,
    nodes,
    addNode,
    connectNodes,
    scheduleCanvasPersist,
    setSelectedNode
  } = params

  const suppressNextPaneClickRef = useRef(false)
  const [showNodeMenu, setShowNodeMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const [flowPosition, setFlowPosition] = useState({ x: 0, y: 0 })
  const [menuAllowedTypes, setMenuAllowedTypes] = useState<CanvasNodeType[] | undefined>(undefined)
  const [menuUploadKinds, setMenuUploadKinds] = useState<CanvasMediaKind[]>([])
  const [pendingConnectStart, setPendingConnectStart] = useState<PendingConnectStart | null>(null)
  const [previewConnectionVisual, setPreviewConnectionVisual] = useState<PreviewConnectionVisual | null>(null)

  const clearMenu = useCallback(() => {
    setShowNodeMenu(false)
    setMenuAllowedTypes(undefined)
    setMenuUploadKinds([])
    setPendingConnectStart(null)
    setPreviewConnectionVisual(null)
  }, [])

  const openNodeMenuAtClientPosition = useCallback((clientX: number, clientY: number) => {
    const containerRect = wrapperRef.current?.getBoundingClientRect()
    if (!containerRect) return

    const flowPos = reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY })
    setFlowPosition(flowPos)
    setMenuPosition({
      x: clientX - containerRect.left,
      y: clientY - containerRect.top,
    })
    setMenuAllowedTypes(undefined)
    setMenuUploadKinds([])
    setPendingConnectStart(null)
    setPreviewConnectionVisual(null)
    setShowNodeMenu(true)
  }, [reactFlowInstance, wrapperRef])

  const resolveAllowedTypesForPending = useCallback((pending: PendingConnectStart): {
    types: CanvasNodeType[]
    uploadKinds: CanvasMediaKind[]
  } => {
    const fromNode = nodes.find((node) => node.id === pending.nodeId)
    if (!fromNode) {
      return { types: [], uploadKinds: [] }
    }

    if (pending.handleType === 'source') {
      return {
        types: getMenuNodeDefinitions()
        .filter((definition) => definition.connectivity.targetHandle)
        .filter((definition) => Boolean(
          resolveCompatibleTargetHandleForSource(fromNode, definition.type, pending.handleId)
        ))
        .map((definition) => definition.type),
        uploadKinds: [],
      }
    }

    const compatibleDefinitions = Object.values(canvasNodeDefinitions)
      .filter((definition) => canNodeTypeBeManualConnectionSource(definition.type))
      .filter((definition) => canSourceTypeConnectToTargetHandle(definition.type, fromNode, pending.handleId))
    return aggregateQuickConnectMenuDefinitions(compatibleDefinitions)
  }, [nodes])

  const handlePaneClick = useCallback((event: ReactMouseEvent) => {
    if (suppressNextPaneClickRef.current) {
      suppressNextPaneClickRef.current = false
      return
    }
    if (event.detail >= 2) {
      openNodeMenuAtClientPosition(event.clientX, event.clientY)
      return
    }
    setSelectedNode(null)
    clearMenu()
  }, [clearMenu, openNodeMenuAtClientPosition, setSelectedNode])

  const handlePaneContextMenu = useCallback((event: ReactMouseEvent<Element> | MouseEvent) => {
    event.preventDefault()
    setSelectedNode(null)
    openNodeMenuAtClientPosition(event.clientX, event.clientY)
  }, [openNodeMenuAtClientPosition, setSelectedNode])

  const handleNodeSelect = useCallback((requestedType: CanvasNodeType, file?: File) => {
    let type = requestedType
    if (requestedType === CANVAS_NODE_TYPES.universalUpload && pendingConnectStart) {
      const kind = file ? resolveMediaFileKind(file) : null
      if (!kind || !menuUploadKinds.includes(kind)) {
        return
      }
      type = mediaSourceNodeType(kind)
    }

    const newNodePosition = resolveQuickAddPosition(type, flowPosition, pendingConnectStart, nodes)
    const newNodeId = addNode(type, newNodePosition)
    if (pendingConnectStart) {
      if (pendingConnectStart.handleType === 'source') {
        // 从某节点的输出端口拖出 → 新节点作为目标，按端口/参数类型定位目标端口
        const fromNode = nodes.find((node) => node.id === pendingConnectStart.nodeId)
        const targetHandle = fromNode
          ? resolveCompatibleTargetHandleForSource(fromNode, type, pendingConnectStart.handleId)
          : null
        if (targetHandle) {
          connectNodes({
            source: pendingConnectStart.nodeId,
            target: newNodeId,
            sourceHandle: pendingConnectStart.handleId ?? 'source',
            targetHandle,
          })
        }
      } else {
        // 从某个输入端口拖出 → 新节点作为来源，对端端口沿用起拖时的具体 handle id
        connectNodes({
          source: newNodeId,
          target: pendingConnectStart.nodeId,
          sourceHandle: 'source',
          targetHandle: pendingConnectStart.handleId ?? 'target',
        })
      }
    }
    if (file) {
      window.setTimeout(() => {
        canvasEventBus.publish('canvas/import-media', { nodeId: newNodeId, file })
      }, 0)
    }
    scheduleCanvasPersist(0)
    clearMenu()
  }, [addNode, clearMenu, connectNodes, flowPosition, menuUploadKinds, nodes, pendingConnectStart, scheduleCanvasPersist])

  const handleConnectStart = useCallback(
    (event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      setShowNodeMenu(false)
      setMenuAllowedTypes(undefined)
      setMenuUploadKinds([])
      setPreviewConnectionVisual(null)

      if (!params.nodeId || !params.handleType) {
        setPendingConnectStart(null)
        return
      }
      if (
        params.handleType === 'source'
        && !canNodeBeManualConnectionSource(params.nodeId, nodes)
      ) {
        setPendingConnectStart(null)
        return
      }

      const containerRect = wrapperRef.current?.getBoundingClientRect()
      const eventTarget = event.target as Element | null
      const handleElement = eventTarget?.closest?.('.react-flow__handle') as HTMLElement | null
      const clientPosition = getClientPosition(event)
      let start: { x: number; y: number } | undefined
      if (containerRect && handleElement) {
        const handleRect = handleElement.getBoundingClientRect()
        start = {
          x: handleRect.left - containerRect.left + handleRect.width / 2,
          y: handleRect.top - containerRect.top + handleRect.height / 2,
        }
      } else if (containerRect && clientPosition) {
        start = {
          x: clientPosition.x - containerRect.left,
          y: clientPosition.y - containerRect.top,
        }
      }

      setPendingConnectStart({
        nodeId: params.nodeId,
        handleType: params.handleType as HandleType,
        handleId: params.handleId,
        start,
      })
    },
    [nodes, wrapperRef]
  )

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid || !pendingConnectStart) {
        setPendingConnectStart(null)
        setPreviewConnectionVisual(null)
        return
      }

      const clientPosition = getClientPosition(event)
      const containerRect = wrapperRef.current?.getBoundingClientRect()
      if (!clientPosition || !containerRect) {
        setPendingConnectStart(null)
        setPreviewConnectionVisual(null)
        return
      }

      const eventTarget = event.target as Element | null
      const nodeElementFromTarget = eventTarget?.closest?.('.react-flow__node[data-id]') as HTMLElement | null
      const nodeElementFromPoint = document.elementFromPoint(clientPosition.x, clientPosition.y)
        ?.closest?.('.react-flow__node[data-id]') as HTMLElement | null
      const dropNodeElement = nodeElementFromTarget ?? nodeElementFromPoint
      const dropNodeId = dropNodeElement?.dataset?.id ?? null

      if (dropNodeId && dropNodeId !== pendingConnectStart.nodeId) {
        const sourceNode =
          pendingConnectStart.handleType === 'source'
            ? nodes.find((node) => node.id === pendingConnectStart.nodeId)
            : nodes.find((node) => node.id === dropNodeId)
        const targetNode =
          pendingConnectStart.handleType === 'source'
            ? nodes.find((node) => node.id === dropNodeId)
            : nodes.find((node) => node.id === pendingConnectStart.nodeId)

        const targetHandle = sourceNode && targetNode
          ? (pendingConnectStart.handleType === 'target'
            ? (pendingConnectStart.handleId ?? 'target')
            : resolveCompatibleTargetHandleForSource(
              sourceNode,
              targetNode.type,
              pendingConnectStart.handleId,
            ))
          : null
        const compatible = Boolean(
          sourceNode &&
          targetNode &&
          canNodeTypeBeManualConnectionSource(sourceNode.type) &&
          nodeHasSourceHandle(sourceNode.type) &&
          nodeHasTargetHandle(targetNode.type) &&
          targetHandle &&
          (isParamPortId(targetHandle)
            ? canSourceTypeConnectToTargetHandle(
              sourceNode.type,
              targetNode,
              targetHandle,
              pendingConnectStart.handleType === 'source'
                ? pendingConnectStart.handleId
                : 'source',
            )
            : isConnectionCompatible(
              sourceNode.type,
              targetNode.type,
              pendingConnectStart.handleType === 'source'
                ? pendingConnectStart.handleId
                : 'source',
              sourceNode.data,
            ))
        )
        if (compatible && sourceNode && targetNode && targetHandle) {
          // 从目标端口起拖：直接沿用起拖时的具体 handle id（精确到行）；
          // 从源端口起拖：目标节点的落点行由源节点输出类型反推
          connectNodes({
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: pendingConnectStart.handleType === 'source'
              ? (pendingConnectStart.handleId ?? 'source')
              : 'source',
            targetHandle,
          })
          scheduleCanvasPersist(0)
          setPendingConnectStart(null)
          setPreviewConnectionVisual(null)
          return
        }
      }

      const allowedMenu = resolveAllowedTypesForPending(pendingConnectStart)
      if (allowedMenu.types.length === 0) {
        setPendingConnectStart(null)
        setPreviewConnectionVisual(null)
        return
      }

      const endX = clientPosition.x - containerRect.left
      const endY = clientPosition.y - containerRect.top
      let startX: number | null = pendingConnectStart.start?.x ?? null
      let startY: number | null = pendingConnectStart.start?.y ?? null

      if (startX === null || startY === null) {
        const nodeElement = wrapperRef.current?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${pendingConnectStart.nodeId}"]`
        )
        const handleElement = nodeElement?.querySelector<HTMLElement>(
          `.react-flow__handle-${pendingConnectStart.handleType}`
        )
        if (handleElement) {
          const handleRect = handleElement.getBoundingClientRect()
          startX = handleRect.left - containerRect.left + handleRect.width / 2
          startY = handleRect.top - containerRect.top + handleRect.height / 2
        } else if (nodeElement) {
          const nodeRect = nodeElement.getBoundingClientRect()
          startX =
            pendingConnectStart.handleType === 'source'
              ? nodeRect.right - containerRect.left
              : nodeRect.left - containerRect.left
          startY = nodeRect.top - containerRect.top + nodeRect.height / 2
        } else if (connectionState.from) {
          startX = connectionState.from.x
          startY = connectionState.from.y
        }
      }

      if (startX === null || startY === null) {
        setPreviewConnectionVisual(null)
      } else {
        setPreviewConnectionVisual({
          d: createPreviewPath({
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
            handleType: pendingConnectStart.handleType,
          }),
          stroke: 'rgba(255,255,255,0.9)',
          strokeWidth: 1,
          strokeLinecap: 'round',
          left: 0,
          top: 0,
          width: containerRect.width,
          height: containerRect.height,
        })
      }

      const flowPos = reactFlowInstance.screenToFlowPosition(clientPosition)
      setFlowPosition(flowPos)
      setMenuPosition({
        x: clientPosition.x - containerRect.left,
        y: clientPosition.y - containerRect.top,
      })
      setMenuAllowedTypes(allowedMenu.types)
      setMenuUploadKinds(allowedMenu.uploadKinds)
      suppressNextPaneClickRef.current = true
      setShowNodeMenu(true)
    },
    [connectNodes, nodes, pendingConnectStart, reactFlowInstance, resolveAllowedTypesForPending, scheduleCanvasPersist, wrapperRef]
  )

  return {
    showNodeMenu,
    menuPosition,
    menuAllowedTypes,
    menuUploadKinds,
    previewConnectionVisual,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeSelect,
    handleConnectStart,
    handleConnectEnd,
    closeNodeMenu: clearMenu,
  }
}
