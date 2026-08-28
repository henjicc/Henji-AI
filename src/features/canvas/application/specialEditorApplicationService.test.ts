// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { DEFAULT_RELIGHT_SETTINGS } from '@/features/canvas/capabilities/relightPolicy';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useCanvasSpecialEditorController } from './specialEditorController';
import {
  commitCanvasSpecialEditor,
  openCanvasSpecialEditor,
} from './specialEditorApplicationService';

const projectId = 'special-editor-project';

function emptyProject(): Project {
  return {
    id: projectId,
    name: '专用编辑器测试',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    coverPath: null,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  };
}

describe('specialEditorApplicationService', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] });
    useCanvasSpecialEditorController.setState({ session: null });
    const project = emptyProject();
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    });
  });

  it('通过画布应用服务提交草稿并关闭会话', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.imageEdit,
      { x: 0, y: 0 },
      { prompt: '初始提示词' }
    );
    const sessionId = openCanvasSpecialEditor({
      projectId,
      nodeId,
      editorKey: 'relight',
      initialState: { prompt: '初始提示词' },
    });
    useCanvasSpecialEditorController.getState().updateDraft({ prompt: '已确认的提示词' });

    commitCanvasSpecialEditor(sessionId);

    expect(useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.data.prompt)
      .toBe('已确认的提示词');
    expect(useCanvasSpecialEditorController.getState().session).toBeNull();
    expect(useProjectStore.getState().saveCurrentProject).toHaveBeenCalled();
  });

  it('打光编辑器仅通过内部白名单原子写回契约数据', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.relightGen,
      { x: 0, y: 0 },
      { relightSettings: DEFAULT_RELIGHT_SETTINGS },
    );
    const initialState = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.data;
    if (!initialState) throw new Error('打光节点创建失败');
    const sessionId = openCanvasSpecialEditor({
      projectId,
      nodeId,
      editorKey: 'relight',
      initialState,
    });
    useCanvasSpecialEditorController.getState().updateDraft({
      ...initialState,
      relightSettings: {
        ...DEFAULT_RELIGHT_SETTINGS,
        lightingMode: 'smart',
        smart: { ...DEFAULT_RELIGHT_SETTINGS.smart, preset: 'neon' },
      },
      modelId: 'fal-ai-gpt-image-2',
      params: {},
      prompt: '智能打光',
      promptTemplateVersion: 'relight-smart-gpt-image-2-v1',
      lightingReferenceImages: [],
      relightRouteReasons: [],
    });

    commitCanvasSpecialEditor(sessionId);

    const data = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.data;
    expect(data).toMatchObject({
      modelId: 'fal-ai-gpt-image-2',
      promptTemplateVersion: 'relight-smart-gpt-image-2-v1',
      relightSettings: { lightingMode: 'smart', smart: { preset: 'neon' } },
    });
    expect(useCanvasSpecialEditorController.getState().session).toBeNull();
  });
});
