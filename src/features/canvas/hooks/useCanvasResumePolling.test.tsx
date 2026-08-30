// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import {
  clearActiveCanvasGenerationTasksForTest,
  markCanvasGenerationTaskActive,
  releaseCanvasGenerationTaskActive,
} from '../generation/activeGenerationTasks';
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

describe('useCanvasResumePolling 异步结果恢复', () => {
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

  it('不接管当前页面仍由原始生成链路轮询的任务', async () => {
    markCanvasGenerationTaskActive('panorama-task');
    renderHook(() => useCanvasResumePolling());

    await act(async () => Promise.resolve());
    expect(generationMocks.resumeCanvasGeneration).not.toHaveBeenCalled();

    releaseCanvasGenerationTaskActive('panorama-task');
  });

  it('组件卸载重挂时沿用全局租约，不重复续查同一项目任务', async () => {
    let resolveResume: ((value: { primary: string }) => void) | undefined;
    generationMocks.resumeCanvasGeneration.mockImplementation(() => new Promise((resolve) => {
      resolveResume = resolve;
    }));
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-after-remount.png',
      previewImageUrl: 'managed-after-remount-preview.png',
      aspectRatio: '2:1',
    });

    const firstMount = renderHook(() => useCanvasResumePolling());
    await waitFor(() => expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(1));
    firstMount.unmount();

    renderHook(() => useCanvasResumePolling());
    await act(async () => Promise.resolve());
    expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(1);

    await act(async () => resolveResume?.({ primary: 'remote-after-remount' }));
    await waitFor(() => expect(useCanvasStore.getState().nodes[0]?.data).toMatchObject({
      imageUrl: 'managed-after-remount.png',
      serverTaskId: null,
      serverTaskModelId: null,
    }));
    expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(1);
  });

  it('续查成功后保留全景来源语义并清理运行态', async () => {
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: 'remote-result',
      createdFilePaths: ['/data/Media/resumed-result.png'],
    });
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-panorama.png',
      previewImageUrl: 'managed-panorama-preview.png',
      aspectRatio: '2:1',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const data = useCanvasStore.getState().nodes[0]?.data;
      expect(data).toMatchObject({
        imageUrl: 'managed-panorama.png',
        resultKind: 'panorama',
        sourceCapabilityId: 'image.panorama',
        sourceCapabilityTemplateVersion: 'panorama-equirectangular-text-v1',
        generationUserPrompt: '雪山脚下的湖泊',
        isGenerating: false,
        generationStartedAt: null,
        generationError: null,
        serverTaskId: null,
        serverTaskModelId: null,
      });
    });
    await waitFor(() => expect(platformMocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/data/Media/resumed-result.png',
    ]));
  });

  it('续查未新建受管媒体时不调用释放', async () => {
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-panorama.png',
      previewImageUrl: 'managed-panorama-preview.png',
      aspectRatio: '2:1',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => expect(useCanvasStore.getState().nodes[0]?.data).toMatchObject({
      imageUrl: 'managed-panorama.png',
      isGenerating: false,
    }));
    expect(platformMocks.releaseManagedGenerationMedia).not.toHaveBeenCalled();
  });

  it('续查成功后把结果引用重新发布到来源配方节点', async () => {
    const source: CanvasNode = {
      id: 'panorama-generator',
      type: CANVAS_NODE_TYPES.panoramaGen,
      position: { x: -300, y: 0 },
      data: { displayName: '全景生成', prompt: '雪山', params: {} },
    };
    const result = createResumablePanoramaResult();
    result.data = {
      ...result.data,
      generationSourceNodeId: source.id,
      generationInputSignature: 'canvas-input-v2-resume',
    };
    useCanvasStore.getState().setCanvasData(
      [source, result],
      [{ id: 'source-to-result', source: source.id, target: result.id }],
      { past: [], future: [] },
    );
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-panorama.png',
      previewImageUrl: 'managed-panorama-preview.png',
      aspectRatio: '2:1',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const latestExecution = useCanvasStore.getState().nodes
        .find((node) => node.id === source.id)?.data.latestExecution;
      expect(latestExecution).toMatchObject({
        inputSignature: 'canvas-input-v2-resume',
        outputMode: 'result-nodes',
        outputRefs: [{ resultNodeId: result.id }],
      });
    });
  });

  it('来源输入已变化时保留恢复结果但不覆盖较新的发布', async () => {
    const newerExecution = {
      version: 1,
      inputSignature: 'canvas-input-v2-newer',
      outputMode: 'result-nodes',
      outputRefs: [{ resultNodeId: 'newer-result', order: 0 }],
    };
    const source: CanvasNode = {
      id: 'panorama-generator',
      type: CANVAS_NODE_TYPES.panoramaGen,
      position: { x: -300, y: 0 },
      data: {
        displayName: '全景生成',
        prompt: '用户后来改成的海边',
        params: {},
        latestExecution: newerExecution,
      },
    };
    const result = createResumablePanoramaResult();
    result.data = {
      ...result.data,
      generationSourceNodeId: source.id,
      generationInputSignature: 'canvas-input-v2-resume',
    };
    useCanvasStore.getState().setCanvasData(
      [source, result],
      [{ id: 'source-to-result', source: source.id, target: result.id }],
      { past: [], future: [] },
    );
    executionMocks.isCanvasNodeInputSignatureCurrent.mockResolvedValue(false);
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: 'managed-old-panorama.png',
      previewImageUrl: 'managed-old-panorama-preview.png',
      aspectRatio: '2:1',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => {
      const canvas = useCanvasStore.getState();
      expect(canvas.nodes.find((node) => node.id === result.id)?.data).toMatchObject({
        imageUrl: 'managed-old-panorama.png',
        isGenerating: false,
        serverTaskId: null,
      });
      expect(canvas.nodes.find((node) => node.id === source.id)?.data.latestExecution)
        .toEqual(newerExecution);
    });
    expect(executionMocks.isCanvasNodeInputSignatureCurrent).toHaveBeenCalledWith(
      source.id,
      'canvas-input-v2-resume',
    );
  });
});
