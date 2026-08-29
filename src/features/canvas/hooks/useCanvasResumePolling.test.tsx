// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { useCanvasResumePolling } from './useCanvasResumePolling';

const generationMocks = vi.hoisted(() => ({
  resumeCanvasGeneration: vi.fn(),
  persistGenerationResult: vi.fn(),
  commitLayerSeparationGeneration: vi.fn(),
}));

vi.mock('../generation/runGeneration', () => ({
  resumeCanvasGeneration: generationMocks.resumeCanvasGeneration,
}));

vi.mock('../generation/mediaResultPersist', () => ({
  persistGenerationResult: generationMocks.persistGenerationResult,
}));

vi.mock('../application/layerSeparationGenerationService', () => ({
  commitLayerSeparationGeneration: generationMocks.commitLayerSeparationGeneration,
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

describe('useCanvasResumePolling 全景结果恢复', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    generationMocks.resumeCanvasGeneration.mockReset();
    generationMocks.persistGenerationResult.mockReset();
    generationMocks.commitLayerSeparationGeneration.mockReset();
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
  });

  it('续查成功后保留全景来源语义并清理运行态', async () => {
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
  });

  it('续查结果不是精确2:1时记为失败而不写入媒体', async () => {
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
  });

  it('图层栈续查按结构化协议进入专用原子提交而不降级成素材组', async () => {
    const source: CanvasNode = {
      id: 'source-image',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: -300, y: 0 },
      data: { displayName: '源图', imageUrl: '/managed/source.png', previewImageUrl: '/managed/source-preview.png', aspectRatio: '1:1' },
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
      generationProviderId: 'volcengine',
      generationInputImages: ['/managed/source.png'],
    };
    useCanvasStore.getState().setCanvasData([source, result], [{ id: 'source-to-layer', source: source.id, target: result.id }], { past: [], future: [] });
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
    generationMocks.commitLayerSeparationGeneration.mockResolvedValue({ resultNodeIds: [result.id] });

    renderHook(() => useCanvasResumePolling());

    await waitFor(() => expect(generationMocks.commitLayerSeparationGeneration).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: source.id,
      placeholderNodeId: result.id,
      sourceImage: '/managed/source.png',
      providerId: 'volcengine',
    })));
    expect(generationMocks.persistGenerationResult).not.toHaveBeenCalled();
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
