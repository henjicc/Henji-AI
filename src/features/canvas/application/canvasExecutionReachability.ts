import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { getAuthoritativeIncomingEdge, getNodeIndexById } from '../domain/connectionIndex'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'

let cacheNodes: CanvasNode[] | null = null
let cacheEdges: CanvasEdge[] | null = null
let cacheValue = new Set<string>()

/** 每份图快照只计算一次，供所有文本处理节点共享下游可达性结果。 */
export function hasReachableNonDisplayConsumer(
  sourceNodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): boolean {
  if (cacheNodes === nodes && cacheEdges === edges) return cacheValue.has(sourceNodeId)
  const nodeById = getNodeIndexById(nodes)
  const reachable = new Set<string>()
  const displayQueue: string[] = []
  for (const edge of edges) {
    const target = nodeById.get(edge.target)
    if (!target || getCanvasNodeDefinition(target.type)?.executionKind === 'text-display') continue
    if (reachable.has(edge.source)) continue
    reachable.add(edge.source)
    const source = nodeById.get(edge.source)
    if (source && getCanvasNodeDefinition(source.type)?.executionKind === 'text-display') {
      displayQueue.push(source.id)
    }
  }
  for (let cursor = 0; cursor < displayQueue.length; cursor += 1) {
    const edge = getAuthoritativeIncomingEdge(edges, displayQueue[cursor])
    if (!edge || reachable.has(edge.source)) continue
    reachable.add(edge.source)
    const source = nodeById.get(edge.source)
    if (source && getCanvasNodeDefinition(source.type)?.executionKind === 'text-display') {
      displayQueue.push(source.id)
    }
  }
  cacheNodes = nodes
  cacheEdges = edges
  cacheValue = reachable
  return reachable.has(sourceNodeId)
}

export function resetCanvasExecutionReachabilityForTests(): void {
  cacheNodes = null
  cacheEdges = null
  cacheValue = new Set<string>()
}
