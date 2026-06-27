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
