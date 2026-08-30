import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { getIncomingEdges, getNodeIndexById } from '../domain/connectionIndex';
import { getNodeValueOutput } from '../domain/nodeRegistry';
import { parseParamPortId } from '../domain/socketTypes';
import { getGraphNodeMediaOutputs } from './graphOutputResolver';
import {
  findParamForTargetNode,
  getSchemaMediaParamKind,
} from './graphValueSchema';

/** 返回连到本节点参数端口、且有边的 paramId 集合（不要求上游能解析出值） */
export function getConnectedParamIds(nodeId: string, edges: CanvasEdge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of getIncomingEdges(edges, nodeId)) {
    const paramId = parseParamPortId(edge.targetHandle);
    if (paramId) {
      connected.add(paramId);
    }
  }
  return connected;
}

/**
 * 收集连到本节点参数端口的上游标量值，返回 paramId → value 覆盖表。
 * 同一端口多条连线时后者覆盖前者。
 *
 * 与 collectInputMedia 同理：被节点级选择器高频调用，
 * 必须走 connectionIndex 的引用缓存索引，禁止函数内全量扫描。
 */
export function collectInputValues(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): DynamicValueMap {
  const overrides: DynamicValueMap = {};
  const incoming = getIncomingEdges(edges, nodeId);
  if (incoming.length === 0) {
    return overrides;
  }

  const nodeById = getNodeIndexById(nodes);
  const targetNode = nodeById.get(nodeId);
  for (const edge of incoming) {
    const paramId = parseParamPortId(edge.targetHandle);
    if (!paramId) {
      continue;
    }
    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }
    const mediaKind = targetNode
      ? getSchemaMediaParamKind(findParamForTargetNode(targetNode, paramId))
      : null;
    if (mediaKind) {
      const previous = Array.isArray(overrides[paramId]) ? overrides[paramId] as DynamicValue[] : [];
      const nextUrls = getGraphNodeMediaOutputs(sourceNode, nodeById, edge.sourceHandle ?? undefined)
        .filter((output) => output.kind === mediaKind && Boolean(output.url))
        .map((output) => output.url);
      overrides[paramId] = [...new Set([...previous, ...nextUrls])];
      continue;
    }
    const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
    if (output) {
      overrides[paramId] = output.value;
    }
  }
  return overrides;
}
