// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels';

import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { flushCanvasProjectSnapshot, useProjectStore, type Project } from '@/stores/projectStore';

import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage';
import { getProjectRecord, upsertProjectRecord } from '@/commands/projectState';
import { fromProjectRecord, toProjectRecord } from '@/stores/projectStoreSerialization';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { clearActiveCanvasGenerationTasksForTest } from '../generation/activeGenerationTasks';
import { useCanvasResumePolling } from './useCanvasResumePolling';
import { getCanvasResumeControllers, resumeCanvasGenerationInProject } from '../application/canvasResumePollingService';
import { commitLocalRedrawGeneration } from '../application/localRedrawGenerationService';

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

vi.mock('@/platform', async () => {
  const actual = await vi.importActual<typeof import('@/platform')>('@/platform');
  return { ...actual, getPlatform: () => ({
    ...actual.getPlatform(),
    image: {
      ...actual.getPlatform().image,
      releaseManagedGenerationMedia: platformMocks.releaseManagedGenerationMedia,
    },
  }) };
});

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
      generationTaskId: 'local-redraw-record',
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
  });
  return { source, result };
}

describe('useCanvasResumePolling 局部重绘恢复', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry(); });
  afterEach(async () => {
    cleanup();
    const projectId = useProjectStore.getState().currentProjectId;
    if (projectId) await flushCanvasProjectSnapshot(projectId);
    uninstallHarnessNativeStorage();
  });

  beforeEach(() => {
    installHarnessNativeStorage();
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

  it.each(['foreground', 'background', 'start-background', 'direct-background', 'cancel'] as const)('恢复裁剪上下文并把合成或取消状态保存原项目（%s）', async mode => {
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
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    generationMocks.composeLocalRedraw.mockImplementation(async () => { await gate; return {
      source: '/managed/local-redraw-composite.png',
      registrationApplied: true,
      diagnostics: {},
    }; });
    generationMocks.persistGenerationResult.mockResolvedValue({
      imageUrl: '/managed/local-redraw-composite.png',
      previewImageUrl: '/managed/local-redraw-composite-preview.webp',
      aspectRatio: '16:9',
    });

    let otherProject: string | null = null;
    await upsertProjectRecord(toProjectRecord(useProjectStore.getState().currentProject!));
    if (mode === 'start-background') {
      otherProject = await useProjectStore.getState().createProject('后台开始局部重绘续查');
      expect(await resumeCanvasGenerationInProject('local-redraw-resume-project', new Set([result.id]))).toBe(1);
    }
    const direct = mode === 'direct-background' ? commitLocalRedrawGeneration({
      sourceNodeId: source.id, placeholderNodeId: result.id, resultNodeType: result.type,
      completionId: `generation-output:${result.id}`, context,
      result: { primary: '/remote/generated-crop.png', outputs: ['/remote/generated-crop.png'] },
    }) : null;
    const hook = mode === 'start-background' || direct ? null : renderHook(() => useCanvasResumePolling());
    try {
      await waitFor(() => expect(generationMocks.composeLocalRedraw).toHaveBeenCalledOnce());
      if (mode === 'background' || mode === 'cancel' || mode === 'direct-background') {
        hook?.unmount();
        otherProject = await useProjectStore.getState().createProject('合成中切换项目');
      }
      if (mode === 'cancel') getCanvasResumeControllers('local-redraw-record').forEach(controller => controller.abort(new Error('停止合成')));
    } finally { release(); }
    await direct;

    if (mode !== 'foreground') {
      await waitFor(async () => {
        const saved = await getProjectRecord('local-redraw-resume-project');
        const data = fromProjectRecord(saved!).nodes.find(node => node.id === result.id)?.data;
        expect(data).toMatchObject(mode === 'cancel' ? { generationCancelled: true, isGenerating: false, serverTaskId: 'local-redraw-task' }
          : { imageUrl: '/managed/local-redraw-composite.png', isGenerating: false, generationOutputCommitId: `generation-output:${result.id}` });
      });
      expect(useProjectStore.getState().currentProjectId).toBe(otherProject);
      expect(useCanvasStore.getState().nodes).toHaveLength(0);
      expect(generationMocks.resumeCanvasGeneration).toHaveBeenCalledTimes(direct ? 0 : 1);
      if (mode === 'cancel') expect(generationMocks.persistGenerationResult).not.toHaveBeenCalled();
      return;
    }

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
    await waitFor(() => expect(useCanvasStore.getState().nodes.find((node) => node.id === source.id)?.data.latestExecution)
      .toMatchObject({
        inputSignature: 'local-redraw-input-v2',
        outputRefs: [{ resultNodeId: result.id }],
      }));
    await waitFor(() => expect(platformMocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/data/Media/generated-crop.png',
    ]));
    const saved = await getProjectRecord('local-redraw-resume-project');
    expect(saved).not.toBeNull();
    expect(fromProjectRecord(saved!).nodes.find((node) => node.id === result.id)?.data)
      .toMatchObject({ imageUrl: '/managed/local-redraw-composite.png',
        generationSourceNodeId: source.id, generationOutputCommitId: `generation-output:${result.id}` });
    expect(useProjectStore.getState().persistenceError).toBeNull();
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
      serverTaskId: 'local-redraw-task',
      serverTaskModelId: 'apimart-gpt-image-2',
    }));
    expect(generationMocks.composeLocalRedraw).not.toHaveBeenCalled();
    expect(generationMocks.persistGenerationResult).not.toHaveBeenCalled();
  });
});
