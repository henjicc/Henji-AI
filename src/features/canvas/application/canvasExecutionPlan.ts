import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import {
  getAuthoritativeIncomingEdge,
  getEdgesByTarget,
  getNodeIndexById,
} from '../domain/connectionIndex'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'

export interface CanvasExecutionPlan {
  /** 包含根节点；稳定拓扑顺序保证所有前驱都出现在消费者之前。 */
  orderedNodeIds: string[]
  dependencyNodeIds: string[]
  predecessorIdsByNode: ReadonlyMap<string, string[]>
}

export function getCanvasExecutionAncestorIds(
  plan: CanvasExecutionPlan,
  nodeId: string,
): string[] {
  const ancestors = new Set<string>()
  const pending = [...(plan.predecessorIdsByNode.get(nodeId) ?? [])]
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const predecessorId = pending[cursor]
    if (ancestors.has(predecessorId)) continue
    ancestors.add(predecessorId)
    pending.push(...(plan.predecessorIdsByNode.get(predecessorId) ?? []))
  }
  return plan.orderedNodeIds.filter((candidateId) => ancestors.has(candidateId))
}

export function areCanvasExecutionPlanTopologiesEqual(
  left: CanvasExecutionPlan,
  right: CanvasExecutionPlan,
): boolean {
  if (
    left.orderedNodeIds.length !== right.orderedNodeIds.length
    || left.orderedNodeIds.some((nodeId, index) => right.orderedNodeIds[index] !== nodeId)
  ) return false
  return left.orderedNodeIds.every((nodeId) => {
    const leftPredecessors = left.predecessorIdsByNode.get(nodeId) ?? []
    const rightPredecessors = right.predecessorIdsByNode.get(nodeId) ?? []
    return leftPredecessors.length === rightPredecessors.length
      && leftPredecessors.every((predecessorId, index) => (
        rightPredecessors[index] === predecessorId
      ))
  })
}

export type CanvasDependencyMode = 'auto' | 'boundary' | 'missing'

function assertReachableGraphIsAcyclic(
  rootNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): void {
  const nodeById = getNodeIndexById(nodes)
  const incoming = getEdgesByTarget(edges)
  if (!nodeById.has(rootNodeId)) throw new Error(`画布执行节点不存在：${rootNodeId}`)

  const resolveSources = (nodeId: string): string[] => {
    const node = nodeById.get(nodeId)
    if (node && getCanvasNodeDefinition(node.type)?.executionKind === 'text-display') {
      const authoritative = getAuthoritativeIncomingEdge(edges, nodeId)
      return authoritative ? [authoritative.source] : []
    }
    return (incoming.get(nodeId) ?? []).map((edge) => edge.source)
  }

  const state = new Map<string, 'visiting' | 'visited'>()
  const stack: Array<{ nodeId: string; nextIndex: number; sources: string[] }> = [{
    nodeId: rootNodeId,
    nextIndex: 0,
    sources: resolveSources(rootNodeId),
  }]
  state.set(rootNodeId, 'visiting')

  while (stack.length > 0) {
    const frame = stack.at(-1)
    if (!frame) break
    if (frame.nextIndex >= frame.sources.length) {
      state.set(frame.nodeId, 'visited')
      stack.pop()
      continue
    }

    const sourceId = frame.sources[frame.nextIndex]
    frame.nextIndex += 1
    if (!nodeById.has(sourceId)) throw new Error(`画布依赖节点不存在：${sourceId}`)
    const sourceState = state.get(sourceId)
    if (sourceState === 'visiting') {
      throw new Error(`画布存在循环依赖，无法运行节点：${sourceId}`)
    }
    if (sourceState === 'visited') continue
    state.set(sourceId, 'visiting')
    stack.push({
      nodeId: sourceId,
      nextIndex: 0,
      sources: resolveSources(sourceId),
    })
  }
}

/**
 * 找到消费者上游最近的一层可执行节点。
 * 文本展示节点是透明桥梁；上传、参数源和结果节点都是已经有值的边界，不继续追溯。
 */
function resolveNearestExecutableSources(
  consumerNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  getDependencyMode: (nodeId: string) => CanvasDependencyMode,
): string[] {
  const nodeById = getNodeIndexById(nodes)
  const incoming = getEdgesByTarget(edges)
  const pending = (incoming.get(consumerNodeId) ?? []).map((edge) => ({
    sourceId: edge.source,
    sourceHandle: edge.sourceHandle ?? 'source',
  }))
  const visited = new Set<string>()
  const executable: string[] = []

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const { sourceId, sourceHandle } = pending[cursor]
    if (!sourceId || visited.has(sourceId)) continue
    visited.add(sourceId)
    const source = nodeById.get(sourceId)
    if (!source) throw new Error(`画布依赖节点不存在：${sourceId}`)
    const definition = getCanvasNodeDefinition(source.type)

    if (definition?.executionKind === 'text-display') {
      const authoritative = getAuthoritativeIncomingEdge(edges, sourceId)
      if (authoritative) {
        pending.push({
          sourceId: authoritative.source,
          sourceHandle: authoritative.sourceHandle ?? 'source',
        })
      }
      continue
    }

    if (definition?.executionKind) {
      const mode = getDependencyMode(sourceId)
      if (mode === 'missing') throw new Error(`上游节点执行器尚未就绪：${sourceId}`)
      if (mode === 'auto') executable.push(sourceId)
      continue
    }

    if (
      (
        definition?.executionBoundary === 'media'
        || definition?.media?.role === 'source'
        || definition?.media?.role === 'result'
      )
      && getGraphNodeMediaOutputs(source, nodeById, sourceHandle).length === 0
    ) {
      throw new Error(`上游媒体节点没有可用输出：${sourceId}`)
    }
  }

  return executable
}

export function createCanvasExecutionPlan(
  rootNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  getDependencyMode: (nodeId: string) => CanvasDependencyMode,
): CanvasExecutionPlan {
  assertReachableGraphIsAcyclic(rootNodeId, nodes, edges)

  const predecessorIdsByNode = new Map<string, string[]>()
  const discoveryOrder = new Map<string, number>([[rootNodeId, 0]])
  const pending = [rootNodeId]
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const consumerId = pending[cursor]
    const predecessors = resolveNearestExecutableSources(
      consumerId,
      nodes,
      edges,
      getDependencyMode,
    )
    predecessorIdsByNode.set(consumerId, predecessors)
    for (const predecessorId of predecessors) {
      if (discoveryOrder.has(predecessorId)) continue
      discoveryOrder.set(predecessorId, discoveryOrder.size)
      pending.push(predecessorId)
    }
  }

  const allNodeIds = [...discoveryOrder.keys()]
  const dependentIdsByNode = new Map<string, string[]>()
  const remainingPredecessors = new Map<string, number>()
  for (const nodeId of allNodeIds) {
    const predecessors = predecessorIdsByNode.get(nodeId) ?? []
    remainingPredecessors.set(nodeId, predecessors.length)
    for (const predecessorId of predecessors) {
      const dependents = dependentIdsByNode.get(predecessorId)
      if (dependents) dependents.push(nodeId)
      else dependentIdsByNode.set(predecessorId, [nodeId])
    }
  }

  const ready = allNodeIds
    .filter((nodeId) => remainingPredecessors.get(nodeId) === 0)
    .sort((left, right) => (
      (discoveryOrder.get(left) ?? 0) - (discoveryOrder.get(right) ?? 0)
    ))
  const orderedNodeIds: string[] = []
  while (ready.length > 0) {
    const nodeId = ready.shift()
    if (!nodeId) continue
    orderedNodeIds.push(nodeId)
    for (const dependentId of dependentIdsByNode.get(nodeId) ?? []) {
      const remaining = (remainingPredecessors.get(dependentId) ?? 0) - 1
      remainingPredecessors.set(dependentId, remaining)
      if (remaining === 0) {
        ready.push(dependentId)
        ready.sort((left, right) => (
          (discoveryOrder.get(left) ?? 0) - (discoveryOrder.get(right) ?? 0)
        ))
      }
    }
  }

  if (orderedNodeIds.length !== allNodeIds.length) {
    throw new Error(`画布存在循环依赖，无法运行节点：${rootNodeId}`)
  }
  return {
    orderedNodeIds,
    dependencyNodeIds: orderedNodeIds.filter((nodeId) => nodeId !== rootNodeId),
    predecessorIdsByNode,
  }
}
