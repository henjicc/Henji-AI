import type {
  AssetGroupBinding,
  AssetGroupNodeData,
  CanvasEdge,
  CanvasNode,
} from '../domain/canvasNodes';
import { CANVAS_NODE_TYPES, isAssetGroupNode } from '../domain/canvasNodes';
import type { RowMediaKind } from '../domain/socketTypes';
import { getNodeSize } from '../canvasUtils';
import { resolveVisibleMediaInputPorts } from './graphValueResolver';
import { planMediaConnections, resolveMediaConnectionSource } from './mediaConnectionPlanner';
import { getCanvasNodeDefinition } from '../domain/nodeRegistry';

export interface AssetGroupGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface AssetGroupBindingStatus {
  connected: number;
  pending: number;
  unsupported: number;
  excluded: number;
}

export function resolveAssetGroupMemberKind(node: CanvasNode): RowMediaKind | null {
  const actual = resolveMediaConnectionSource(node)?.kind;
  if (actual) return actual;
  const media = getCanvasNodeDefinition(node.type)?.media;
  if ((media?.role === 'source' || media?.role === 'result')
    && (media.kind === 'image' || media.kind === 'video' || media.kind === 'audio')) {
    return media.kind;
  }
  return null;
}

/**
 * 只调整同一种媒体在成员序列中占据的槽位，其他媒体的相对位置保持不变。
 * 连接规划会消费这份顺序，因此管理界面的拖拽会同步影响各类型输入的优先级。
 */
export function reorderAssetGroupMembersWithinKind(
  nodes: CanvasNode[],
  memberOrder: string[],
  kind: RowMediaKind,
  fromIndex: number,
  toIndex: number,
): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const kindOrder = memberOrder.filter((id) => {
    const member = nodeById.get(id);
    return member ? resolveAssetGroupMemberKind(member) === kind : false;
  });
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= kindOrder.length
    || toIndex >= kindOrder.length
  ) return memberOrder;

  const [moved] = kindOrder.splice(fromIndex, 1);
  kindOrder.splice(toIndex, 0, moved);
  let nextKindIndex = 0;
  return memberOrder.map((id) => {
    const member = nodeById.get(id);
    if (!member || resolveAssetGroupMemberKind(member) !== kind) return id;
    const replacement = kindOrder[nextKindIndex];
    nextKindIndex += 1;
    return replacement;
  });
}

function absolutePosition(node: CanvasNode, nodeById: Map<string, CanvasNode>): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function cleanGroupData(group: CanvasNode, nodes: CanvasNode[]): AssetGroupNodeData {
  const data = group.data as AssetGroupNodeData;
  const children = nodes.filter((node) => node.parentId === group.id && node.type !== CANVAS_NODE_TYPES.assetGroup);
  const childIds = new Set(children.map((node) => node.id));
  const ordered = [...new Set((data.memberOrder ?? []).filter((id) => childIds.has(id)))];
  for (const child of children) if (!ordered.includes(child.id)) ordered.push(child.id);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const bindings = (data.bindings ?? [])
    .filter((binding) => binding.targetNodeId !== group.id && nodeIds.has(binding.targetNodeId))
    .map((binding) => ({
      ...binding,
      excludedMemberIds: [...new Set(binding.excludedMemberIds.filter((id) => childIds.has(id)))],
    }));
  return {
    ...data,
    memberOrder: ordered,
    coverMemberId: data.coverMemberId && childIds.has(data.coverMemberId)
      ? data.coverMemberId
      : ordered[0] ?? null,
    bindings,
  };
}

function normalizeStructure(nodes: CanvasNode[]): CanvasNode[] {
  const assetGroupIds = new Set(nodes.filter(isAssetGroupNode).map((node) => node.id));
  return nodes.map((node) => {
    if (isAssetGroupNode(node)) {
      return { ...node, data: cleanGroupData(node, nodes), hidden: false };
    }
    if (node.parentId && assetGroupIds.has(node.parentId)) {
      return { ...node, hidden: true, selected: false, extent: undefined };
    }
    return node;
  });
}

export function reconcileAssetGroupGraph(nodes: CanvasNode[], edges: CanvasEdge[]): AssetGroupGraph {
  let nextNodes = normalizeStructure(nodes);
  let nextEdges = edges.filter((edge) => !edge.data?.managedByAssetGroup);
  const nodeById = new Map(nextNodes.map((node) => [node.id, node] as const));

  for (const group of nextNodes.filter(isAssetGroupNode)) {
    const data = cleanGroupData(group, nextNodes);
    const members = data.memberOrder
      .map((id) => nodeById.get(id))
      .filter((node): node is CanvasNode => Boolean(node));
    const memberKinds = new Set(
      members.map(resolveAssetGroupMemberKind).filter(Boolean),
    );
    const nextBindings: AssetGroupBinding[] = [];

    for (const binding of data.bindings) {
      const target = nodeById.get(binding.targetNodeId);
      if (!target) continue;
      const ports = resolveVisibleMediaInputPorts(target, nextNodes, nextEdges);
      const targetPortByKind: Partial<Record<RowMediaKind, string>> = {};
      for (const kind of ['image', 'video', 'audio'] as const) {
        if (!memberKinds.has(kind)) continue;
        const matching = ports.filter((port) => port.kind === kind);
        const retained = matching.find((port) => port.handleId === binding.targetPortByKind[kind]);
        const port = retained ?? matching[0];
        if (port) targetPortByKind[kind] = port.handleId;
      }
      const normalizedBinding: AssetGroupBinding = { ...binding, targetPortByKind };
      nextBindings.push(normalizedBinding);
      const excluded = new Set(normalizedBinding.excludedMemberIds);
      const plan = planMediaConnections({
        sourceNodeIds: data.memberOrder.filter((id) => !excluded.has(id)),
        targetNodeId: target.id,
        nodes: nextNodes,
        edges: nextEdges,
        preferredTargetHandles: targetPortByKind,
        edgeData: (memberId) => ({
          managedByAssetGroup: { groupId: group.id, bindingId: binding.id, memberId },
        }),
      });
      nextEdges = [
        ...nextEdges,
        ...plan.connections.map((connection, index): CanvasEdge => ({
          id: `asset-group:${binding.id}:${connection.source}:${index}`,
          ...connection,
          type: 'disconnectableEdge',
        })),
      ];
    }

    nextNodes = nextNodes.map((node) => node.id === group.id
      ? { ...node, data: { ...data, bindings: nextBindings } }
      : node);
    nodeById.set(group.id, nextNodes.find((node) => node.id === group.id) as CanvasNode);
  }

  return { nodes: nextNodes, edges: nextEdges };
}

export function createAssetGroupGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  groupNode: CanvasNode,
  requestedMemberIds: string[],
): AssetGroupGraph | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const assetGroupIds = new Set(nodes.filter(isAssetGroupNode).map((node) => node.id));
  const members = [...new Set(requestedMemberIds)]
    .map((id) => nodeById.get(id))
    .filter((node): node is CanvasNode => Boolean(node) && Boolean(resolveAssetGroupMemberKind(node!)))
    .filter((node) => !node.parentId || !assetGroupIds.has(node.parentId))
    .filter((node) => node.type !== CANVAS_NODE_TYPES.assetGroup)
    .sort((a, b) => {
      const first = absolutePosition(a, nodeById);
      const second = absolutePosition(b, nodeById);
      return first.y - second.y || first.x - second.x;
    });
  if (members.length < 2) return null;

  const bounds = members.reduce((value, member) => {
    const position = absolutePosition(member, nodeById);
    const size = getNodeSize(member);
    return {
      minX: Math.min(value.minX, position.x),
      minY: Math.min(value.minY, position.y),
      maxX: Math.max(value.maxX, position.x + size.width),
      maxY: Math.max(value.maxY, position.y + size.height),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const position = { x: Math.round(bounds.minX), y: Math.round(bounds.minY) };
  const memberIds = members.map((member) => member.id);
  const memberSet = new Set(memberIds);
  const sharedParentId = members.every((member) => member.parentId === members[0].parentId)
    ? members[0].parentId
    : undefined;
  const sharedParent = sharedParentId ? nodeById.get(sharedParentId) : undefined;
  const sharedParentPosition = sharedParent ? absolutePosition(sharedParent, nodeById) : { x: 0, y: 0 };
  const assetGroup: CanvasNode = {
    ...groupNode,
    position: {
      x: position.x - sharedParentPosition.x,
      y: position.y - sharedParentPosition.y,
    },
    parentId: sharedParentId,
    extent: sharedParentId ? ('parent' as const) : undefined,
    style: { width: 220, height: 144 },
    selected: true,
    data: {
      ...groupNode.data,
      memberOrder: memberIds,
      coverMemberId: memberIds[0],
      bindings: [],
    },
  };
  const nextNodes: CanvasNode[] = [];
  let insertedGroup = false;
  for (const node of nodes) {
    if (!insertedGroup && memberSet.has(node.id)) {
      nextNodes.push(assetGroup);
      insertedGroup = true;
    }
    if (!memberSet.has(node.id)) {
      nextNodes.push({ ...node, selected: false });
      continue;
    }
    const absolute = absolutePosition(node, nodeById);
    nextNodes.push({
      ...node,
      parentId: assetGroup.id,
      extent: undefined,
      hidden: true,
      selected: false,
      position: { x: Math.round(absolute.x - position.x), y: Math.round(absolute.y - position.y) },
    });
  }
  if (!insertedGroup) nextNodes.push(assetGroup);
  return reconcileAssetGroupGraph(nextNodes, edges);
}

export function addAssetGroupMembersGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, requestedIds: string[],
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const assetGroupIds = new Set(nodes.filter(isAssetGroupNode).map((node) => node.id));
  const groupAbsolute = absolutePosition(group, nodeById);
  const accepted = [...new Set(requestedIds)]
    .map((id) => nodeById.get(id))
    .filter((node): node is CanvasNode => Boolean(node) && node!.id !== groupId && Boolean(resolveAssetGroupMemberKind(node!)))
    .filter((node) => !node.parentId || !assetGroupIds.has(node.parentId))
    .filter((node) => node.type !== CANVAS_NODE_TYPES.assetGroup);
  if (accepted.length === 0) return null;
  const acceptedIds = new Set(accepted.map((node) => node.id));
  const data = cleanGroupData(group, nodes);
  const nextNodes = nodes.map((node) => {
    if (node.id === groupId) {
      return { ...node, data: { ...data, memberOrder: [...data.memberOrder, ...accepted.map((item) => item.id)] } };
    }
    if (!acceptedIds.has(node.id)) return node;
    const absolute = absolutePosition(node, nodeById);
    return {
      ...node,
      parentId: groupId,
      extent: undefined,
      hidden: true,
      selected: false,
      position: { x: Math.round(absolute.x - groupAbsolute.x), y: Math.round(absolute.y - groupAbsolute.y) },
    };
  });
  return reconcileAssetGroupGraph(nextNodes, edges);
}

export function removeAssetGroupMemberGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, memberId: string,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  const member = nodes.find((node) => node.id === memberId && node.parentId === groupId);
  if (!group || !member) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const absolute = absolutePosition(member, nodeById);
  const parent = group.parentId ? nodeById.get(group.parentId) : undefined;
  const parentAbsolute = parent ? absolutePosition(parent, nodeById) : { x: 0, y: 0 };
  const data = cleanGroupData(group, nodes);
  const nextNodes = nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        data: {
          ...data,
          memberOrder: data.memberOrder.filter((id) => id !== memberId),
          coverMemberId: data.coverMemberId === memberId ? null : data.coverMemberId,
          bindings: data.bindings.map((binding) => ({
            ...binding,
            excludedMemberIds: binding.excludedMemberIds.filter((id) => id !== memberId),
          })),
        },
      };
    }
    if (node.id !== memberId) return node;
    return {
      ...node,
      parentId: group.parentId,
      extent: group.parentId ? ('parent' as const) : undefined,
      hidden: false,
      position: { x: Math.round(absolute.x - parentAbsolute.x + 24), y: Math.round(absolute.y - parentAbsolute.y + 24) },
    };
  });
  const nextEdges = edges.filter((edge) => edge.data?.managedByAssetGroup?.memberId !== memberId);
  return reconcileAssetGroupGraph(nextNodes, nextEdges);
}

export function updateAssetGroupDataGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string,
  patch: Pick<Partial<AssetGroupNodeData>, 'memberOrder' | 'coverMemberId'>,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const data = cleanGroupData(group, nodes);
  const memberIds = new Set(data.memberOrder);
  const nextOrder = patch.memberOrder
    ? [...new Set(patch.memberOrder.filter((id) => memberIds.has(id)))]
    : data.memberOrder;
  for (const id of data.memberOrder) if (!nextOrder.includes(id)) nextOrder.push(id);
  const nextCover = patch.coverMemberId === undefined
    ? data.coverMemberId
    : patch.coverMemberId && memberIds.has(patch.coverMemberId) ? patch.coverMemberId : data.coverMemberId;
  return reconcileAssetGroupGraph(nodes.map((node) => node.id === groupId
    ? { ...node, data: { ...data, memberOrder: nextOrder, coverMemberId: nextCover } }
    : node), edges);
}

export function bindAssetGroupGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, targetNodeId: string, bindingId: string,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!group || !target || groupId === targetNodeId) return null;
  const data = cleanGroupData(group, nodes);
  if (data.bindings.some((binding) => binding.targetNodeId === targetNodeId)) {
    return reconcileAssetGroupGraph(nodes, edges);
  }
  const memberKinds = new Set(data.memberOrder.map((id) => {
    const member = nodes.find((node) => node.id === id);
    return member ? resolveAssetGroupMemberKind(member) : undefined;
  }));
  const ports = resolveVisibleMediaInputPorts(target, nodes, edges);
  if (!ports.some((port) => memberKinds.has(port.kind))) return null;
  const targetPortByKind: Partial<Record<RowMediaKind, string>> = {};
  for (const kind of ['image', 'video', 'audio'] as const) {
    const port = ports.find((candidate) => candidate.kind === kind);
    if (port && memberKinds.has(kind)) targetPortByKind[kind] = port.handleId;
  }
  const binding: AssetGroupBinding = { id: bindingId, targetNodeId, targetPortByKind, excludedMemberIds: [] };
  return reconcileAssetGroupGraph(nodes.map((node) => node.id === groupId
    ? { ...node, data: { ...data, bindings: [...data.bindings, binding] } }
    : node), edges);
}

export function disconnectAssetGroupGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, targetNodeId: string,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const data = cleanGroupData(group, nodes);
  if (!data.bindings.some((binding) => binding.targetNodeId === targetNodeId)) return null;
  return reconcileAssetGroupGraph(nodes.map((node) => node.id === groupId
    ? { ...node, data: { ...data, bindings: data.bindings.filter((binding) => binding.targetNodeId !== targetNodeId) } }
    : node), edges);
}

export function setAssetGroupMemberExcludedGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, bindingId: string, memberId: string, excluded: boolean,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const data = cleanGroupData(group, nodes);
  let changed = false;
  const bindings = data.bindings.map((binding) => {
    if (binding.id !== bindingId || !data.memberOrder.includes(memberId)) return binding;
    const ids = new Set(binding.excludedMemberIds);
    excluded ? ids.add(memberId) : ids.delete(memberId);
    changed = true;
    return { ...binding, excludedMemberIds: [...ids] };
  });
  if (!changed) return null;
  return reconcileAssetGroupGraph(nodes.map((node) => node.id === groupId
    ? { ...node, data: { ...data, bindings } }
    : node), edges);
}

export function restoreAssetGroupBindingGraph(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, bindingId: string,
): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const data = cleanGroupData(group, nodes);
  const binding = data.bindings.find((item) => item.id === bindingId);
  if (!binding || binding.excludedMemberIds.length === 0) return null;
  return reconcileAssetGroupGraph(nodes.map((node) => node.id === groupId
    ? {
        ...node,
        data: {
          ...data,
          bindings: data.bindings.map((item) => item.id === bindingId
            ? { ...item, excludedMemberIds: [] }
            : item),
        },
      }
    : node), edges);
}

export function ungroupAssetGroupGraph(nodes: CanvasNode[], edges: CanvasEdge[], groupId: string): AssetGroupGraph | null {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const parent = group.parentId ? nodeById.get(group.parentId) : undefined;
  const parentAbsolute = parent ? absolutePosition(parent, nodeById) : { x: 0, y: 0 };
  const nextNodes = nodes.filter((node) => node.id !== groupId).map((node) => {
    if (node.parentId !== groupId) return node;
    const absolute = absolutePosition(node, nodeById);
    return {
      ...node,
      parentId: group.parentId,
      extent: group.parentId ? ('parent' as const) : undefined,
      hidden: false,
      selected: false,
      position: { x: Math.round(absolute.x - parentAbsolute.x), y: Math.round(absolute.y - parentAbsolute.y) },
    };
  });
  const nextEdges = edges.map((edge) => edge.data?.managedByAssetGroup?.groupId === groupId
    ? { ...edge, data: { ...edge.data, managedByAssetGroup: undefined } }
    : edge);
  return { nodes: nextNodes, edges: nextEdges };
}

export function summarizeAssetGroupBinding(
  nodes: CanvasNode[], edges: CanvasEdge[], groupId: string, binding: AssetGroupBinding,
): AssetGroupBindingStatus {
  const group = nodes.find((node) => node.id === groupId && isAssetGroupNode(node));
  if (!group) return { connected: 0, pending: 0, unsupported: 0, excluded: 0 };
  const data = cleanGroupData(group, nodes);
  const target = nodes.find((node) => node.id === binding.targetNodeId);
  const supportedKinds = new Set(target
    ? resolveVisibleMediaInputPorts(target, nodes, edges).map((port) => port.kind)
    : []);
  const excluded = new Set(binding.excludedMemberIds);
  let connected = 0;
  let pending = 0;
  let unsupported = 0;
  for (const memberId of data.memberOrder) {
    if (excluded.has(memberId)) continue;
    const member = nodes.find((node) => node.id === memberId);
    const kind = member ? resolveAssetGroupMemberKind(member) : undefined;
    if (!kind || !supportedKinds.has(kind)) unsupported += 1;
    else if (edges.some((edge) => edge.data?.managedByAssetGroup?.bindingId === binding.id && edge.source === memberId)) connected += 1;
    else pending += 1;
  }
  return { connected, pending, unsupported, excluded: excluded.size };
}
