import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { getNodeMediaOutputs } from '../domain/nodeRegistry';
import type { MediaKind, NodeMediaOutput } from '../domain/nodePorts';

/**
 * 收集节点全部上游媒体输出（按连线顺序，URL 去重）。
 * 输出类型由各节点定义的 getOutputs 声明，无节点类型特判。
 */
export function collectInputMedia(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): NodeMediaOutput[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceNodeIds = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => edge.source);

  const seen = new Set<string>();
  const outputs: NodeMediaOutput[] = [];
  for (const sourceId of sourceNodeIds) {
    const sourceNode = nodeById.get(sourceId);
    if (!sourceNode) {
      continue;
    }
    for (const output of getNodeMediaOutputs(sourceNode.type, sourceNode.data)) {
      if (!output.url || seen.has(output.url)) {
        continue;
      }
      seen.add(output.url);
      outputs.push(output);
    }
  }
  return outputs;
}

/** 收集指定媒体类型的上游输出 URL 列表 */
export function collectInputMediaUrls(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  kind: MediaKind
): string[] {
  return collectInputMedia(nodeId, nodes, edges)
    .filter((output) => output.kind === kind)
    .map((output) => output.url);
}

/** 输出列表内容相等比较（供 store selector 避免无效重渲染） */
export function areMediaOutputListsEqual(a: NodeMediaOutput[], b: NodeMediaOutput[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return item.kind === other.kind && item.url === other.url && item.previewUrl === other.previewUrl;
  });
}

export function areStringListsEqual(a: string[], b: string[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => item === b[index]);
}
