// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { clearActiveCanvasGenerationTasksForTest } from '../generation/activeGenerationTasks';
import { useCanvasResumePolling } from './useCanvasResumePolling';

const generationMocks = vi.hoisted(() => ({
  resumeCanvasGeneration: vi.fn(),
  persistGenerationResult: vi.fn(),
  composeLocalRedraw: vi.fn(),
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

vi.mock('../generation/mediaResultPersist', () => ({
  persistGenerationResult: generationMocks.persistGenerationResult,
}));

vi.mock('../application/canvasExecutionService', async () => ({
  ...await vi.importActual<typeof import('../application/canvasExecutionService')>(
    '../application/canvasExecutionService',
  ),
  isCanvasNodeInputSignatureCurrent: executionMocks.isCanvasNodeInputSignatureCurrent,
}));

vi.mock('@/commands/image', async () => ({
  ...await vi.importActual<typeof import('@/commands/image')>('@/commands/image'),
  composeLocalRedraw: generationMocks.composeLocalRedraw,
}));

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    image: {
      releaseManagedGenerationMedia: platformMocks.releaseManagedGenerationMedia,
    },
  }),
}));

function setResumeProject(context: DynamicValue): { source: CanvasNode; result: CanvasNode } {
  const source: CanvasNode = {
    id: 'local-redraw-generator',
    type: CANVAS_NODE_TYPES.elementEditGen,
    position: { x: -300, y: 0 },
    data: { displayName: '局部重绘', prompt: '移除路牌', params: {} },
  };
  const result: CanvasNode = {
    id: 'local-redraw-result',
    type: CANVAS_NODE_TYPES.exportImage,
    position: { x: 0, y: 0 },
    data: {
      displayName: '局部重绘结果',
      imageUrl: null,
      previewImageUrl: null,
      resultKind: 'image',
      sourceCapabilityId: 'image.element-edit',
      generationSourceNodeId: source.id,
      generationInputSignature: 'local-redraw-input-v2',
      generationLocalRedrawContext: context,
      isGenerating: true,
      generationStartedAt: 100,
      serverTaskId: 'local-redraw-task',
      serverTaskModelId: 'apimart-gpt-image-2',
    },
  };
  const nodes = [source, result];
  const edges = [{ id: 'local-redraw-to-result', source: source.id, target: result.id }];
  const project: Project = {
    id: 'local-redraw-resume-project',
    name: '局部重绘恢复测试',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: nodes.length,
    coverPath: null,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  };
  useCanvasStore.getState().setCanvasData(nodes, edges, project.history);
  useProjectStore.setState({
    projects: [project],
    currentProjectId: project.id,
    currentProject: project,
    isHydrated: true,
    isOpeningProject: false,
    saveCurrentProject: vi.fn(),
  });
  return { source, result };
}

describe('useCanvasResumePolling 局部重绘恢复', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    generationMocks.resumeCanvasGeneration.mockReset();
    generationMocks.persistGenerationResult.mockReset();
    generationMocks.composeLocalRedraw.mockReset();
    executionMocks.isCanvasNodeInputSignatureCurrent.mockReset();
    executionMocks.isCanvasNodeInputSignatureCurrent.mockResolvedValue(true);
    platformMocks.releaseManagedGenerationMedia.mockReset();
    platformMocks.releaseManagedGenerationMedia.mockResolvedValue(undefined);
    clearActiveCanvasGenerationTasksForTest();
    useCanvasGenerationProgressStore.getState().clearAllProgress();
  });

  it('恢复裁剪上下文、合成完整图片并重新发布来源结果', async () => {
    const context = {
      version: 2 as const,
      requestId: 'local-redraw-resume-request',
      source: '/managed/local-redraw-source.png',
      mask: '/managed/local-redraw-mask.png',
      sourceWidth: 1920,
      sourceHeight: 1080,
      crop: { x: 240, y: 120, width: 960, height: 720 },
      matchedAspectRatio: 4 / 3,
      settings: {
        contextScale: 2,
        aspectRatio: '4:3' as const,
        registrationQuality: 'precise' as const,
        featherPixels: 12,
        forceRegistration: false,
      },
    };
    const { source, result } = setResumeProject(context);
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: '/remote/generated-crop.png',
      outputs: ['/remote/generated-crop.png'],
      createdFilePaths: ['/data/Media/generated-crop.png'],
    });
    generationMocks.composeLocalRedraw.mockResolvedValue({
      source: '/managed/local-redraw-composite.png',
      registrationApplied: true,
      diagnostics: {},
    });
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: '/managed/local-redraw-composite.png',
      previewImageUrl: '/managed/local-redraw-composite-preview.webp',
      aspectRatio: '16:9',
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => expect(
      useCanvasStore.getState().nodes.find((node) => node.id === result.id)?.data,
    ).toMatchObject({
      imageUrl: '/managed/local-redraw-composite.png',
      generationOutputCommitId: `generation-output:${result.id}`,
      isGenerating: false,
      serverTaskId: null,
      serverTaskModelId: null,
    }));
    expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledWith(expect.objectContaining({
      requestId: context.requestId,
      taskId: 'local-redraw-task',
    }));
    expect(generationMocks.composeLocalRedraw).toHaveBeenCalledWith({
      generatedSource: '/remote/generated-crop.png',
      context,
    });
    expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data.latestExecution)
      .toMatchObject({
        inputSignature: 'local-redraw-input-v2',
        outputRefs: [{ resultNodeId: result.id }],
      });
    await waitFor(() => expect(platformMocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/data/Media/generated-crop.png',
    ]));
  });

  it('缺少有效裁剪上下文时保留占位节点并进入可见失败态', async () => {
    const { result } = setResumeProject({
      version: 1,
      source: '/managed/source.png',
      mask: '/managed/mask.png',
    });
    generationMocks.resumeCanvasGeneration.mockResolvedValue({
      primary: '/remote/generated-crop.png',
      outputs: ['/remote/generated-crop.png'],
    });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => expect(
      useCanvasStore.getState().nodes.find((node) => node.id === result.id)?.data,
    ).toMatchObject({
      imageUrl: null,
      isGenerating: false,
      generationStartedAt: null,
      generationError: '局部重绘恢复缺少裁剪上下文',
      serverTaskId: null,
      serverTaskModelId: null,
    }));
    expect(generationMocks.composeLocalRedraw).not.toHaveBeenCalled();
    expect(generationMocks.persistGenerationResult).not.toHaveBeenCalled();
  });
});
