import type { CanvasEdge, CanvasNode } from './canvasNodes';

export interface MainPortConnectionFlags {
  hasMainSource: boolean;
  hasMainTarget: boolean;
}

let connectionFlagsCacheKey: CanvasEdge[] | null = null;
let connectionFlagsCacheValue: Map<string, MainPortConnectionFlags> | null = null;

/**
 * 按节点 id 索引"主媒体端口"（默认 source/target handle）的连接状态。
 * 用 edges 数组引用做单槽缓存：同一份 edges 引用下重复调用直接复用结果，
 * 避免每个节点组件各自对全量 edges 做 O(边数) 扫描（原写法是 N 个节点各扫一遍 edges）。
 */
export function getMainPortConnectionFlags(edges: CanvasEdge[]): Map<string, MainPortConnectionFlags> {
  if (connectionFlagsCacheKey === edges && connectionFlagsCacheValue) {
    return connectionFlagsCacheValue;
  }

  const map = new Map<string, MainPortConnectionFlags>();
  for (const edge of edges) {
    if ((edge.sourceHandle ?? 'source') === 'source') {
      const entry = map.get(edge.source);
      if (entry) {
        entry.hasMainSource = true;
      } else {
        map.set(edge.source, { hasMainSource: true, hasMainTarget: false });
      }
    }
    if ((edge.targetHandle ?? 'target') === 'target') {
      const entry = map.get(edge.target);
      if (entry) {
        entry.hasMainTarget = true;
      } else {
        map.set(edge.target, { hasMainSource: false, hasMainTarget: true });
      }
    }
  }

  connectionFlagsCacheKey = edges;
  connectionFlagsCacheValue = map;
  return map;
}

let edgesByTargetCacheKey: CanvasEdge[] | null = null;
let edgesByTargetCacheValue: Map<string, CanvasEdge[]> | null = null;

const EMPTY_EDGES: CanvasEdge[] = [];

/**
 * 按 target 节点 id 分桶索引边。用 edges 数组引用做单槽缓存：
 * 节点级 zustand 选择器（collectInputMedia/collectInputValues 等）在每次 store
 * 更新时都会执行，若各自全量扫 edges，总开销是 O(节点数 × 边数)；
 * 这里一次建桶后各节点只按入度取自己的边。
 */
export function getEdgesByTarget(edges: CanvasEdge[]): Map<string, CanvasEdge[]> {
  if (edgesByTargetCacheKey === edges && edgesByTargetCacheValue) {
    return edgesByTargetCacheValue;
  }

  const map = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const bucket = map.get(edge.target);
    if (bucket) {
      bucket.push(edge);
    } else {
      map.set(edge.target, [edge]);
    }
  }

  edgesByTargetCacheKey = edges;
  edgesByTargetCacheValue = map;
  return map;
}

/** 取指向某节点的全部边（无则返回稳定的空数组引用） */
export function getIncomingEdges(edges: CanvasEdge[], nodeId: string): CanvasEdge[] {
  return getEdgesByTarget(edges).get(nodeId) ?? EMPTY_EDGES;
}

/**
 * 单值展示节点的兼容读规则：旧项目可能残留多条入边，始终以边数组中的最后一条为准。
 * 新连接入口会阻止继续制造多入边；规划、展示和写回必须共用这里。
 */
export function getAuthoritativeIncomingEdge(
  edges: CanvasEdge[],
  nodeId: string,
): CanvasEdge | undefined {
  return getIncomingEdges(edges, nodeId).at(-1);
}

export function isAuthoritativeIncomingSource(
  edges: CanvasEdge[],
  targetNodeId: string,
  sourceNodeId: string,
): boolean {
  return getAuthoritativeIncomingEdge(edges, targetNodeId)?.source === sourceNodeId;
}

let edgesBySourceCacheKey: CanvasEdge[] | null = null;
let edgesBySourceCacheValue: Map<string, CanvasEdge[]> | null = null;

/** 按 source 节点 id 分桶，供依赖执行与输出连接判断复用。 */
export function getEdgesBySource(edges: CanvasEdge[]): Map<string, CanvasEdge[]> {
  if (edgesBySourceCacheKey === edges && edgesBySourceCacheValue) {
    return edgesBySourceCacheValue;
  }
  const map = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const bucket = map.get(edge.source);
    if (bucket) bucket.push(edge);
    else map.set(edge.source, [edge]);
  }
  edgesBySourceCacheKey = edges;
  edgesBySourceCacheValue = map;
  return map;
}

export function getOutgoingEdges(edges: CanvasEdge[], nodeId: string): CanvasEdge[] {
  return getEdgesBySource(edges).get(nodeId) ?? EMPTY_EDGES;
}

export function wouldCreateCanvasCycle(
  sourceNodeId: string,
  targetNodeId: string,
  edges: CanvasEdge[],
): boolean {
  const outgoing = getEdgesBySource(edges)
  const pending = [targetNodeId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === sourceNodeId) return true
    visited.add(current)
    for (const edge of outgoing.get(current) ?? []) pending.push(edge.target)
  }
  return false
}

let nodeIndexCacheKey: CanvasNode[] | null = null;
let nodeIndexCacheValue: Map<string, CanvasNode> | null = null;

/**
 * 按 id 索引节点。用 nodes 数组引用做单槽缓存，
 * 替代逐条边各自对全量 nodes 做 O(节点数) 的 nodes.find 查找。
 */
export function getNodeIndexById(nodes: CanvasNode[]): Map<string, CanvasNode> {
  if (nodeIndexCacheKey === nodes && nodeIndexCacheValue) {
    return nodeIndexCacheValue;
  }

  const map = new Map<string, CanvasNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }

  nodeIndexCacheKey = nodes;
  nodeIndexCacheValue = map;
  return map;
}
