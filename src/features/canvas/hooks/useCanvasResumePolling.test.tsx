// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes';
import { useCanvasResumePolling } from './useCanvasResumePolling';

const generationMocks = vi.hoisted(() => ({
  resumeCanvasGeneration: vi.fn(),
  persistGenerationResult: vi.fn(),
}));

vi.mock('../generation/runGeneration', () => ({
  resumeCanvasGeneration: generationMocks.resumeCanvasGeneration,
}));

vi.mock('../generation/mediaResultPersist', () => ({
  persistGenerationResult: generationMocks.persistGenerationResult,
}));

function createResumablePanoramaResult(): CanvasNode {
  return {
    id: 'panorama-result',
    type: CANVAS_NODE_TYPES.exportImage,
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
  beforeEach(() => {
    generationMocks.resumeCanvasGeneration.mockReset();
    generationMocks.persistGenerationResult.mockReset();
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
});
