import { afterEach, describe, expect, it } from 'vitest';

import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument';
import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { useCanvasStore } from './canvasStore';
import { normalizeNodes } from './canvasStoreNormalization';

function legacyPortraitNode(displayName = '人像质感'): CanvasNode {
  return {
    id: 'legacy-portrait', type: 'portraitTextureGenNode',
    position: { x: 450, y: 90 }, width: 480, height: 360,
    style: { width: 480, height: 360 },
    data: {
      displayName, modelId: 'kie-gpt-image-2',
      prompt: '保存的电影层次编辑提示词',
      promptDocument: createPlainTextPromptDocument('保存的电影层次编辑提示词'),
      params: { kieGptImage2Resolution: '1K', kieGptImage2AspectRatio: '2:3' },
      mediaInputs: { image: ['source.png'] },
      capabilityId: 'image.portrait-texture',
      promptTemplateVersion: 'portrait-texture-gpt-image-2-v1',
      fixedSemanticParams: { portraitTextureContractVersion: 1 },
      portraitTextureSettings: { preset: 'cinematic-depth', strength: 'subtle' },
      portraitTextureRouteReasons: [],
      isSizeManuallyAdjusted: true, isGenerating: false,
    },
  } as unknown as CanvasNode;
}

afterEach(() => useCanvasStore.getState().clearCanvas());

describe('下线人像质感节点兼容', () => {
  it('专属节点不再注册，旧节点转换为普通图片生成并保留用户数据', () => {
    expect(Object.keys(canvasNodeDefinitions)).not.toContain('portraitTextureGenNode');
    const original = legacyPortraitNode();
    const before = structuredClone(original);
    const [node] = normalizeNodes([original]);
    expect(node).toMatchObject({
      id: original.id, type: CANVAS_NODE_TYPES.imageEdit,
      position: original.position, width: 480, height: 360, style: original.style,
      data: {
        modelId: 'kie-gpt-image-2', prompt: original.data.prompt,
        promptDocument: original.data.promptDocument, params: original.data.params,
        mediaInputs: original.data.mediaInputs, isSizeManuallyAdjusted: true,
      },
    });
    for (const key of ['capabilityId', 'promptTemplateVersion', 'fixedSemanticParams',
      'portraitTextureSettings', 'portraitTextureRouteReasons']) {
      expect(node.data).not.toHaveProperty(key);
    }
    expect(node.data.displayName).not.toBe('人像质感');
    expect(original).toEqual(before);
    expect(normalizeNodes([node])).toEqual([node]);
  });

  it('保留自定义标题', () => {
    expect(normalizeNodes([legacyPortraitNode('人物精修草稿')])[0].data.displayName)
      .toBe('人物精修草稿');
  });

  it('打开工程及撤销重做均保留上下游连线、已有结果，不复活下线节点', () => {
    const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 90 });
    source.data.imageUrl = 'source.png';
    const legacy = legacyPortraitNode();
    const result = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 1000, y: 90 });
    Object.assign(result.data, {
      imageUrl: 'saved-result.png', previewImageUrl: 'saved-result.png',
      sourceCapabilityId: 'image.portrait-texture',
    });
    const nodes = [source, legacy, result];
    const edges = [
      { id: 'input', source: source.id, target: legacy.id, sourceHandle: 'source', targetHandle: 'param:__image' },
      { id: 'output', source: legacy.id, target: result.id, sourceHandle: 'source', targetHandle: 'target' },
    ];
    useCanvasStore.getState().setCanvasData(nodes, edges, {
      past: [{ nodes, edges }], future: [{ nodes, edges }],
    });
    const assertGraph = () => {
      const state = useCanvasStore.getState();
      expect(state.nodes).toHaveLength(3);
      expect(state.nodes.find(({ id }) => id === legacy.id)?.type).toBe(CANVAS_NODE_TYPES.imageEdit);
      expect(state.nodes.find(({ id }) => id === result.id)?.data.imageUrl).toBe('saved-result.png');
      expect(state.edges).toEqual(edges.map((edge) => ({ ...edge, type: 'disconnectableEdge' })));
    };
    assertGraph();
    for (const snapshot of [...useCanvasStore.getState().history.past, ...useCanvasStore.getState().history.future]) {
      expect(snapshot.nodes.find(({ id }) => id === legacy.id)?.type).toBe(CANVAS_NODE_TYPES.imageEdit);
    }
    useCanvasStore.getState().undo();
    assertGraph();
    useCanvasStore.getState().redo();
    assertGraph();
  });

  it('保留已提交任务的续查标识，不因下线丢失待领取结果', () => {
    const result = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 1000, y: 90 });
    Object.assign(result.data, {
      isGenerating: true, serverTaskId: 'submitted-task',
      serverTaskModelId: 'kie-gpt-image-2', sourceCapabilityId: 'image.portrait-texture',
    });
    const [, restored] = normalizeNodes([legacyPortraitNode(), result]);
    expect(restored.data).toMatchObject({
      isGenerating: true, serverTaskId: 'submitted-task', serverTaskModelId: 'kie-gpt-image-2',
    });
  });
});
