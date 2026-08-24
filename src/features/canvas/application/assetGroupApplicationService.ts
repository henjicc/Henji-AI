import { v4 as uuidv4 } from 'uuid';

import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { CANVAS_NODE_TYPES, isAssetGroupNode, type AssetGroupNodeData } from '../domain/canvasNodes';
import { canvasNodeFactory } from './canvasServices';
import {
  addAssetGroupMembersGraph,
  bindAssetGroupGraph,
  createAssetGroupGraph,
  disconnectAssetGroupGraph,
  removeAssetGroupMemberGraph,
  restoreAssetGroupBindingGraph,
  setAssetGroupMemberExcludedGraph,
  summarizeAssetGroupBinding,
  ungroupAssetGroupGraph,
  updateAssetGroupDataGraph,
} from './assetGroupGraph';

const logger = createLogger('features.canvas.asset-group');

export class AssetGroupApplicationError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'AssetGroupApplicationError';
  }
}

function requireProject(projectId?: string): string {
  const project = useProjectStore.getState();
  const currentId = project.currentProjectId;
  if (!currentId || !project.currentProject || (projectId && currentId !== projectId)) {
    throw new AssetGroupApplicationError('NOT_FOUND', '当前画布项目不可用');
  }
  return currentId;
}

function persist(): void {
  const canvas = useCanvasStore.getState();
  useProjectStore.getState().saveCurrentProject(
    canvas.nodes,
    canvas.edges,
    canvas.currentViewport,
    canvas.history,
  );
}

function commit(
  operation: string,
  graph: ReturnType<typeof createAssetGroupGraph>,
  selectedNodeId?: string | null,
): void {
  if (!graph) throw new AssetGroupApplicationError('INVALID_INPUT', '素材组操作没有可应用的变化');
  useCanvasStore.getState().commitAssetGroupGraph(graph, selectedNodeId);
  persist();
  logger.info('素材组事务完成', { event: `canvas.asset_group.${operation}.completed`, selectedNodeId });
}

export function createAssetGroup(input: {
  memberIds: string[];
  name?: string;
  projectId?: string;
}): { projectId: string; groupId: string; accepted: number } {
  const projectId = requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  const groupCount = canvas.nodes.filter(isAssetGroupNode).length;
  const displayName = input.name?.trim() || `素材组 ${groupCount + 1}`;
  const group = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.assetGroup, { x: 0, y: 0 }, {
    displayName,
    memberOrder: [],
    coverMemberId: null,
    bindings: [],
  });
  logger.info('创建素材组开始', {
    event: 'canvas.asset_group.create.start',
    projectId,
    requestedCount: input.memberIds.length,
  });
  const graph = createAssetGroupGraph(canvas.nodes, canvas.edges, group, input.memberIds);
  if (!graph) throw new AssetGroupApplicationError('INVALID_INPUT', '至少需要选择两个可连接的图片、视频或音频节点');
  const createdNode = graph.nodes.find((node) => node.id === group.id);
  const created = createdNode && isAssetGroupNode(createdNode) ? createdNode : undefined;
  commit('create', graph, group.id);
  return { projectId, groupId: group.id, accepted: created?.data.memberOrder.length ?? 0 };
}

export function addAssetGroupMembers(input: {
  groupId: string;
  memberIds: string[];
  projectId?: string;
}): { projectId: string; groupId: string; memberCount: number } {
  const projectId = requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  const graph = addAssetGroupMembersGraph(canvas.nodes, canvas.edges, input.groupId, input.memberIds);
  commit('members.add', graph, input.groupId);
  const groupNode = graph?.nodes.find((node) => node.id === input.groupId);
  const group = groupNode && isAssetGroupNode(groupNode) ? groupNode : undefined;
  return { projectId, groupId: input.groupId, memberCount: group?.data.memberOrder.length ?? 0 };
}

export function removeAssetGroupMember(input: {
  groupId: string;
  memberId: string;
  projectId?: string;
}): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  commit('members.remove', removeAssetGroupMemberGraph(
    canvas.nodes, canvas.edges, input.groupId, input.memberId,
  ), input.groupId);
}

export function updateAssetGroup(input: {
  groupId: string;
  memberOrder?: string[];
  coverMemberId?: string | null;
  projectId?: string;
}): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  commit('update', updateAssetGroupDataGraph(canvas.nodes, canvas.edges, input.groupId, {
    memberOrder: input.memberOrder,
    coverMemberId: input.coverMemberId,
  }), input.groupId);
}

export function bindAssetGroup(input: {
  groupId: string;
  targetNodeId: string;
  projectId?: string;
}): { connected: number; pending: number; unsupported: number; excluded: number } {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  const currentNode = canvas.nodes.find((node) => node.id === input.groupId);
  if (!currentNode || !isAssetGroupNode(currentNode)) {
    throw new AssetGroupApplicationError('NOT_FOUND', '素材组不存在');
  }
  const currentBinding = currentNode.data.bindings.find((item) => item.targetNodeId === input.targetNodeId);
  if (currentBinding) {
    return summarizeAssetGroupBinding(canvas.nodes, canvas.edges, input.groupId, currentBinding);
  }
  const graph = bindAssetGroupGraph(canvas.nodes, canvas.edges, input.groupId, input.targetNodeId, uuidv4());
  commit('binding.create', graph, input.groupId);
  const groupNode = graph?.nodes.find((node) => node.id === input.groupId);
  const group = groupNode && isAssetGroupNode(groupNode) ? groupNode : undefined;
  const binding = group?.data.bindings.find((item) => item.targetNodeId === input.targetNodeId);
  return binding && graph
    ? summarizeAssetGroupBinding(graph.nodes, graph.edges, input.groupId, binding)
    : { connected: 0, pending: 0, unsupported: 0, excluded: 0 };
}

export function disconnectAssetGroup(input: {
  groupId: string;
  targetNodeId: string;
  projectId?: string;
}): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  const currentNode = canvas.nodes.find((node) => node.id === input.groupId);
  if (!currentNode || !isAssetGroupNode(currentNode)) {
    throw new AssetGroupApplicationError('NOT_FOUND', '素材组不存在');
  }
  if (!currentNode.data.bindings.some((item) => item.targetNodeId === input.targetNodeId)) return;
  commit('binding.remove', disconnectAssetGroupGraph(
    canvas.nodes, canvas.edges, input.groupId, input.targetNodeId,
  ), input.groupId);
}

export function setAssetGroupMemberExcluded(input: {
  groupId: string;
  bindingId: string;
  memberId: string;
  excluded: boolean;
  projectId?: string;
}): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  commit('binding.exclude', setAssetGroupMemberExcludedGraph(
    canvas.nodes,
    canvas.edges,
    input.groupId,
    input.bindingId,
    input.memberId,
    input.excluded,
  ), input.groupId);
}

export function restoreAssetGroupBinding(input: {
  groupId: string;
  bindingId: string;
  projectId?: string;
}): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  commit('binding.restore', restoreAssetGroupBindingGraph(
    canvas.nodes, canvas.edges, input.groupId, input.bindingId,
  ), input.groupId);
}

export function dissolveAssetGroup(input: { groupId: string; projectId?: string }): void {
  requireProject(input.projectId);
  const canvas = useCanvasStore.getState();
  commit('dissolve', ungroupAssetGroupGraph(canvas.nodes, canvas.edges, input.groupId), null);
}

export function getAssetGroupData(groupId: string): AssetGroupNodeData | null {
  const node = useCanvasStore.getState().nodes.find((item) => item.id === groupId);
  return node && isAssetGroupNode(node) ? node.data : null;
}
