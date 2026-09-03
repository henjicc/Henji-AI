// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { createLayerStackCompositeOutputDescriptor } from '../domain/generationOutputs';
import {
  createStoryboardGenerationResumeContext,
  STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD,
} from '../application/storyboardGenerationOutputService';
import {
  clearActiveCanvasGenerationTasksForTest,
} from '../generation/activeGenerationTasks';
import { collectInputMedia } from '../application/graphMediaResolver';
import { useCanvasResumePolling } from './useCanvasResumePolling';

const generationMocks = vi.hoisted(() => ({
  resumeCanvasGeneration: vi.fn(),
  persistGenerationResult: vi.fn(),
  commitLayerSeparationGeneration: vi.fn(),
  prepareNodeImage: vi.fn(),
  embedStoryboardImageMetadata: vi.fn(),
}));

const executionMocks = vi.hoisted(() => ({
  isCanvasNodeInputSignatureCurrent: vi.fn(),
}));

const platformMocks = vi.hoisted(() => ({
  releaseManagedGenerationMedia: vi.fn(),
}));

vi.mock('../generation/runGeneration', () => ({
  resumeCanvasGeneration: generationMocks.resumeCanvasGeneration,
}));

vi.mock('../application/canvasExecutionService', async () => ({
  ...await vi.importActual<typeof import('../application/canvasExecutionService')>(
    '../application/canvasExecutionService',
  ),
  isCanvasNodeInputSignatureCurrent: executionMocks.isCanvasNodeInputSignatureCurrent,
}));

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    image: {
      releaseManagedGenerationMedia: platformMocks.releaseManagedGenerationMedia,
    },
  }),
}));

vi.mock('../generation/mediaResultPersist', () => ({
  persistGenerationResult: generationMocks.persistGenerationResult,
}));

vi.mock('../application/layerSeparationGenerationService', () => ({
  commitLayerSeparationGeneration: generationMocks.commitLayerSeparationGeneration,
}));

vi.mock('../application/imageData', async () => ({
  ...await vi.importActual<typeof import('../application/imageData')>('../application/imageData'),
  prepareNodeImage: generationMocks.prepareNodeImage,
}));

vi.mock('@/commands/image', async () => ({
  ...await vi.importActual<typeof import('@/commands/image')>('@/commands/image'),
  embedStoryboardImageMetadata: generationMocks.embedStoryboardImageMetadata,
}));

function createResumablePanoramaResult(): CanvasNode {
  return {
    id: 'panorama-result',
    type: CANVAS_NODE_TYPES.panoramaViewer,
    position: { x: 0, y: 0 },
    data: {
      displayName: '720°全景',
      imageUrl: null,
      previewImageUrl: null,
      resultKind: 'panorama',
      sourceCapabilityId: 'image.panorama',
      sourceCapabilityTemplateVersion: 'panorama-equirectangular-text-v1',
      generationUserPrompt: '雪山脚下的湖泊',
      isGenerating: true,
      generationStartedAt: 100,
      serverTaskId: 'panorama-task',
      serverTaskModelId: 'apimart-gpt-image-2',
    },
  };
}

function createResumableStoryboardGraph(input: {
  rows: number;
  cols: number;
  frameNotes: string[];
  taskId: string;
}): { nodes: CanvasNode[]; edges: Project['edges'] } {
  const frames = Array.from({ length: input.rows * input.cols }, (_, index) => ({
    id: `frame-${index + 1}`,
    description: input.frameNotes[index] ?? '',
    referenceIndex: null,
  }));
  const source: CanvasNode = {
    id: 'storyboard-generator',
    type: CANVAS_NODE_TYPES.storyboardGen,
    position: { x: -300, y: 0 },
    data: {
      displayName: '产品分镜',
      gridRows: input.rows,
      gridCols: input.cols,
      frames,
      imageUrl: null,
      aspectRatio: '1:1',
    },
  };
  const result: CanvasNode = {
    id: 'storyboard-result',
    type: CANVAS_NODE_TYPES.exportImage,
    position: { x: 0, y: 0 },
    data: {
      displayName: '分镜输出',
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: '1:1',
      resultKind: 'storyboardGenOutput',
      generationSourceNodeId: source.id,
      generationInputSignature: 'storyboard-input-v1',
      [STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD]: createStoryboardGenerationResumeContext({
        gridRows: input.rows,
        gridCols: input.cols,
        frames,
        frameDescriptionDrafts: Object.fromEntries(
          frames.map((frame) => [frame.id, frame.description]),
        ),
        ignoreAtTagWhenCopyingAndGenerating: false,
      }),
      isGenerating: true,
      generationStartedAt: 100,
      serverTaskId: input.taskId,
      serverTaskModelId: 'apimart-gpt-image-2',
    },
  };
  return {
    nodes: [source, result],
    edges: [{ id: 'storyboard-to-result', source: source.id, target: result.id }],
  };
}

function setResumeProject(nodes: CanvasNode[], edges: Project['edges']): void {
  useCanvasStore.getState().setCanvasData(nodes, edges, { past: [], future: [] });
  const current = useProjectStore.getState().currentProject;
  if (!current) throw new Error('恢复测试项目不存在');
  const project: Project = {
    ...current,
    nodes,
    edges,
    nodeCount: nodes.length,
    history: { past: [], future: [] },
  };
  useProjectStore.setState({
    projects: [project],
    currentProjectId: project.id,
    currentProject: project,
  });
}

describe('useCanvasResumePolling 结构化结果恢复', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    generationMocks.resumeCanvasGeneration.mockReset();
    generationMocks.persistGenerationResult.mockReset();
    generationMocks.commitLayerSeparationGeneration.mockReset();
    generationMocks.prepareNodeImage.mockReset();
    generationMocks.embedStoryboardImageMetadata.mockReset();
    executionMocks.isCanvasNodeInputSignatureCurrent.mockReset();
    executionMocks.isCanvasNodeInputSignatureCurrent.mockResolvedValue(true);
    platformMocks.releaseManagedGenerationMedia.mockReset();
    platformMocks.releaseManagedGenerationMedia.mockResolvedValue(undefined);
    clearActiveCanvasGenerationTasksForTest();
    useCanvasGenerationProgressStore.getState().clearAllProgress();
    const nodes = [createResumablePanoramaResult()];
    useCanvasStore.getState().setCanvasData(
      nodes,
      [],
      { past: [], future: [] },
    );
    const project: Project = {
      id: 'resume-project',
      name: '恢复测试',
      createdAt: 1,
      updatedAt: 1,
      nodeCount: 1,
      coverPath: null,
      nodes,
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      history: { past: [], future: [] },
    };
    useProjectStore.setState({
      projects: [project],
      currentProjectId: project.id,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    });
    generationMocks.resumeCanvasGeneration.mockResolvedValue({ primary: 'remote-result' });
    generationMocks.prepareNodeImage.mockResolvedValue({
      imageUrl: '/managed/storyboard-source.png',
      previewImageUrl: '/managed/storyboard-source-preview.png',
      aspectRatio: '1:1',
    });
    generationMocks.embedStoryboardImageMetadata.mockResolvedValue('/managed/storyboard-metadata.png');
  });

  it('分镜单图续查复用专用后处理，嵌入网格元数据并发布专用契约', async () => {
    const graph = createResumableStoryboardGraph({
      rows: 2,
      cols: 2,
      frameNotes: ['远景', '中景', '近景', '特写'],
      taskId: 'storyboard-single-task',
    });
    setResumeProject(graph.nodes, graph.edges);
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: '/remote/storyboard-grid.png',
      outputs: ['/remote/storyboard-grid.png'],
    });
    generationMocks.persistGenerationResult.mockImplementation(async (_mediaType: string, source: string) => ({
      imageUrl: source,
      previewImageUrl: `${source}.preview.png`,
      aspectRatio: '1:1',
    }));

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const result = useCanvasStore.getState().nodes.find((node) => node.id === 'storyboard-result');
      expect(result?.data).toMatchObject({
        imageUrl: '/managed/storyboard-metadata.png',
        generationOutputCommitId: 'storyboard-grid:storyboard-result',
        generationOutputDescriptor: {
          semantic: { kind: 'grid-composite', resultKind: 'image' },
          metadata: { gridRows: 2, gridCols: 2, cellCount: 4 },
        },
        serverTaskId: null,
        serverTaskModelId: null,
      });
    });
    expect(generationMocks.prepareNodeImage).toHaveBeenCalledWith('/remote/storyboard-grid.png');
    expect(generationMocks.embedStoryboardImageMetadata).toHaveBeenCalledWith(
      '/managed/storyboard-source.png',
      { gridRows: 2, gridCols: 2, frameNotes: ['远景', '中景', '近景', '特写'] },
    );
    expect(useCanvasStore.getState().nodes.find((node) => node.id === 'storyboard-generator')?.data.latestExecution)
      .toMatchObject({
        inputSignature: 'storyboard-input-v1',
        outputRefs: [{ resultNodeId: 'storyboard-result' }],
      });
  });

  it('分镜多图续查恢复 grid-cell 行列与备注契约并创建结果组', async () => {
    const frameNotes = ['左上', '右上', '左下', '右下'];
    const graph = createResumableStoryboardGraph({
      rows: 2,
      cols: 2,
      frameNotes,
      taskId: 'storyboard-multi-task',
    });
    setResumeProject(graph.nodes, graph.edges);
    const outputs = Array.from({ length: 4 }, (_, index) => `/remote/cell-${index + 1}.png`);
    generationMocks.resumeCanvasGeneration.mockResolvedValue({ primary: outputs[0], outputs });
    generationMocks.persistGenerationResult.mockImplementation(async (_mediaType: string, source: string) => ({
      imageUrl: `/managed${source}`,
      previewImageUrl: `/managed${source}.preview.png`,
      aspectRatio: '1:1',
    }));

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const members = useCanvasStore.getState().nodes
        .filter((node) => node.data.generationOutputCommitId === 'storyboard-grid:storyboard-result'
          && node.type === CANVAS_NODE_TYPES.exportImage)
        .sort((left, right) => (
          (left.data.generationOutputDescriptor?.order ?? 0)
          - (right.data.generationOutputDescriptor?.order ?? 0)
        ));
      expect(members).toHaveLength(4);
      expect(members.map((member) => member.data.generationOutputDescriptor)).toEqual(
        frameNotes.map((note, index) => expect.objectContaining({
          order: index,
          sourceOutputIndex: index,
          semantic: expect.objectContaining({ kind: 'grid-cell', resultKind: 'image' }),
          metadata: expect.objectContaining({
            gridRows: 2,
            gridCols: 2,
            row: Math.floor(index / 2),
            column: index % 2,
            note,
          }),
        })),
      );
      const group = useCanvasStore.getState().nodes.find((node) => (
        node.type === CANVAS_NODE_TYPES.assetGroup
        && node.data.generationOutputCommitId === 'storyboard-grid:storyboard-result'
      ));
      expect(group?.data).toMatchObject({
        resultKind: 'image-group',
        generationOutputStrategy: 'assetGroup',
      });
      expect(group?.data.generationOutputDescriptors).toHaveLength(4);
    });
    expect(generationMocks.prepareNodeImage).not.toHaveBeenCalled();
    expect(generationMocks.embedStoryboardImageMetadata).not.toHaveBeenCalled();
  });

  it('续查结果不是精确2:1时记为失败而不写入媒体', async () => {
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: 'remote-result',
      createdFilePaths: ['/data/Media/invalid-panorama.png'],
    });
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-invalid.png',
      previewImageUrl: 'managed-invalid-preview.png',
      aspectRatio: '16:9',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const data = useCanvasStore.getState().nodes[0]?.data;
      expect(data).toMatchObject({
        imageUrl: null,
        resultKind: 'panorama',
        isGenerating: false,
        generationStartedAt: null,
        serverTaskId: null,
        serverTaskModelId: null,
      });
      expect(data?.generationError).toContain('2:1');
    });
    await waitFor(() => expect(platformMocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/data/Media/invalid-panorama.png',
    ]));
  });

  it('图层栈续查按结构化协议进入专用原子提交而不降级成素材组', async () => {
    const source: CanvasNode = {
      id: 'layer-generator',
      type: CANVAS_NODE_TYPES.layerSeparationGen,
      position: { x: -300, y: 0 },
      data: { displayName: '图层拆分', prompt: '', modelId: 'volcengine-seedream-5.0-pro' },
    };
    const result = createResumablePanoramaResult();
    result.id = 'layer-result';
    result.data = {
      ...result.data,
      resultKind: 'layer-stack',
      sourceCapabilityId: 'image.layer-separation',
      serverTaskId: 'layer-task',
      serverTaskModelId: 'volcengine-seedream-5.0-pro',
      generationSourceNodeId: source.id,
      generationInputSignature: 'layer-stack-resumed-input-v1',
      generationProviderId: 'volcengine',
      generationInputImages: ['/managed/source.png'],
    };
    const downstream: CanvasNode = {
      id: 'downstream-image',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 400, y: 0 },
      data: { displayName: '下游', prompt: '' },
    };
    useCanvasStore.getState().setCanvasData([source, result, downstream], [
      { id: 'source-to-layer', source: source.id, target: result.id },
      { id: 'source-to-downstream', source: source.id, target: downstream.id, targetHandle: 'param:__image' },
    ], { past: [], future: [] });
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: '/managed/base.jpg',
      outputs: ['/managed/base.jpg'],
      structuredOutput: {
        version: 1,
        kind: 'layer-stack',
        primary: { version: 1, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/managed/base.jpg', zIndex: 0, role: 'base', width: 8, height: 8, format: 'jpeg' },
        outputs: [{ version: 1, sourceOutputIndex: 0, url: 'https://fixtures.invalid/base.jpg', filePath: '/managed/base.jpg', zIndex: 0, role: 'base', width: 8, height: 8, format: 'jpeg' }],
        metadata: { colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', order: 'bottom-to-top' },
      },
    });
    generationMocks.commitLayerSeparationGeneration.mockImplementation(async (input: {
      sourceNodeId: string;
      placeholderNodeId: string;
      completionId: string;
    }) => {
      useCanvasStore.getState().updateNodeData(input.placeholderNodeId, {
        imageUrl: '/managed/composite.png',
        previewImageUrl: '/managed/composite-preview.webp',
        aspectRatio: '1:1',
        imageEditSession: {
          kind: 'image-edit-v3',
          sourceUrl: '/managed/composite.png',
          documentRef: 'image-edit-v3:resumed-layer-stack',
          revision: 0,
          previewRef: null,
        },
        resultKind: 'layer-stack',
        isGenerating: false,
        generationStartedAt: null,
        serverTaskId: null,
        serverTaskModelId: null,
        generationSourceNodeId: input.sourceNodeId,
        generationOutputCommitId: input.completionId,
        generationOutputDescriptor: createLayerStackCompositeOutputDescriptor(),
      });
      return { resultNodeIds: [input.placeholderNodeId] };
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => expect(generationMocks.commitLayerSeparationGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: source.id,
      placeholderNodeId: result.id,
      sourceImage: '/managed/source.png',
      providerId: 'volcengine',
    })));
    expect(generationMocks.persistGenerationResult).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().nodes.find((node) => node.id === result.id)?.data)
      .toMatchObject({
        imageUrl: '/managed/composite.png',
        imageEditSession: {
          documentRef: 'image-edit-v3:resumed-layer-stack',
          revision: 0,
        },
      });
    await waitFor(() => expect(
      useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data.latestExecution,
    ).toMatchObject({
      inputSignature: 'layer-stack-resumed-input-v1',
      outputRefs: [{
        resultNodeId: result.id,
        completionId: `generation-output:${result.id}`,
        outputId: 'layer-stack-composite',
        order: 0,
      }],
    }));
    const latest = useCanvasStore.getState();
    expect(collectInputMedia(downstream.id, latest.nodes, latest.edges).map((output) => output.url))
      .toEqual(['/managed/composite.png']);
  });

  it('A 项目续查时切到 B 再返回 A 会重新恢复，旧回调不污染新会话', async () => {
    generationMocks.resumeCanvasGeneration.mockImplementation(() => new Promise(() => undefined));
    renderHook(() => useCanvasResumePolling());
    await waitFor(() => expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(1));
    const projectA = useProjectStore.getState().currentProject as Project;

    const projectB: Project = {
      id: 'project-b', name: 'B', createdAt: 1, updatedAt: 1, nodeCount: 0, coverPath: null,
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, history: { past: [], future: [] },
    };
    await act(async () => {
      useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] });
      useProjectStore.setState({ currentProjectId: projectB.id, currentProject: projectB });
    });
    await act(async () => {
      useCanvasStore.getState().setCanvasData(projectA.nodes, projectA.edges, projectA.history);
      useProjectStore.setState({ currentProjectId: projectA.id, currentProject: projectA });
    });

    await waitFor(() => expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(2));
    expect(useCanvasStore.getState().nodes[0]?.data.serverTaskId).toBe('panorama-task');
  });
});
