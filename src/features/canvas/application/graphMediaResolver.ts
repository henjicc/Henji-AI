import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { getIncomingEdges, getNodeIndexById } from '../domain/connectionIndex';
import type { MediaKind, NodeMediaOutput } from '../domain/nodePorts';
import { parseParamPortId } from '../domain/socketTypes';
import { findParamForTargetNode, getSchemaMediaParamKind } from './graphValueResolver';
import { getGraphNodeMediaOutputs } from './graphOutputResolver';

/**
 * 收集节点全部上游媒体输出（按连线顺序，URL 去重）。
 * 输出类型由各节点定义的 getOutputs 声明，无节点类型特判。
 *
 * 本函数被节点级 zustand 选择器高频调用（每次 store 更新 × 每个节点），
 * 必须走 connectionIndex 的引用缓存索引，禁止在函数内全量重建 Map/扫描 edges。
 */
export function collectInputMedia(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): NodeMediaOutput[] {
  const incoming = getIncomingEdges(edges, nodeId);
  if (incoming.length === 0) {
    return EMPTY_OUTPUTS;
  }

  const nodeById = getNodeIndexById(nodes);
  const targetNode = nodeById.get(nodeId);
  const seen = new Set<string>();
  const outputs: NodeMediaOutput[] = [];
  for (const edge of incoming) {
    const targetParamId = parseParamPortId(edge.targetHandle);
    if (
      targetNode
      && targetParamId
      && getSchemaMediaParamKind(findParamForTargetNode(targetNode, targetParamId))
    ) {
      continue;
    }
    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }
    const sourceHandle = edge.sourceHandle ?? 'source';
    const sourceOutputs = getGraphNodeMediaOutputs(sourceNode, nodeById, sourceHandle);
    for (const [outputIndex, output] of sourceOutputs.entries()) {
      if (!output.url || seen.has(output.url)) {
        continue;
      }
      seen.add(output.url);
      outputs.push({
        ...output,
        sourceNodeId: sourceNode.id,
        sourceHandle: output.sourceHandle ?? sourceHandle,
        outputIndex,
      });
    }
  }
  return outputs;
}

/** 无上游时返回稳定引用，避免选择器每次生成新数组触发相等比较开销 */
const EMPTY_OUTPUTS: NodeMediaOutput[] = [];

/** 收集指定媒体类型的上游输出（保留 previewUrl，供缩略图展示用原图/预览图取舍） */
export function collectInputMediaByKind(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  kind: MediaKind
): NodeMediaOutput[] {
  const outputs = collectInputMedia(nodeId, nodes, edges);
  if (outputs.length === 0) {
    return outputs;
  }
  return outputs.filter((output) => output.kind === kind);
}

/** 收集指定媒体类型的上游输出 URL 列表 */
export function collectInputMediaUrls(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  kind: MediaKind
): string[] {
  return collectInputMediaByKind(nodeId, nodes, edges, kind).map((output) => output.url);
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
    return item.kind === other.kind
      && item.url === other.url
      && item.previewUrl === other.previewUrl
      && item.sourceNodeId === other.sourceNodeId
      && item.sourceHandle === other.sourceHandle
      && item.outputIndex === other.outputIndex;
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
