import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  Connection,
  FinalConnectionState,
  HandleType,
  OnConnectStartParams,
  ReactFlowInstance
} from '@xyflow/react'
import type { CanvasEdge, CanvasNode, CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import {
  getMenuNodeDefinitions,
  isConnectionCompatible,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '@/features/canvas/domain/nodeRegistry'
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
  const [pendingConnectStart, setPendingConnectStart] = useState<PendingConnectStart | null>(null)
  const [previewConnectionVisual, setPreviewConnectionVisual] = useState<PreviewConnectionVisual | null>(null)

  const clearMenu = useCallback(() => {
    setShowNodeMenu(false)
    setMenuAllowedTypes(undefined)
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
    setPendingConnectStart(null)
    setPreviewConnectionVisual(null)
    setShowNodeMenu(true)
  }, [reactFlowInstance, wrapperRef])

  const resolveAllowedTypesForPending = useCallback((pending: PendingConnectStart): CanvasNodeType[] => {
    const fromNode = nodes.find((node) => node.id === pending.nodeId)
    if (!fromNode) {
      return []
    }

    if (pending.handleType === 'source') {
      return getMenuNodeDefinitions()
        .filter((definition) => definition.connectivity.targetHandle)
        .filter((definition) => Boolean(resolveCompatibleTargetHandleForSource(fromNode, definition.type)))
        .map((definition) => definition.type)
    }

    return getMenuNodeDefinitions()
      .filter((definition) => canNodeTypeBeManualConnectionSource(definition.type))
      .filter((definition) => canSourceTypeConnectToTargetHandle(definition.type, fromNode, pending.handleId))
      .map((definition) => definition.type)
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

  const handleNodeSelect = useCallback((type: CanvasNodeType) => {
      const newNodeId = addNode(type, flowPosition)
    if (pendingConnectStart) {
      if (pendingConnectStart.handleType === 'source') {
        // 从某节点的输出端口拖出 → 新节点作为目标，按端口/参数类型定位目标端口
        const fromNode = nodes.find((node) => node.id === pendingConnectStart.nodeId)
        const targetHandle = fromNode ? resolveCompatibleTargetHandleForSource(fromNode, type) : null
        if (targetHandle) {
          connectNodes({
            source: pendingConnectStart.nodeId,
            target: newNodeId,
            sourceHandle: 'source',
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
    scheduleCanvasPersist(0)
    clearMenu()
  }, [addNode, clearMenu, connectNodes, flowPosition, nodes, pendingConnectStart, scheduleCanvasPersist])

  const handleConnectStart = useCallback(
    (event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      setShowNodeMenu(false)
      setMenuAllowedTypes(undefined)
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
            : resolveCompatibleTargetHandleForSource(sourceNode, targetNode.type))
          : null
        const compatible = Boolean(
          sourceNode &&
          targetNode &&
          canNodeTypeBeManualConnectionSource(sourceNode.type) &&
          nodeHasSourceHandle(sourceNode.type) &&
          nodeHasTargetHandle(targetNode.type) &&
          targetHandle &&
          (isParamPortId(targetHandle)
            ? canSourceTypeConnectToTargetHandle(sourceNode.type, targetNode, targetHandle)
            : isConnectionCompatible(sourceNode.type, targetNode.type))
        )
        if (compatible && sourceNode && targetNode && targetHandle) {
          // 从目标端口起拖：直接沿用起拖时的具体 handle id（精确到行）；
          // 从源端口起拖：目标节点的落点行由源节点输出类型反推
          connectNodes({
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: 'source',
            targetHandle,
          })
          scheduleCanvasPersist(0)
          setPendingConnectStart(null)
          setPreviewConnectionVisual(null)
          return
        }
      }

      const allowedTypes = resolveAllowedTypesForPending(pendingConnectStart)
      if (allowedTypes.length === 0) {
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
      setMenuAllowedTypes(allowedTypes)
      suppressNextPaneClickRef.current = true
      setShowNodeMenu(true)
    },
    [connectNodes, nodes, pendingConnectStart, reactFlowInstance, resolveAllowedTypesForPending, scheduleCanvasPersist, wrapperRef]
  )

  return {
    showNodeMenu,
    menuPosition,
    menuAllowedTypes,
    previewConnectionVisual,
    handlePaneClick,
    handleNodeSelect,
    handleConnectStart,
    handleConnectEnd,
    closeNodeMenu: clearMenu,
  }
}
