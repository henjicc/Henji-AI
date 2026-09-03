import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import type { Connection, NodeChange } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  CANVAS_NODE_TYPES,
  isAssetGroupNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
import { cloneCameraStageProject } from '@/features/cameraStage/projects/cameraStageProjectService'
import { rebaseCanvasLocalPromptData } from '@/features/canvas/application/generationPromptDocument'
import {
  cloneNodeData,
  getNodeSize,
  hasRectCollision,
  type DuplicateOptions,
  type DuplicateResult,
} from '@/features/canvas/canvasUtils'
import { reconcileAssetGroupGraph } from '@/features/canvas/application/assetGroupGraph'
import { resetDuplicatedCanvasExecutionData } from '@/features/canvas/application/canvasDuplicationExecutionState'
import { commitCanvasNodeDuplication } from '@/features/canvas/application/canvasMutationService'

interface UseCanvasDuplicationParams {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedNodeIds: string[]
  addNode: (type: CanvasNodeType, position: { x: number; y: number }, data?: DynamicValueMap) => string
  applyNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  connectNodes: (connection: Connection) => void
  setSelectedNode: (nodeId: string | null) => void
  scheduleCanvasPersist: (delayMs?: number) => void
}

export function useCanvasDuplication(params: UseCanvasDuplicationParams) {
  const {
    nodes,
    edges,
    selectedNodeIds,
    addNode,
    applyNodesChange,
    connectNodes,
    setSelectedNode,
    scheduleCanvasPersist
  } = params

  const pasteIterationRef = useRef(0)
  const altDragCopyRef = useRef<{
    sourceNodeIds: string[]
    startPositions: Map<string, { x: number; y: number }>
  } | null>(null)

  const duplicateNodes = useCallback(
    async (sourceNodeIds: string[], options: DuplicateOptions = {}): Promise<DuplicateResult | null> => {
      const dedupedIds = Array.from(new Set(sourceNodeIds))
      if (dedupedIds.length === 0) return null

      const requestedIds = new Set(dedupedIds)
      for (const node of nodes) {
        if (node.parentId && requestedIds.has(node.parentId)) requestedIds.add(node.id)
      }
      const sourceNodes = nodes.filter((node) => requestedIds.has(node.id))
      if (sourceNodes.length === 0) return null

      const sourceIdSet = new Set(sourceNodes.map((node) => node.id))
      const internalEdges = edges.filter(
        (edge) => sourceIdSet.has(edge.source)
          && sourceIdSet.has(edge.target)
          && !edge.data?.managedByAssetGroup
      )

      const baseOffsets = [
        { x: 44, y: 30 },
        { x: 72, y: 8 },
        { x: 18, y: 68 },
        { x: 96, y: 42 },
      ]
      const existingNodes = useCanvasStore.getState().nodes
      const ignoreNodeIds = new Set<string>()
      const offsetStep = options.disableOffsetIteration ? 0 : pasteIterationRef.current
      let chosenOffset = options.explicitOffset ?? baseOffsets[0]

      const isOffsetAvailable = (offset: { x: number; y: number }) => sourceNodes.every((node) => {
        const size = getNodeSize(node)
        return !hasRectCollision(
          {
            x: node.position.x + offset.x + offsetStep * 8,
            y: node.position.y + offset.y + offsetStep * 6,
            width: size.width,
            height: size.height,
          },
          existingNodes,
          ignoreNodeIds
        )
      })

      if (!options.explicitOffset) {
        const matchedBaseOffset = baseOffsets.find((offset) => isOffsetAvailable(offset))
        if (matchedBaseOffset) {
          chosenOffset = matchedBaseOffset
        } else {
          const maxStep = 16
          for (let step = 1; step <= maxStep; step += 1) {
            const candidate = { x: 24 + step * 26, y: 16 + step * 18 }
            if (isOffsetAvailable(candidate)) {
              chosenOffset = candidate
              break
            }
          }
        }
      }

      const idMap = new Map<string, string>()
      const sizeMap = new Map<string, { width: number; height: number }>()
      for (const sourceNode of sourceNodes) {
        const data = cloneNodeData(sourceNode.data)
        resetDuplicatedCanvasExecutionData(sourceNode.type, data as DynamicValueMap)

        const projectId = useProjectStore.getState().currentProjectId
        if (!projectId) throw new Error('当前没有可复制节点的项目')
        const nextNodeId = await commitCanvasNodeDuplication({
          projectId,
          sourceNodeId: sourceNode.id,
          data: { ...(data as DynamicValueMap) },
          createNode: (forkedData) => addNode(
            sourceNode.type as CanvasNodeType,
            {
              x: sourceNode.position.x + chosenOffset.x + offsetStep * 8,
              y: sourceNode.position.y + chosenOffset.y + offsetStep * 6,
            },
            forkedData,
          ),
        })
        idMap.set(sourceNode.id, nextNodeId)
        sizeMap.set(nextNodeId, getNodeSize(sourceNode))
        const promptPatch = rebaseCanvasLocalPromptData(
          data as DynamicValueMap,
          sourceNode.id,
          nextNodeId,
        )
        if (promptPatch) {
          useCanvasStore.getState().updateNodeData(nextNodeId, promptPatch, { skipHistory: true })
        }
        if (sourceNode.type === CANVAS_NODE_TYPES.cameraStage) {
          const projectId = (data as { projectId?: DynamicValue }).projectId
          if (typeof projectId === 'string' && projectId) {
            void cloneCameraStageProject(projectId).then((copied) => {
              if (copied) useCanvasStore.getState().updateNodeData(nextNodeId, { projectId: copied.id })
            })
          }
        }
      }

      const sizeSyncChanges = Array.from(sizeMap.entries()).map(([nodeId, size]) => ({
        id: nodeId,
        type: 'dimensions' as const,
        dimensions: { width: size.width, height: size.height },
        resizing: false,
        setAttributes: true,
      }))
      if (sizeSyncChanges.length > 0) {
        applyNodesChange(sizeSyncChanges)
      }

      for (const edge of internalEdges) {
        const nextSource = idMap.get(edge.source)
        const nextTarget = idMap.get(edge.target)
        if (!nextSource || !nextTarget) continue
        connectNodes({
          source: nextSource,
          target: nextTarget,
          sourceHandle: edge.sourceHandle ?? 'source',
          targetHandle: edge.targetHandle ?? 'target',
        })
      }

      const copiedAssetGroups = sourceNodes.filter(isAssetGroupNode)
      if (copiedAssetGroups.length > 0) {
        const current = useCanvasStore.getState()
        const regroupedNodes = current.nodes.map((node) => {
          const originalEntry = Array.from(idMap.entries()).find(([, copiedId]) => copiedId === node.id)
          if (!originalEntry) return node
          const original = sourceNodes.find((candidate) => candidate.id === originalEntry[0])
          if (!original) return node
          if (isAssetGroupNode(original)) {
            return {
              ...node,
              data: {
                ...original.data,
                memberOrder: original.data.memberOrder
                  .map((memberId) => idMap.get(memberId))
                  .filter((memberId): memberId is string => Boolean(memberId)),
                coverMemberId: original.data.coverMemberId
                  ? idMap.get(original.data.coverMemberId) ?? null
                  : null,
                bindings: [],
              },
            }
          }
          if (original.parentId && idMap.has(original.parentId)) {
            return {
              ...node,
              parentId: idMap.get(original.parentId),
              position: original.position,
              hidden: true,
              selected: false,
            }
          }
          return node
        })
        const reconciled = reconcileAssetGroupGraph(regroupedNodes, current.edges)
        useCanvasStore.setState({ nodes: reconciled.nodes, edges: reconciled.edges })
      }

      if (!options.disableOffsetIteration) {
        pasteIterationRef.current += 1
      }
      const firstNodeId = idMap.get(sourceNodes[0].id) ?? null
      if (firstNodeId && !options.suppressSelect) {
        setSelectedNode(firstNodeId)
      }
      if (!options.suppressPersist) {
        scheduleCanvasPersist(0)
      }
      return { firstNodeId, idMap }
    },
    [addNode, applyNodesChange, connectNodes, edges, nodes, scheduleCanvasPersist, setSelectedNode]
  )

  const handleNodeDragStart = useCallback(
    (event: ReactMouseEvent, node: CanvasNode) => {
      if (!event.altKey) {
        altDragCopyRef.current = null
        return
      }

      const sourceNodeIds = selectedNodeIds.includes(node.id)
        ? selectedNodeIds
        : [node.id]
      if (sourceNodeIds.length === 0) {
        altDragCopyRef.current = null
        return
      }
      const startPositions = new Map<string, { x: number; y: number }>()
      for (const sourceNodeId of sourceNodeIds) {
        const sourceNode = nodes.find((item) => item.id === sourceNodeId)
        if (!sourceNode) continue
        startPositions.set(sourceNodeId, {
          x: sourceNode.position.x,
          y: sourceNode.position.y,
        })
      }
      if (startPositions.size === 0) {
        altDragCopyRef.current = null
        return
      }

      altDragCopyRef.current = {
        sourceNodeIds,
        startPositions,
      }
    },
    [nodes, selectedNodeIds]
  )

  const handleNodeDrag = useCallback(
    (_event: ReactMouseEvent, _node: CanvasNode) => {
      // 异步 fork 在拖拽释放后提交；拖动阶段保留 ReactFlow 的原节点预览。
    },
    []
  )

  const handleNodeDragStop = useCallback(
    (_event: ReactMouseEvent, node: CanvasNode) => {
      const altCopyState = altDragCopyRef.current
      if (!altCopyState) return
      altDragCopyRef.current = null

      const startPosition = altCopyState.startPositions.get(node.id)
      if (!startPosition) return

      const offset = {
        x: node.position.x - startPosition.x,
        y: node.position.y - startPosition.y,
      }

      const restoreSourceChanges = altCopyState.sourceNodeIds
        .map((sourceId) => {
          const sourceStart = altCopyState.startPositions.get(sourceId)
          if (!sourceStart) return null
          return {
            id: sourceId,
            type: 'position' as const,
            position: sourceStart,
            dragging: false,
          }
        })
        .filter((change): change is {
          id: string
          type: 'position'
          position: { x: number; y: number }
          dragging: false
        } => Boolean(change))

      if (restoreSourceChanges.length > 0) applyNodesChange(restoreSourceChanges)
      void duplicateNodes(altCopyState.sourceNodeIds, {
        explicitOffset: offset,
        disableOffsetIteration: true,
      })
    },
    [applyNodesChange, duplicateNodes]
  )

  return {
    duplicateNodes,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop
  }
}
