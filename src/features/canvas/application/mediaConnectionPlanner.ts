import type {
  CanvasConnectionInput,
  CanvasEdge,
  CanvasNode,
} from '../domain/canvasNodes';
import { wouldCreateCanvasCycle } from '../domain/connectionIndex';
import {
  getCanvasNodeDefinition,
  getNodeMediaOutputs,
  isConnectionCompatible,
  resolveNodeSourceMediaKind,
} from '../domain/nodeRegistry';
import { isParamPortId, type RowMediaKind } from '../domain/socketTypes';
import {
  resolveVisibleMediaInputPorts,
  validateParamConnection,
} from './graphValueResolver';

type MediaConnectionSkipReason =
  | 'source-not-media'
  | 'target-unsupported'
  | 'capacity-exceeded'
  | 'duplicate'
  | 'cycle';

interface MediaConnectionSkippedItem {
  sourceNodeId: string;
  reason: MediaConnectionSkipReason;
  mediaKind?: RowMediaKind;
}

export interface MediaConnectionPlan {
  connections: CanvasConnectionInput[];
  skipped: MediaConnectionSkippedItem[];
  counts: Record<RowMediaKind, number>;
}

export interface PlanMediaConnectionsInput {
  sourceNodeIds: string[];
  targetNodeId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  preferredTargetHandle?: string | null;
  preferredTargetHandles?: Partial<Record<RowMediaKind, string>>;
  sourceHandles?: Record<string, string | null | undefined>;
  edgeData?: (sourceNodeId: string) => CanvasConnectionInput['data'];
}

interface ResolvedSource {
  node: CanvasNode;
  kind: RowMediaKind;
  sourceHandle: string;
}

function isMediaKind(value: unknown): value is RowMediaKind {
  return value === 'image' || value === 'video' || value === 'audio';
}

export function resolveMediaConnectionSource(node: CanvasNode, preferredHandle?: string | null): ResolvedSource | null {
  const definition = getCanvasNodeDefinition(node.type);
  if (!definition?.connectivity.manualSource || !definition.connectivity.sourceHandle) return null;

  if (preferredHandle) {
    const preferredKind = resolveNodeSourceMediaKind(node.type, node.data, preferredHandle)
      ?? definition.ports?.source?.handles?.[preferredHandle];
    if (isMediaKind(preferredKind)) {
      return { node, kind: preferredKind, sourceHandle: preferredHandle };
    }
  }

  const defaultKind = resolveNodeSourceMediaKind(node.type, node.data, 'source');
  if (isMediaKind(defaultKind)) return { node, kind: defaultKind, sourceHandle: 'source' };
  if (
    definition.connectivity.lockSourceMediaOnFirstConnection
    && (!preferredHandle || preferredHandle === 'source')
  ) {
    return null;
  }

  for (const [handleId, declaredKind] of Object.entries(definition.ports?.source?.handles ?? {})) {
    const kind = resolveNodeSourceMediaKind(node.type, node.data, handleId);
    if (isMediaKind(kind ?? declaredKind)) {
      const resolvedKind = (kind ?? declaredKind) as RowMediaKind;
      const outputs = getNodeMediaOutputs(node.type, node.data, handleId);
      if (outputs.length === 0 || outputs.some((output) => output.kind === resolvedKind)) {
        return { node, kind: resolvedKind, sourceHandle: handleId };
      }
    }
  }

  const output = getNodeMediaOutputs(node.type, node.data)
    .find((candidate) => isMediaKind(candidate.kind));
  return output && isMediaKind(output.kind)
    ? { node, kind: output.kind, sourceHandle: output.sourceHandle ?? 'source' }
    : null;
}

function isDuplicate(connection: CanvasConnectionInput, edges: CanvasEdge[]): boolean {
  return edges.some((edge) => (
    edge.source === connection.source
    && edge.target === connection.target
    && (edge.sourceHandle ?? 'source') === connection.sourceHandle
    && (edge.targetHandle ?? 'target') === connection.targetHandle
  ));
}

export function planMediaConnections(input: PlanMediaConnectionsInput): MediaConnectionPlan {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  const targetNode = nodeById.get(input.targetNodeId);
  const result: MediaConnectionPlan = {
    connections: [],
    skipped: [],
    counts: { image: 0, video: 0, audio: 0 },
  };
  if (!targetNode) {
    for (const sourceNodeId of input.sourceNodeIds) {
      result.skipped.push({ sourceNodeId, reason: 'target-unsupported' });
    }
    return result;
  }

  const stagedEdges = [...input.edges];
  const ports = resolveVisibleMediaInputPorts(targetNode, input.nodes, stagedEdges);
  const uniqueSourceIds = [...new Set(input.sourceNodeIds)];

  for (const sourceNodeId of uniqueSourceIds) {
    const sourceNode = nodeById.get(sourceNodeId);
    const source = sourceNode
      ? resolveMediaConnectionSource(sourceNode, input.sourceHandles?.[sourceNodeId])
      : null;
    if (!source) {
      result.skipped.push({ sourceNodeId, reason: 'source-not-media' });
      continue;
    }
    if (sourceNodeId === targetNode.id || wouldCreateCanvasCycle(sourceNodeId, targetNode.id, stagedEdges)) {
      result.skipped.push({ sourceNodeId, reason: 'cycle', mediaKind: source.kind });
      continue;
    }

    const matchingPorts = ports.filter((port) => port.kind === source.kind);
    const preferredHandle = input.preferredTargetHandles?.[source.kind] ?? input.preferredTargetHandle;
    const preferred = preferredHandle
      ? matchingPorts.find((port) => port.handleId === preferredHandle)
      : undefined;
    const port = preferred ?? matchingPorts[0];
    if (!port) {
      result.skipped.push({ sourceNodeId, reason: 'target-unsupported', mediaKind: source.kind });
      continue;
    }

    const connection: CanvasConnectionInput = {
      source: sourceNodeId,
      target: targetNode.id,
      sourceHandle: source.sourceHandle,
      targetHandle: port.handleId,
      data: input.edgeData?.(sourceNodeId),
    };
    if (isDuplicate(connection, stagedEdges)) {
      result.skipped.push({ sourceNodeId, reason: 'duplicate', mediaKind: source.kind });
      continue;
    }
    const validation = isParamPortId(port.handleId)
      ? validateParamConnection(
          source.node,
          targetNode,
          port.handleId,
          input.nodes,
          stagedEdges,
          source.sourceHandle,
        )
      : {
          compatible: isConnectionCompatible(
            source.node.type,
            targetNode.type,
            source.sourceHandle,
            source.node.data,
          ),
        };
    if (!validation.compatible) {
      result.skipped.push({
        sourceNodeId,
        reason: validation.reason === 'media-limit-exceeded' ? 'capacity-exceeded' : 'target-unsupported',
        mediaKind: source.kind,
      });
      continue;
    }

    result.connections.push(connection);
    result.counts[source.kind] += 1;
    stagedEdges.push({
      id: `planned:${result.connections.length}:${sourceNodeId}`,
      ...connection,
      type: 'disconnectableEdge',
    });
  }

  return result;
}

export interface MediaHandleBound {
  id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 连线松手在节点身上（没对准端口）时，按上游素材类型列出这个节点上同类型的端口，
 * 同类型有几处（参考素材行、角色参考、风格参考…）时按离松手位置由近到远排列，
 * 调用方取第一个还能再连的（离得最近的可能已经连满）。
 * handleBounds 是节点内坐标，nodePosition 是节点左上角的画布坐标，point 是松手的画布坐标。
 * 上游不是素材或节点上没有这类端口时返回空列表，交给调用方原有的判断。
 */
export function rankNearestMediaTargetHandles(input: {
  sourceNode: CanvasNode;
  sourceHandle?: string | null;
  targetNode: CanvasNode;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  handleBounds: readonly MediaHandleBound[];
  nodePosition: { x: number; y: number };
  point: { x: number; y: number };
}): string[] {
  const source = resolveMediaConnectionSource(input.sourceNode, input.sourceHandle);
  if (!source) return [];
  const candidates = [...new Set(resolveVisibleMediaInputPorts(input.targetNode, input.nodes, input.edges)
    .filter((port) => port.kind === source.kind)
    .map((port) => port.handleId))];
  const distanceOf = (handleId: string): number => {
    const bound = input.handleBounds.find((item) => (item.id ?? 'target') === handleId);
    if (!bound) return Number.POSITIVE_INFINITY;
    const dx = input.nodePosition.x + bound.x + bound.width / 2 - input.point.x;
    const dy = input.nodePosition.y + bound.y + bound.height / 2 - input.point.y;
    return dx * dx + dy * dy;
  };
  // 稳定排序：量不到位置的端口保持原有顺序排在最后
  return candidates
    .map((handleId, index) => ({ handleId, index, distance: distanceOf(handleId) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ handleId }) => handleId);
}
