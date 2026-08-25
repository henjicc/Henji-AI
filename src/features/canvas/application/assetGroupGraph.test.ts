import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registry } from '@/core/ModelRegistry';
import type { ModelDefinition } from '@/core/types';
import {
  CANVAS_NODE_TYPES,
  isAssetGroupNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import { canvasNodeDefinitions } from '../domain/nodeRegistry';
import { mediaPortId, paramPortId } from '../domain/socketTypes';
import {
  bindAssetGroupGraph,
  createAssetGroupGraph,
  removeAssetGroupMemberGraph,
  reorderAssetGroupMembersWithinKind,
  setAssetGroupMemberExcludedGraph,
  summarizeAssetGroupBinding,
  ungroupAssetGroupGraph,
  updateAssetGroupDataGraph,
} from './assetGroupGraph';
import { createAssetGroupRenderGraph } from './assetGroupRenderGraph';

const MODEL_ID = 'asset-group-model';
const MULTI_IMAGE_MODEL_ID = 'asset-group-multi-image-model';
const model: ModelDefinition = {
  meta: {
    id: MODEL_ID,
    canonicalModelId: 'z-image-turbo',
    provider: 'test',
    type: 'image',
    name: { zh: '素材组测试', en: 'Asset group test' },
    tags: ['image-to-image'],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 1 } },
  params: [{
    id: 'voiceReference',
    type: 'file-upload',
    order: 30,
    name: '声音参考',
    default: [],
    valueType: 'array',
    maxCount: 1,
    accept: ['audio/mpeg'],
    maxSize: 1024,
  }],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0, description: 'test' },
};
const multiImageModel: ModelDefinition = {
  ...model,
  meta: { ...model.meta, id: MULTI_IMAGE_MODEL_ID, name: { zh: '素材组多图测试', en: 'Asset group multi-image test' } },
  inputLimits: { images: { max: 4 }, videos: { max: 0 }, audios: { max: 1 } },
};

function node(type: CanvasNodeType, id: string, data: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    type,
    position: { x: Number(id.at(-1) ?? 0) * 20, y: 0 },
    data: { ...canvasNodeDefinitions[type].createDefaultData(), ...data },
  } as CanvasNode;
}

function fixture(): { nodes: CanvasNode[]; edges: CanvasEdge[]; groupId: string; targetId: string } {
  const imageOne = node(CANVAS_NODE_TYPES.upload, 'image-1', { imageUrl: 'image://one' });
  const imageTwo = node(CANVAS_NODE_TYPES.exportImage, 'image-2', { imageUrl: 'image://two' });
  const audio = node(CANVAS_NODE_TYPES.audioUpload, 'audio-1', { audioUrl: 'audio://one' });
  const video = node(CANVAS_NODE_TYPES.videoUpload, 'video-1', { videoUrl: 'video://one' });
  const target = node(CANVAS_NODE_TYPES.imageEdit, 'target-1', { modelId: MODEL_ID });
  const group = node(CANVAS_NODE_TYPES.assetGroup, 'group-1');
  const created = createAssetGroupGraph(
    [imageOne, imageTwo, audio, video, target],
    [],
    group,
    [imageOne.id, imageTwo.id, audio.id, video.id],
  );
  if (!created) throw new Error('fixture group failed');
  const bound = bindAssetGroupGraph(created.nodes, created.edges, group.id, target.id, 'binding-1');
  if (!bound) throw new Error('fixture binding failed');
  return { ...bound, groupId: group.id, targetId: target.id };
}

describe('assetGroupGraph', () => {
  beforeEach(() => {
    registry.clear();
    registry.register(model);
    registry.register(multiImageModel);
  });

  afterEach(() => registry.clear());

  it('混合素材建立持久绑定，按类型过滤并让超容量成员等待', () => {
    const graph = fixture();
    const group = graph.nodes.find((item) => item.id === graph.groupId);
    expect(group && isAssetGroupNode(group)).toBe(true);
    if (!group || !isAssetGroupNode(group)) return;
    const binding = group.data.bindings[0];
    const status = summarizeAssetGroupBinding(graph.nodes, graph.edges, group.id, binding);

    expect(graph.edges.map((edge) => [edge.source, edge.targetHandle])).toEqual([
      ['image-1', mediaPortId('image')],
      ['audio-1', paramPortId('voiceReference')],
    ]);
    expect(status).toEqual({ connected: 2, pending: 1, unsupported: 1, excluded: 0 });
  });

  it('调整成员顺序后由靠前图片占用唯一容量', () => {
    const graph = fixture();
    const reordered = updateAssetGroupDataGraph(
      graph.nodes,
      graph.edges,
      graph.groupId,
      { memberOrder: ['image-2', 'image-1', 'audio-1', 'video-1'] },
    );
    expect(reordered?.edges.filter((edge) => edge.targetHandle === mediaPortId('image')).map((edge) => edge.source))
      .toEqual(['image-2']);
  });

  it('收纳前成员连接同一模型时转为素材组束线并保持连接', () => {
    const imageOne = node(CANVAS_NODE_TYPES.upload, 'same-image-1', { imageUrl: 'image://one' });
    const imageTwo = node(CANVAS_NODE_TYPES.upload, 'same-image-2', { imageUrl: 'image://two' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'same-target', { modelId: MULTI_IMAGE_MODEL_ID });
    const group = node(CANVAS_NODE_TYPES.assetGroup, 'same-group');
    const targetHandle = mediaPortId('image');
    const created = createAssetGroupGraph(
      [imageOne, imageTwo, target],
      [
        { id: 'same-edge-1', source: imageOne.id, target: target.id, sourceHandle: 'source', targetHandle },
        { id: 'same-edge-2', source: imageTwo.id, target: target.id, sourceHandle: 'source', targetHandle },
      ],
      group,
      [imageOne.id, imageTwo.id],
    );

    const createdGroup = created?.nodes.find((item) => item.id === group.id);
    expect(createdGroup && isAssetGroupNode(createdGroup) ? createdGroup.data.bindings : [])
      .toEqual([expect.objectContaining({ targetNodeId: target.id, excludedMemberIds: [] })]);
    expect(created?.edges.map((edge) => edge.source)).toEqual([imageOne.id, imageTwo.id]);
    expect(created?.edges.every((edge) => edge.data?.managedByAssetGroup?.groupId === group.id)).toBe(true);
    const rendered = created ? createAssetGroupRenderGraph(created.nodes, created.edges) : null;
    expect(rendered?.edges).toEqual([
      expect.objectContaining({ source: group.id, target: target.id, type: 'assetGroupBundleEdge' }),
    ]);
  });

  it('收纳前成员连接不同模型时自动解开全部外连线', () => {
    const imageOne = node(CANVAS_NODE_TYPES.upload, 'mixed-image-1', { imageUrl: 'image://one' });
    const imageTwo = node(CANVAS_NODE_TYPES.upload, 'mixed-image-2', { imageUrl: 'image://two' });
    const targetOne = node(CANVAS_NODE_TYPES.imageEdit, 'mixed-target-1', { modelId: MODEL_ID });
    const targetTwo = node(CANVAS_NODE_TYPES.imageEdit, 'mixed-target-2', { modelId: MODEL_ID });
    const group = node(CANVAS_NODE_TYPES.assetGroup, 'mixed-group');
    const created = createAssetGroupGraph(
      [imageOne, imageTwo, targetOne, targetTwo],
      [
        { id: 'mixed-edge-1', source: imageOne.id, target: targetOne.id, sourceHandle: 'source', targetHandle: mediaPortId('image') },
        { id: 'mixed-edge-2', source: imageTwo.id, target: targetTwo.id, sourceHandle: 'source', targetHandle: mediaPortId('image') },
      ],
      group,
      [imageOne.id, imageTwo.id],
    );

    const createdGroup = created?.nodes.find((item) => item.id === group.id);
    expect(createdGroup && isAssetGroupNode(createdGroup) ? createdGroup.data.bindings : []).toEqual([]);
    expect(created?.edges).toEqual([]);
  });

  it('同一目标只有部分成员已连接时保持原状，不擅自连接其余成员', () => {
    const connected = node(CANVAS_NODE_TYPES.upload, 'partial-image-1', { imageUrl: 'image://one' });
    const disconnected = node(CANVAS_NODE_TYPES.upload, 'partial-image-2', { imageUrl: 'image://two' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'partial-target', { modelId: MODEL_ID });
    const group = node(CANVAS_NODE_TYPES.assetGroup, 'partial-group');
    const created = createAssetGroupGraph(
      [connected, disconnected, target],
      [{ id: 'partial-edge', source: connected.id, target: target.id, sourceHandle: 'source', targetHandle: mediaPortId('image') }],
      group,
      [connected.id, disconnected.id],
    );

    const createdGroup = created?.nodes.find((item) => item.id === group.id);
    expect(createdGroup && isAssetGroupNode(createdGroup) ? createdGroup.data.bindings[0].excludedMemberIds : [])
      .toEqual([disconnected.id]);
    expect(created?.edges.map((edge) => edge.source)).toEqual([connected.id]);
  });

  it('只重排指定媒体类型并保持其他类型的槽位不变', () => {
    const graph = fixture();
    const reordered = reorderAssetGroupMembersWithinKind(
      graph.nodes,
      ['image-1', 'audio-1', 'image-2', 'video-1'],
      'image',
      0,
      1,
    );

    expect(reordered).toEqual(['image-2', 'audio-1', 'image-1', 'video-1']);
  });

  it('删除组管理边会记录排除，恢复前不会自动补回', () => {
    const graph = fixture();
    const managed = graph.edges.find((edge) => edge.source === 'image-1');
    if (!managed?.data?.managedByAssetGroup) throw new Error('managed edge missing');
    const excluded = setAssetGroupMemberExcludedGraph(
      graph.nodes,
      graph.edges,
      graph.groupId,
      managed.data.managedByAssetGroup.bindingId,
      managed.source,
      true,
    );
    expect(excluded?.edges.some((edge) => edge.source === managed.source)).toBe(false);
    const group = excluded?.nodes.find((item) => item.id === graph.groupId);
    expect(group && isAssetGroupNode(group) ? group.data.bindings[0].excludedMemberIds : []).toEqual(['image-1']);
  });

  it('移出成员只清理它的组管理边，手动边保持不变', () => {
    const graph = fixture();
    const manual: CanvasEdge = {
      id: 'manual-edge',
      source: 'image-1',
      target: graph.targetId,
      sourceHandle: 'source',
      targetHandle: mediaPortId('image'),
    };
    const removed = removeAssetGroupMemberGraph(
      graph.nodes,
      [...graph.edges, manual],
      graph.groupId,
      'image-1',
    );
    expect(removed?.nodes.find((item) => item.id === 'image-1')).toMatchObject({ parentId: undefined, hidden: false });
    expect(removed?.edges.some((edge) => edge.id === manual.id)).toBe(true);
  });

  it('管理工作面打开前后都保持折叠束线，解散后边转为手动边', () => {
    const graph = fixture();
    const collapsed = createAssetGroupRenderGraph(graph.nodes, graph.edges);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0].data?.assetGroupBundle).toMatchObject({ groupId: graph.groupId, connected: 2 });
    expect(collapsed.nodes.filter((item) => item.parentId === graph.groupId).every((item) => item.hidden)).toBe(true);

    const dissolved = ungroupAssetGroupGraph(graph.nodes, graph.edges, graph.groupId);
    expect(dissolved?.nodes.some((item) => item.id === graph.groupId)).toBe(false);
    expect(dissolved?.edges.every((edge) => !edge.data?.managedByAssetGroup)).toBe(true);
  });
});
