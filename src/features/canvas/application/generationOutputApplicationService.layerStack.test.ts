// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '../domain/canvasNodes';
import {
  createDefaultGenerationOutputItems,
  createLayerStackCompositeOutputDescriptor,
  type CanvasGenerationOutputBatchContractV1,
} from '../domain/generationOutputs';
import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from '../domain/layerStack';
import { canvasNodeFactory } from './canvasServices';
import { publishCanvasSuccessfulExecution } from './canvasExecutionPublication';
import { collectInputMedia } from './graphMediaResolver';
import {
  commitCanvasGenerationOutputs,
  validateGenerationOutputBatchContract,
} from './generationOutputApplicationService';
import type { MultiLayerDocumentNodeProjection } from './multiLayerDocumentNodeApplicationContracts';

const projectId = 'generation-output-project';

function emptyProject(nodes: CanvasNode[]): Project {
  return {
    id: projectId,
    name: '多结果落图测试',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: nodes.length,
    coverPath: null,
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  };
}

function setupCanvas(
  resultKind: 'image' | 'panorama' = 'image',
  explicitResultNodeType?: CanvasNode['type'],
): {
  source: CanvasNode;
  placeholder: CanvasNode;
} {
  const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
    displayName: '生成节点',
  });
  source.id = 'source-node';
  const resultNodeType = explicitResultNodeType ?? (resultKind === 'panorama'
    ? CANVAS_NODE_TYPES.panoramaViewer
    : CANVAS_NODE_TYPES.exportImage);
  const placeholder = canvasNodeFactory.createNode(resultNodeType, { x: 420, y: 0 }, {
    displayName: '生成结果',
    ...(resultNodeType === CANVAS_NODE_TYPES.layerStackResult ? {} : { resultKind }),
    isGenerating: true,
    generationStartedAt: 100,
  });
  placeholder.id = 'placeholder-node';
  const nodes = [source, placeholder];
  const project = emptyProject(nodes);
  useCanvasStore.getState().setCanvasData(nodes, [{
    id: 'source-result-edge',
    source: source.id,
    target: placeholder.id,
    sourceHandle: 'source',
    targetHandle: 'target',
  }], { past: [], future: [] });
  useCanvasStore.getState().setSelectedNode(source.id);
  useProjectStore.setState({
    projects: [project],
    currentProjectId: projectId,
    currentProject: project,
    isHydrated: true,
    isOpeningProject: false,
    saveCurrentProject: vi.fn(),
  });
  return { source, placeholder };
}

function imagePatch(source: string, aspectRatio = '1:1'): DynamicValueMap {
  const name = source.split('/').at(-1) ?? 'result';
  return {
    imageUrl: `/managed/${name}.png`,
    previewImageUrl: `/managed/${name}-preview.png`,
    aspectRatio,
  };
}

function contract(
  count: number,
  strategy: CanvasGenerationOutputBatchContractV1['strategy'] = count === 1 ? 'single' : 'assetGroup',
): CanvasGenerationOutputBatchContractV1 {
  return {
    version: 1,
    strategy,
    resultKind: count === 1 ? 'image' : 'image-group',
    expectedOutputCount: count,
    outputs: createDefaultGenerationOutputItems({
      sources: Array.from({ length: count }, (_, index) => `/remote/result-${index + 1}`),
      mediaType: 'image',
    }),
  };
}

function layerStackDocument(completionId: string): LayerStackDocumentV1 {
  const stackId = createStableLayerStackId(completionId);
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source-node', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', completionId },
    canvas: { width: 512, height: 512, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [0, 1].map((index) => ({ version: 1 as const, layerId: createStableLayerId(stackId, index), sourceOutputIndex: index, providerZIndex: index, order: index, role: index === 0 ? 'base' as const : 'content' as const, name: index === 0 ? '底图' : '图层', resourceId: createStableLayerResourceId(stackId, index), placement: { x: 0, y: 0, width: 512, height: 512 }, opacity: 1, visible: true, blendMode: 'normal' as const, alpha: index === 0 ? 'opaque' as const : 'straight' as const })),
    resources: [
      { version: 1, resourceId: createStableLayerResourceId(stackId, 0), status: 'ready', filePath: '/managed/base.jpg', mimeType: 'image/jpeg', width: 512, height: 512, hasAlpha: false, byteLength: 100, sha256: 'a' },
      { version: 1, resourceId: createStableLayerResourceId(stackId, 1), status: 'ready', filePath: '/managed/layer.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 100, sha256: 'b' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/managed/composite.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 100, sha256: 'c' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/managed/thumb.webp', mimeType: 'image/webp', width: 256, height: 256, hasAlpha: false, byteLength: 50, sha256: 'd' },
    ],
  };
}

function layerStackProjection(revision = 0): MultiLayerDocumentNodeProjection {
  return {
    imageEditSession: {
      kind: 'image-edit-v3',
      sourceUrl: '/managed/composite.png',
      documentRef: 'image-edit-v3:layer-stack-document',
      revision,
      previewRef: null,
    },
    imageUrl: '/managed/composite.png',
    previewImageUrl: '/managed/thumb.webp',
    aspectRatio: '512:512',
  };
}

async function commit(
  value: CanvasGenerationOutputBatchContractV1,
  completionId = 'completion-1',
) {
  return await commitCanvasGenerationOutputs({
    sourceNodeId: 'source-node',
    placeholderNodeId: 'placeholder-node',
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
    contract: value,
    completionId,
    persistOutput: async (_mediaType, source) => imagePatch(source),
  });
}

describe('generationOutputApplicationService 图层栈', () => {
  beforeEach(() => {
    setupCanvas();
  });

  it('多角度 profile 与 angle 可按顺序持久化，图层栈需预验证后原子提交', async () => {
    const multiAngle = contract(2);
    multiAngle.outputs[0].descriptor = {
      ...multiAngle.outputs[0].descriptor,
      semantic: { kind: 'camera-view', resultKind: 'image', label: '左侧面' },
      profile: { id: 'continuous-v1', precision: 'learned-native' },
      angle: { control: { yawControlDeg: 90, verticalControl: 0 } },
    };
    const result = await commit(multiAngle, 'multi-angle-completion');
    const first = useCanvasStore.getState().nodes.find((node) => node.id === result.resultNodeIds[0]);
    expect(first?.data.generationOutputDescriptor).toMatchObject({
      semantic: { kind: 'camera-view', label: '左侧面' },
      profile: { id: 'continuous-v1', precision: 'learned-native' },
      angle: { control: { yawControlDeg: 90 } },
    });

    setupCanvas('image', CANVAS_NODE_TYPES.layerStackResult);
    const layerContract = contract(2, 'layer-stack');
    layerContract.resultKind = 'layer-stack';
    layerContract.outputs.forEach((item, index) => {
      item.descriptor.semantic = { kind: 'layer', resultKind: 'image', label: `图层 ${index + 1}` };
      item.descriptor.layer = { index, opacity: 1, blendMode: 'normal' };
    });
    expect(validateGenerationOutputBatchContract(layerContract)).toHaveLength(2);
    layerContract.outputs[0].descriptor.layer = { index: 0, opacity: 1.1, blendMode: 'normal' };
    expect(() => validateGenerationOutputBatchContract(layerContract)).toThrow('图层透明度必须位于 0 到 1 之间');
    layerContract.outputs[0].descriptor.layer = { index: 0, opacity: 1, blendMode: 'normal' };
    await expect(commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.layerStackResult,
      contract: layerContract,
      persistOutput: vi.fn(),
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const completionId = 'layer-completion';
    const layerResult = await commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.layerStackResult,
      contract: layerContract,
      completionId,
      preparedLayerStack: layerStackDocument(completionId),
      createLayerStackDocument: vi.fn(async () => layerStackProjection()),
      persistOutput: vi.fn(),
    });
    expect(layerResult).toMatchObject({ resultNodeIds: ['placeholder-node'], groupNodeId: null, strategy: 'layer-stack' });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data).toMatchObject({
      imageUrl: '/managed/composite.png',
      previewImageUrl: '/managed/thumb.webp',
      resultKind: 'layer-stack',
      generationOutputCommitId: completionId,
      generationOutputDescriptor: createLayerStackCompositeOutputDescriptor(),
      imageEditSession: layerStackProjection().imageEditSession,
    });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data.layerStackDocument)
      .toBeUndefined();
  });

  it('图层栈合成结果以稳定单节点身份发布并被下游消费', async () => {
    setupCanvas('image', CANVAS_NODE_TYPES.layerStackResult);
    useCanvasStore.getState().updateNodeData('placeholder-node', {
      generationSourceNodeId: 'source-node',
    });
    const layerContract = contract(2, 'layer-stack');
    layerContract.resultKind = 'layer-stack';
    layerContract.outputs.forEach((item, index) => {
      item.descriptor.semantic = { kind: 'layer', resultKind: 'image', label: `图层 ${index + 1}` };
      item.descriptor.layer = { index, opacity: 1, blendMode: 'normal' };
    });
    const completionId = 'layer-publication-completion';
    const committed = await commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.layerStackResult,
      contract: layerContract,
      completionId,
      preparedLayerStack: layerStackDocument(completionId),
      createLayerStackDocument: vi.fn(async () => layerStackProjection()),
    });

    publishCanvasSuccessfulExecution({
      sourceNodeId: 'source-node',
      inputSignature: 'layer-stack-input-v1',
      outputMode: 'result-nodes',
      resultNodeIds: committed.resultNodeIds,
    });
    const canvas = useCanvasStore.getState();
    const targetNodeId = canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 840, y: 0 });
    canvas.addEdge('source-node', targetNodeId);

    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'source-node')?.data.latestExecution)
      .toMatchObject({
        outputRefs: [{
          resultNodeId: 'placeholder-node',
          completionId,
          outputId: 'layer-stack-composite',
          order: 0,
        }],
      });
    const latest = useCanvasStore.getState();
    expect(collectInputMedia(targetNodeId, latest.nodes, latest.edges).map((output) => output.url))
      .toEqual(['/managed/composite.png']);
  });

  it('重复 completion 直接复用同一节点且不会创建第二份 V3 文档', async () => {
    setupCanvas('image', CANVAS_NODE_TYPES.layerStackResult);
    const layerContract = contract(2, 'layer-stack');
    layerContract.resultKind = 'layer-stack';
    layerContract.outputs.forEach((item, index) => {
      item.descriptor.semantic = { kind: 'layer', resultKind: 'image', label: `图层 ${index + 1}` };
      item.descriptor.layer = { index, opacity: 1, blendMode: 'normal' };
    });
    const completionId = 'layer-idempotent-completion';
    const createLayerStackDocument = vi.fn(async () => layerStackProjection());
    const input = {
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.layerStackResult,
      contract: layerContract,
      completionId,
      preparedLayerStack: layerStackDocument(completionId),
      createLayerStackDocument,
    };

    const first = await commitCanvasGenerationOutputs(input);
    const second = await commitCanvasGenerationOutputs(input);

    expect(first.idempotent).toBe(false);
    expect(second).toMatchObject({ idempotent: true, resultNodeIds: ['placeholder-node'] });
    expect(createLayerStackDocument).toHaveBeenCalledOnce();
    expect(useCanvasStore.getState().nodes.filter((node) => (
      node.data.generationOutputCommitId === completionId
    ))).toHaveLength(1);
  });

  it('V3 保存失败时不提交完成态，节点删除或取消后按精确 projection 补偿', async () => {
    setupCanvas('image', CANVAS_NODE_TYPES.layerStackResult);
    const layerContract = contract(2, 'layer-stack');
    layerContract.resultKind = 'layer-stack';
    layerContract.outputs.forEach((item, index) => {
      item.descriptor.semantic = { kind: 'layer', resultKind: 'image', label: `图层 ${index + 1}` };
      item.descriptor.layer = { index, opacity: 1, blendMode: 'normal' };
    });
    const completionId = 'layer-failure-completion';
    const base = {
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.layerStackResult,
      contract: layerContract,
      completionId,
      preparedLayerStack: layerStackDocument(completionId),
    };
    const rollbackAfterSaveFailure = vi.fn(async () => true);
    await expect(commitCanvasGenerationOutputs({
      ...base,
      createLayerStackDocument: vi.fn(async () => { throw new Error('V3 初始保存失败'); }),
      rollbackLayerStackDocument: rollbackAfterSaveFailure,
    })).rejects.toThrow('V3 初始保存失败');
    expect(rollbackAfterSaveFailure).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data)
      .toMatchObject({ imageUrl: null });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data)
      .not.toHaveProperty('generationOutputCommitId');

    const projection = layerStackProjection();
    const rollbackDeleted = vi.fn(async () => true);
    await expect(commitCanvasGenerationOutputs({
      ...base,
      createLayerStackDocument: vi.fn(async () => {
        useCanvasStore.getState().deleteNode('placeholder-node');
        return projection;
      }),
      rollbackLayerStackDocument: rollbackDeleted,
    })).rejects.toThrow(/占位节点已被删除/);
    expect(rollbackDeleted).toHaveBeenCalledWith(projection);
    expect(useCanvasStore.getState().nodes.some((node) => (
      node.data.generationOutputCommitId === completionId
    ))).toBe(false);

    setupCanvas('image', CANVAS_NODE_TYPES.layerStackResult);
    const controller = new AbortController();
    const rollbackCancelled = vi.fn(async () => false);
    await expect(commitCanvasGenerationOutputs({
      ...base,
      signal: controller.signal,
      createLayerStackDocument: vi.fn(async () => {
        controller.abort();
        return projection;
      }),
      rollbackLayerStackDocument: rollbackCancelled,
    })).rejects.toThrow(/已取消/);
    expect(rollbackCancelled).toHaveBeenCalledWith(projection);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data)
      .toMatchObject({ imageUrl: null });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'placeholder-node')?.data)
      .not.toHaveProperty('imageEditSession');
  });
});
