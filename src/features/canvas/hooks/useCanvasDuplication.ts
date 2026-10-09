import { useCallback, useRef } from 'react'
import type { Connection, NodeChange, NodePositionChange } from '@xyflow/react'
import { canvasStoreAttachment, useCanvasStore, type CanvasState } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { collectNodeIdsWithDescendants } from '@/stores/canvasStoreHelpers'
import {
  isAssetGroupNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
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
import { commitCanvasNodesDuplication } from '@/features/canvas/application/canvasMutationService'
import { reportCanvasOperationFailure } from '@/features/canvas/application/canvasOperationFeedback'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.canvas.duplication')

type DragBaseline = Pick<CanvasState, 'nodes' | 'edges' | 'history'>

/** 副本的拖放属于同一次复制；只合并纯位移，期间的其他内容编辑仍保留独立历史。 */
function finishDuplicationDrag(baseline: DragBaseline | null, copiedIds: ReadonlySet<string>): void {
  if (!baseline) return
  const snapshot = baseline.history.past.at(-1)
  if (!snapshot) return
  const current = useCanvasStore.getState()
  const boundary = current.history.past.indexOf(snapshot)
  if (boundary < 0) return
  const baselineNodes = new Map(baseline.nodes.map(node => [node.id, node]))
  const onlyCopyPositionsChanged = (nodes: CanvasNode[], edges: CanvasEdge[]) => edges === baseline.edges
    && nodes.length === baseline.nodes.length && nodes.every(node => {
      const original = baselineNodes.get(node.id)
      return original && node.data === original.data && node.parentId === original.parentId
        && (copiedIds.has(node.id) || (node.position.x === original.position.x && node.position.y === original.position.y))
    })
  if (!onlyCopyPositionsChanged(current.nodes, current.edges)
    || current.history.past.slice(boundary + 1).some(step => !onlyCopyPositionsChanged(step.nodes, step.edges))) return
  useCanvasStore.setState({ history: baseline.history, dragHistorySnapshot: null })
}

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
    idMap: Map<string, string> | null
    positions: Map<string, NodePositionChange>
    stopped: boolean
    settled: boolean
    historyBaseline: DragBaseline | null
  } | null>(null)

  const duplicateNodes = useCallback(
    (sourceNodeIds: string[], options: DuplicateOptions = {}): Promise<DuplicateResult | null> => canvasStoreAttachment.batchViewUpdates(async () => {
      const dedupedIds = Array.from(new Set(sourceNodeIds))
      if (dedupedIds.length === 0) return null

      const requestedIds = collectNodeIdsWithDescendants(nodes, dedupedIds)
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
      const recordCopy = (sourceNode: CanvasNode, data: DynamicValueMap, nextNodeId: string) => {
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
      }

      const projectId = useProjectStore.getState().currentProjectId
      if (!projectId) throw new Error('当前没有可复制节点的项目')
      const copyInputs = sourceNodes.map(sourceNode => {
        const data = cloneNodeData(sourceNode.data) as DynamicValueMap
        resetDuplicatedCanvasExecutionData(sourceNode.type, data)
        return { sourceNodeId: sourceNode.id, data }
      })
      return await commitCanvasNodesDuplication({
        projectId,
        nodes: copyInputs,
        createNodes: (preparedData) => canvasStoreAttachment.batchViewUpdates(() => {
          if (useProjectStore.getState().currentProjectId !== projectId) {
            throw new Error('画布已切换，已取消节点复制')
          }
          for (let index = 0; index < sourceNodes.length; index++) {
            const sourceNode = sourceNodes[index]
            const data = preparedData[index] as DynamicValueMap
            const nextNodeId = addNode(sourceNode.type as CanvasNodeType, {
              x: sourceNode.position.x + chosenOffset.x + offsetStep * 8,
              y: sourceNode.position.y + chosenOffset.y + offsetStep * 6,
            }, data)
            recordCopy(sourceNode, data, nextNodeId)
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

          canvasStoreAttachment.batchViewUpdates(() => {
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
          })

          const copiedAssetGroups = sourceNodes.filter(isAssetGroupNode)
          if (copiedAssetGroups.length > 0 || sourceNodes.some(node => node.parentId && idMap.has(node.parentId))) {
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
                  extent: original.extent,
                  hidden: original.hidden,
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
        }),
      })
    }),
    [addNode, applyNodesChange, connectNodes, edges, nodes, scheduleCanvasPersist, setSelectedNode]
  )

  const handleNodeDragStart = useCallback(
    (event: Pick<MouseEvent, 'altKey'>, node: CanvasNode) => {
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
      const positions = new Map<string, NodePositionChange>()
      for (const sourceNodeId of sourceNodeIds) {
        const sourceNode = nodes.find((item) => item.id === sourceNodeId)
        if (!sourceNode) continue
        positions.set(sourceNodeId, {
          id: sourceNodeId,
          type: 'position',
          position: { ...sourceNode.position },
          dragging: true,
        })
      }
      if (positions.size === 0) {
        altDragCopyRef.current = null
        return
      }

      const session = {
        sourceNodeIds,
        positions,
        idMap: null as Map<string, string> | null,
        stopped: false,
        settled: false,
        historyBaseline: null as DragBaseline | null,
      }
      altDragCopyRef.current = session
      logger.info('开始拖拽复制节点', { event: 'canvas.node.alt_duplicate.start', context: { sourceNodeIds } })
      // ReactFlow 持有原节点的拖动会话；在 onNodesChange 中转发给副本，
      // 原节点与其外部连线始终留在原位。文档异步 fork 期间只缓存最新位移。
      void duplicateNodes(sourceNodeIds, {
        explicitOffset: { x: 0, y: 0 },
        disableOffsetIteration: true,
        suppressSelect: true,
        suppressPersist: true,
      }).then((result) => {
        if (!result) return
        session.idMap = result.idMap
        session.historyBaseline = useCanvasStore.getState()
        const changes: NodeChange<CanvasNode>[] = []
        for (const [sourceId, change] of session.positions) {
          const copiedId = result.idMap.get(sourceId)
          if (copiedId) changes.push({ ...change, id: copiedId, dragging: !session.stopped })
        }
        if (altDragCopyRef.current === session) {
          const copiedIds = new Set(sourceNodeIds.map((id) => result.idMap.get(id)))
          for (const current of useCanvasStore.getState().nodes) {
            if (current.selected || copiedIds.has(current.id)) {
              changes.push({ id: current.id, type: 'select', selected: copiedIds.has(current.id) })
            }
          }
        }
        if (changes.length) applyNodesChange(changes)
        if (session.stopped) {
          finishDuplicationDrag(session.historyBaseline, new Set(result.idMap.values()))
          scheduleCanvasPersist(0)
        }
        logger.info('拖拽副本已创建', { event: 'canvas.node.alt_duplicate.completed', context: { sourceNodeIds } })
      }).catch((error: unknown) => {
        logger.error('拖拽复制节点失败', error, { event: 'canvas.node.alt_duplicate.failed' })
        reportCanvasOperationFailure(error)
      }).finally(() => {
        session.settled = true
        if (session.stopped && altDragCopyRef.current === session) altDragCopyRef.current = null
      })
    },
    [applyNodesChange, duplicateNodes, nodes, scheduleCanvasPersist, selectedNodeIds]
  )

  const routeDuplicationChanges = useCallback(
    (changes: NodeChange<CanvasNode>[]): NodeChange<CanvasNode>[] => {
      const session = altDragCopyRef.current
      if (!session) return changes
      return changes.flatMap((change): NodeChange<CanvasNode>[] => {
        if (change.type !== 'position' || !session.positions.has(change.id)) return [change]
        session.positions.set(change.id, { ...session.positions.get(change.id), ...change })
        const copiedId = session.idMap?.get(change.id)
        return copiedId ? [{ ...change, id: copiedId }] : []
      })
    },
    []
  )

  const handleNodeDragStop = useCallback(
    (_event: Pick<MouseEvent, 'altKey'>, _node: CanvasNode): boolean => {
      const session = altDragCopyRef.current
      if (!session) return false
      session.stopped = true
      if (session.settled) {
        const copiedIds = new Set(session.idMap?.values())
        const finalChanges: NodeChange<CanvasNode>[] = useCanvasStore.getState().nodes
          .filter((node) => copiedIds.has(node.id) && node.dragging)
          .map((node) => ({ id: node.id, type: 'position', position: node.position, dragging: false }))
        if (finalChanges.length) applyNodesChange(finalChanges)
        finishDuplicationDrag(session.historyBaseline, new Set(session.idMap?.values()))
        altDragCopyRef.current = null
        scheduleCanvasPersist(0)
      }
      return true
    },
    [applyNodesChange, scheduleCanvasPersist]
  )

  return {
    duplicateNodes,
    handleNodeDragStart,
    routeDuplicationChanges,
    handleNodeDragStop
  }
}
