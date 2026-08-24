import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '@/core/ModelRegistry';
import type { ModelDefinition } from '@/core/types';

import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import { canvasNodeDefinitions } from '../domain/nodeRegistry';
import { mediaPortId, paramPortId, promptPortId } from '../domain/socketTypes';
import { collectInputMedia } from './graphMediaResolver';
import { collectInputValues, resolveVisibleMediaInputPorts } from './graphValueResolver';
import { planMediaConnections } from './mediaConnectionPlanner';

const TEST_MODEL_ID = 'canvas-media-planner-image';
const testModel: ModelDefinition = {
  meta: {
    id: TEST_MODEL_ID,
    canonicalModelId: 'z-image-turbo',
    provider: 'test',
    type: 'image',
    name: { zh: '连接测试', en: 'Connection test' },
    tags: ['image-to-image'],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [
    { id: 'characterReference', type: 'image-upload', order: 30, name: '角色参考', default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], maxSize: 1024 },
    { id: 'styleReference', type: 'image-upload', order: 31, name: '风格参考', default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], maxSize: 1024 },
    { id: 'depthReference', type: 'image-upload', order: 32, name: '深度参考', default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], maxSize: 1024 },
  ],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0, description: 'test' },
};

function node(type: CanvasNodeType, id: string, data: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { ...canvasNodeDefinitions[type].createDefaultData(), ...data },
  } as CanvasNode;
}

describe('mediaConnectionPlanner', () => {
  beforeEach(() => {
    registry.clear();
    registry.register(testModel);
  });

  afterEach(() => registry.clear());

  it('拖到错误文本端口时自动纠正到首个可见图片端口', () => {
    const source = node(CANVAS_NODE_TYPES.upload, 'image-1', { imageUrl: 'image://one' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'target', { modelId: TEST_MODEL_ID });
    const plan = planMediaConnections({
      sourceNodeIds: [source.id],
      targetNodeId: target.id,
      nodes: [source, target],
      edges: [],
      preferredTargetHandle: promptPortId(),
    });

    expect(plan.connections).toEqual([
      expect.objectContaining({ source: source.id, target: target.id, targetHandle: mediaPortId('image') }),
    ]);
  });

  it('按选择顺序填充容量并过滤目标不支持的媒体', () => {
    const imageOne = node(CANVAS_NODE_TYPES.upload, 'image-1', { imageUrl: 'image://one' });
    const imageTwo = node(CANVAS_NODE_TYPES.exportImage, 'image-2', { imageUrl: 'image://two' });
    const audio = node(CANVAS_NODE_TYPES.audioUpload, 'audio-1', { audioUrl: 'audio://one' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'target', { modelId: TEST_MODEL_ID });
    const plan = planMediaConnections({
      sourceNodeIds: [imageOne.id, imageTwo.id, audio.id],
      targetNodeId: target.id,
      nodes: [imageOne, imageTwo, audio, target],
      edges: [],
    });

    expect(plan.connections.map((connection) => connection.source)).toEqual([imageOne.id]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ sourceNodeId: imageTwo.id, reason: 'capacity-exceeded' }),
      expect.objectContaining({ sourceNodeId: audio.id, reason: 'target-unsupported' }),
    ]);
  });

  it('默认选择主图片行，精准落在具名图片参数时尊重该接口', () => {
    const source = node(CANVAS_NODE_TYPES.upload, 'image-1', { imageUrl: 'image://one' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'target', { modelId: TEST_MODEL_ID });
    const ports = resolveVisibleMediaInputPorts(target, [source, target], []);
    expect(ports.filter((port) => port.kind === 'image').map((port) => port.handleId)).toEqual([
      mediaPortId('image'),
      paramPortId('characterReference'),
      paramPortId('styleReference'),
      paramPortId('depthReference'),
    ]);

    const precise = planMediaConnections({
      sourceNodeIds: [source.id],
      targetNodeId: target.id,
      nodes: [source, target],
      edges: [],
      preferredTargetHandle: paramPortId('styleReference'),
    });
    expect(precise.connections[0]?.targetHandle).toBe(paramPortId('styleReference'));
  });

  it('具名媒体参数只写入自身参数，不再进入主媒体列表', () => {
    const source = node(CANVAS_NODE_TYPES.upload, 'image-1', { imageUrl: 'image://one' });
    const target = node(CANVAS_NODE_TYPES.imageEdit, 'target', { modelId: TEST_MODEL_ID });
    const edge: CanvasEdge = {
      id: 'edge-1',
      source: source.id,
      target: target.id,
      sourceHandle: 'source',
      targetHandle: paramPortId('styleReference'),
    };

    expect(collectInputMedia(target.id, [source, target], [edge])).toEqual([]);
    expect(collectInputValues(target.id, [source, target], [edge])).toMatchObject({
      styleReference: ['image://one'],
    });
  });
});
