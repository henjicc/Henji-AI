import { v4 as uuidv4 } from 'uuid';

import { createLogger } from '@/core/logging';
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveMediaFiles } from '../canvasUtils';
import {
  CANVAS_NODE_TYPES,
  isAssetGroupNode,
  type AssetGroupNodeData,
  type CanvasNode,
  type CanvasNodeData,
} from '../domain/canvasNodes';
import { mediaSourceNodeData, mediaSourceNodeType } from './assetMediaAssignment';
import { canvasNodeFactory } from './canvasServices';
import { importCanvasMediaFile } from './mediaImport';
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
}): {
  projectId: string;
  groupId: string;
  accepted: number;
  preservedConnectionCount: number;
  disconnectedConnectionCount: number;
} {
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
  try {
    const graph = createAssetGroupGraph(canvas.nodes, canvas.edges, group, input.memberIds);
    if (!graph) throw new AssetGroupApplicationError('INVALID_INPUT', '至少需要选择两个可连接的图片、视频或音频节点');
    const createdNode = graph.nodes.find((node) => node.id === group.id);
    const created = createdNode && isAssetGroupNode(createdNode) ? createdNode : undefined;
    const createdMemberIds = new Set(created?.data.memberOrder ?? []);
    const originalOutboundEdges = canvas.edges.filter((edge) => (
      createdMemberIds.has(edge.source) && !createdMemberIds.has(edge.target)
    ));
    const preservedConnectionCount = created?.data.bindings.length
      ? graph.edges.filter((edge) => edge.data?.managedByAssetGroup?.groupId === group.id).length
      : 0;
    const disconnectedConnectionCount = created?.data.bindings.length ? 0 : originalOutboundEdges.length;
    commit('create', graph, group.id);
    logger.info('素材组创建连线策略完成', {
      event: 'canvas.asset_group.create.connection_policy.completed',
      projectId,
      groupId: group.id,
      preservedConnectionCount,
      disconnectedConnectionCount,
    });
    return {
      projectId,
      groupId: group.id,
      accepted: created?.data.memberOrder.length ?? 0,
      preservedConnectionCount,
      disconnectedConnectionCount,
    };
  } catch (error) {
    logger.error('创建素材组失败', error, {
      event: 'canvas.asset_group.create.failed',
      context: { projectId, requestedCount: input.memberIds.length },
    });
    throw error;
  }
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

function requireAssetGroup(groupId: string): CanvasNode {
  const group = useCanvasStore.getState().nodes.find((node) => node.id === groupId);
  if (!group || !isAssetGroupNode(group)) {
    throw new AssetGroupApplicationError('NOT_FOUND', '素材组不存在');
  }
  return group;
}

function commitNewMembers(groupId: string, newMembers: CanvasNode[], operation: string): void {
  const canvas = useCanvasStore.getState();
  const graph = addAssetGroupMembersGraph(
    [...canvas.nodes, ...newMembers],
    canvas.edges,
    groupId,
    newMembers.map((member) => member.id),
  );
  commit(operation, graph, groupId);
}

export function addAssetToAssetGroup(input: {
  groupId: string;
  asset: AssetDragPayload;
  projectId?: string;
}): { projectId: string; groupId: string; memberId: string } {
  const projectId = requireProject(input.projectId);
  const group = requireAssetGroup(input.groupId);
  logger.info('资产加入素材组开始', {
    event: 'canvas.asset_group.asset.add.start',
    projectId,
    groupId: input.groupId,
    assetId: input.asset.assetId,
    mediaType: input.asset.type,
  });
  const member = canvasNodeFactory.createNode(
    mediaSourceNodeType(input.asset.type),
    group.position,
    mediaSourceNodeData(input.asset),
  );
  commitNewMembers(input.groupId, [member], 'asset.add');
  return { projectId, groupId: input.groupId, memberId: member.id };
}

export async function importFilesToAssetGroup(input: {
  groupId: string;
  files: readonly File[];
  projectId?: string;
}): Promise<{ projectId: string; groupId: string; added: number; skipped: number; failed: number }> {
  const projectId = requireProject(input.projectId);
  requireAssetGroup(input.groupId);
  const mediaFiles = resolveMediaFiles(input.files);
  const skipped = Math.max(0, input.files.length - mediaFiles.length);
  logger.info('文件加入素材组开始', {
    event: 'canvas.asset_group.files.import.start',
    projectId,
    groupId: input.groupId,
    fileCount: input.files.length,
    supportedCount: mediaFiles.length,
    skipped,
  });

  const settled = await Promise.allSettled(mediaFiles.map(async ({ file }) => ({
    file,
    imported: await importCanvasMediaFile(file),
  })));
  const successful = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failed = settled.length - successful.length;
  if (successful.length === 0) {
    if (failed > 0) {
      const firstFailure = settled.find((result) => result.status === 'rejected');
      logger.error('文件加入素材组失败', firstFailure?.status === 'rejected' ? firstFailure.reason : undefined, {
        event: 'canvas.asset_group.files.import.failed',
        context: { projectId, groupId: input.groupId, failed, skipped },
      });
    } else {
      logger.info('文件加入素材组完成', {
        event: 'canvas.asset_group.files.import.completed',
        projectId,
        groupId: input.groupId,
        added: 0,
        failed,
        skipped,
      });
    }
    return { projectId, groupId: input.groupId, added: 0, skipped, failed };
  }

  try {
    const group = requireAssetGroup(input.groupId);
    const useFileName = useSettingsStore.getState().useUploadFilenameAsNodeTitle;
    const members = successful.map(({ file, imported }) => canvasNodeFactory.createNode(
      imported.type,
      group.position,
      {
        ...imported.data,
        ...(useFileName ? { displayName: file.name } : {}),
      } as Partial<CanvasNodeData>,
    ));
    commitNewMembers(input.groupId, members, 'files.import');
    logger.info('文件加入素材组完成', {
      event: 'canvas.asset_group.files.import.completed',
      projectId,
      groupId: input.groupId,
      added: members.length,
      failed,
      skipped,
      mediaTypes: Array.from(new Set(successful.map(({ imported }) => imported.kind))),
    });
    return { projectId, groupId: input.groupId, added: members.length, skipped, failed };
  } catch (error) {
    logger.error('文件加入素材组失败', error, {
      event: 'canvas.asset_group.files.import.failed',
      context: { projectId, groupId: input.groupId, failed, skipped },
    });
    throw error;
  }
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
