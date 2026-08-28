// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registry } from '@/core/ModelRegistry';
import type { ModelDefinition } from '@/core/types';
import { collectAndRewriteMedia, rewritePackagePathsToLocal } from '@/services/projectPackage/collectMediaRefs';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import {
  CANVAS_NODE_TYPES,
  isAssetGroupNode,
  type CanvasNode,
} from '../domain/canvasNodes';
import {
  createDefaultGenerationOutputItems,
  type CanvasGenerationOutputBatchContractV1,
} from '../domain/generationOutputs';
import type { RowMediaKind } from '../domain/socketTypes';
import { bindAssetGroupGraph } from './assetGroupGraph';
import { createAssetGroupRenderGraph } from './assetGroupRenderGraph';
import { canvasNodeFactory } from './canvasServices';
import {
  commitCanvasGenerationOutputs,
  validateGenerationOutputBatchContract,
} from './generationOutputApplicationService';

const projectId = 'generation-output-project';
const MODEL_ID = 'generation-output-image-model';
const multiImageModel: ModelDefinition = {
  meta: {
    id: MODEL_ID,
    canonicalModelId: 'z-image-turbo',
    provider: 'test',
    type: 'image',
    name: { zh: '多结果测试', en: 'Multi output test' },
    tags: ['image-to-image'],
  },
  inputLimits: { images: { max: 12 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0, description: 'test' },
};

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

function setupCanvas(resultKind: 'image' | 'panorama' = 'image'): {
  source: CanvasNode;
  placeholder: CanvasNode;
} {
  const source = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, {
    displayName: '生成节点',
  });
  source.id = 'source-node';
  const placeholder = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.exportImage, { x: 420, y: 0 }, {
    displayName: '生成结果',
    resultKind,
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

describe('generationOutputApplicationService', () => {
  beforeEach(() => {
    registry.clear();
    registry.register(multiImageModel);
    setupCanvas();
  });

  it('零输出明确拒绝且不执行媒体落盘', async () => {
    const persistOutput = vi.fn();
    await expect(commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: { version: 1, strategy: 'single', resultKind: 'image', outputs: [] },
      persistOutput,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(persistOutput).not.toHaveBeenCalled();
  });

  it('单图与全景沿用占位节点并只增加一条历史', async () => {
    setupCanvas('panorama');
    const value = contract(1);
    value.resultKind = 'panorama';
    value.outputs[0].descriptor.semantic = { kind: 'panorama', resultKind: 'panorama' };
    const result = await commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: value,
      completionId: 'panorama-completion',
      persistOutput: async (_mediaType, source) => imagePatch(source, '2:1'),
      validateResultPatch: (patch) => {
        if (patch.aspectRatio !== '2:1') throw new Error('全景比例无效');
      },
    });

    expect(result).toMatchObject({ resultNodeIds: ['placeholder-node'], groupNodeId: null });
    expect(useCanvasStore.getState().nodes).toHaveLength(2);
    expect(useCanvasStore.getState().nodes[1].data).toMatchObject({
      resultKind: 'panorama',
      imageUrl: '/managed/result-1.png',
      isGenerating: false,
      generationOutputCommitId: 'panorama-completion',
    });
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    expect(useCanvasStore.getState().selectedNodeId).toBe('placeholder-node');
  });

  it.each([2, 9])('按描述符顺序原子创建 %i 个成员与一个结果组', async (count) => {
    const value = contract(count);
    value.outputs.reverse();
    const result = await commit(value, `completion-${count}`);
    const canvas = useCanvasStore.getState();
    const group = canvas.nodes.find((node) => node.id === result.groupNodeId);
    expect(group && isAssetGroupNode(group)).toBe(true);
    if (!group || !isAssetGroupNode(group)) return;

    expect(group.data.memberOrder).toHaveLength(count);
    expect(group.data.generationOutputDescriptors?.map((item) => item.order))
      .toEqual(Array.from({ length: count }, (_, index) => index));
    expect(group.data.memberOrder.map((memberId) => (
      canvas.nodes.find((node) => node.id === memberId)?.data.generationOutputDescriptor?.sourceOutputIndex
    ))).toEqual(Array.from({ length: count }, (_, index) => index));
    expect(canvas.history.past).toHaveLength(1);
    expect(canvas.selectedNodeId).toBe(group.id);
    expect(canvas.nodes.filter((node) => node.parentId === group.id).every((node) => node.hidden)).toBe(true);
  });

  it('任一输出落盘失败时不创建成员或空组', async () => {
    const before = structuredClone(useCanvasStore.getState().nodes);
    await expect(commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: contract(2),
      persistOutput: async (_mediaType, source) => {
        if (source.endsWith('2')) throw new Error('第二项下载失败');
        return imagePatch(source);
      },
    })).rejects.toThrow('第二项下载失败');

    expect(useCanvasStore.getState().nodes).toEqual(before);
    expect(useCanvasStore.getState().history.past).toHaveLength(0);
    expect(useCanvasStore.getState().nodes.some((node) => node.type === CANVAS_NODE_TYPES.assetGroup)).toBe(false);
  });

  it('媒体落盘期间项目被关闭时拒绝提交且不留下画布半成品', async () => {
    const before = structuredClone(useCanvasStore.getState().nodes);
    await expect(commitCanvasGenerationOutputs({
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: contract(2),
      persistOutput: async (_mediaType, source) => {
        useProjectStore.setState({ currentProjectId: null, currentProject: null });
        return imagePatch(source);
      },
    })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });

    expect(useCanvasStore.getState().nodes).toEqual(before);
    expect(useCanvasStore.getState().history.past).toHaveLength(0);
    expect(useCanvasStore.getState().nodes.some((node) => node.type === CANVAS_NODE_TYPES.assetGroup)).toBe(false);
  });

  it('相同完成键重复回调不再落盘或追加历史', async () => {
    const persistOutput = vi.fn(async (_mediaType: RowMediaKind, source: string) => imagePatch(source));
    const input = {
      sourceNodeId: 'source-node',
      placeholderNodeId: 'placeholder-node',
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: contract(2),
      completionId: 'dedupe-completion',
      persistOutput,
    } as const;
    const first = await commitCanvasGenerationOutputs(input);
    const second = await commitCanvasGenerationOutputs(input);

    expect(second).toMatchObject({
      idempotent: true,
      resultNodeIds: first.resultNodeIds,
      groupNodeId: first.groupNodeId,
    });
    expect(persistOutput).toHaveBeenCalledTimes(2);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
  });

  it('一次撤销和重做完整恢复结果组、成员与顺序', async () => {
    const result = await commit(contract(2));
    const completedNodes = structuredClone(useCanvasStore.getState().nodes);

    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().nodes.some((node) => node.id === result.groupNodeId)).toBe(false);
    expect(useCanvasStore.getState().nodes).toHaveLength(2);
    expect(useCanvasStore.getState().redo()).toBe(true);
    expect(useCanvasStore.getState().nodes).toEqual(completedNodes);
  });

  it('结果组折叠投影可展开读取成员，并可建立下游素材组绑定', async () => {
    const result = await commit(contract(2));
    const canvas = useCanvasStore.getState();
    const target = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 900, y: 0 }, {
      modelId: MODEL_ID,
    });
    const withTarget = [...canvas.nodes, target];
    const bound = bindAssetGroupGraph(withTarget, canvas.edges, String(result.groupNodeId), target.id, 'binding-1');
    expect(bound).not.toBeNull();
    if (!bound) return;
    const rendered = createAssetGroupRenderGraph(bound.nodes, bound.edges);
    expect(bound.nodes.filter((node) => node.parentId === result.groupNodeId)).toHaveLength(2);
    expect(rendered.nodes.filter((node) => node.parentId === result.groupNodeId).every((node) => node.hidden)).toBe(true);
    expect(rendered.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: result.groupNodeId, target: target.id, type: 'assetGroupBundleEdge' }),
    ]));
  });

  it('保存重开及项目导入导出保留成员顺序、描述符和媒体引用', async () => {
    const result = await commit(contract(2));
    const saved = structuredClone(useCanvasStore.getState().nodes);
    const savedEdges = structuredClone(useCanvasStore.getState().edges);
    useCanvasStore.getState().setCanvasData(saved, savedEdges, useCanvasStore.getState().history);
    const reopenedGroup = useCanvasStore.getState().nodes.find((node) => node.id === result.groupNodeId);
    expect(reopenedGroup && isAssetGroupNode(reopenedGroup)
      ? reopenedGroup.data.generationOutputDescriptors?.map((item) => item.order)
      : []).toEqual([0, 1]);

    const collected = collectAndRewriteMedia(useCanvasStore.getState().nodes);
    expect(collected.mediaFiles).toHaveLength(4);
    const pathMap = Object.fromEntries(collected.mediaFiles.map((item) => [
      item.packagePath,
      `/restored/${item.packagePath.split('/').at(-1)}`,
    ]));
    const restored = rewritePackagePathsToLocal(collected.nodes, pathMap);
    const restoredGroup = restored.find((node) => node.id === result.groupNodeId);
    expect(restoredGroup && isAssetGroupNode(restoredGroup)
      ? restoredGroup.data.memberOrder
      : []).toEqual(result.resultNodeIds);
    expect(restored.filter((node) => result.resultNodeIds.includes(node.id)).every((node) => (
      typeof node.data.imageUrl === 'string' && node.data.imageUrl.startsWith('/restored/')
    ))).toBe(true);
  });

  it('independent 策略保留有序独立节点，不创建素材组', async () => {
    const result = await commit(contract(2, 'independent'));
    expect(result.groupNodeId).toBeNull();
    expect(result.resultNodeIds).toHaveLength(2);
    expect(useCanvasStore.getState().nodes.some((node) => node.type === CANVAS_NODE_TYPES.assetGroup)).toBe(false);
    expect(useCanvasStore.getState().selectedNodeId).toBe(result.resultNodeIds[1]);
  });

  it('非图片输出保留真实媒体语义，不伪装成图片组', () => {
    const videoContract: CanvasGenerationOutputBatchContractV1 = {
      version: 1,
      strategy: 'assetGroup',
      resultKind: 'media-group',
      expectedOutputCount: 2,
      outputs: createDefaultGenerationOutputItems({
        sources: ['/remote/video-1', '/remote/video-2'],
        mediaType: 'video',
      }),
    };

    expect(validateGenerationOutputBatchContract(videoContract).map((item) => (
      item.descriptor.semantic.resultKind
    ))).toEqual(['video', 'video']);
  });

  it('多角度 profile 与 angle 可按顺序持久化，图层栈仅开放静态契约', async () => {
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
      resultNodeType: CANVAS_NODE_TYPES.exportImage,
      contract: layerContract,
      persistOutput: vi.fn(),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_STRATEGY' });
  });
});
