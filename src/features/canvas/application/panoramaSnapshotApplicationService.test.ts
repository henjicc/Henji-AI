// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';

import { resetCanvasBatchStateForTests } from './canvasBatchService';
import { commitPanoramaViewSnapshot } from './panoramaSnapshotApplicationService';

const mocks = vi.hoisted(() => ({
  prepareNodeImage: vi.fn(),
  releaseManagedGenerationMedia: vi.fn(),
}));

vi.mock('./imageData', async (importOriginal) => ({
  ...await importOriginal<typeof import('./imageData')>(),
  prepareNodeImage: mocks.prepareNodeImage,
}));
vi.mock('@/platform', () => ({
  getPlatform: () => ({
    image: {
      releaseManagedGenerationMedia: mocks.releaseManagedGenerationMedia,
    },
  }),
}));

const sourceNodeId = 'panorama-source';
const projectId = 'panorama-snapshot-project';
const originalAddEdge = useCanvasStore.getState().addEdge;

function createSourceNode(): CanvasNode {
  return {
    id: sourceNodeId,
    type: CANVAS_NODE_TYPES.panoramaViewer,
    position: { x: 100, y: 100 },
    measured: { width: 480, height: 320 },
    data: {
      ...canvasNodeDefinitions[CANVAS_NODE_TYPES.panoramaViewer].createDefaultData(),
      imageUrl: '/managed/panorama.png',
      previewImageUrl: '/managed/panorama-preview.webp',
    },
  };
}

function createProject(sourceNode: CanvasNode): Project {
  return {
    id: projectId,
    name: '全景截图测试项目',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 1,
    coverPath: null,
    nodes: [sourceNode],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    history: { past: [], future: [] },
  };
}

describe('全景当前视角截图提交', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCanvasBatchStateForTests();
    useCanvasStore.setState({ addEdge: originalAddEdge });
    const sourceNode = createSourceNode();
    const project = createProject(sourceNode);
    useCanvasStore.getState().setCanvasData([sourceNode], [], {
      past: [],
      future: [],
    });
    useCanvasStore.setState({
      currentViewport: { x: 0, y: 0, zoom: 1 },
      canvasViewportSize: { width: 1_200, height: 800 },
      selectedNodeId: sourceNodeId,
    });
    useProjectStore.setState({
      projects: [project],
      currentProjectId: projectId,
      currentProject: project,
      isHydrated: true,
      isOpeningProject: false,
      saveCurrentProject: vi.fn(),
    });
    mocks.prepareNodeImage.mockResolvedValue({
      imageUrl: '/managed/panorama-snapshot.png',
      previewImageUrl: '/managed/panorama-snapshot-preview.webp',
      aspectRatio: '4:3',
      createdFilePaths: [
        '/managed/panorama-snapshot.png',
        '/managed/panorama-snapshot-preview.webp',
      ],
    });
    mocks.releaseManagedGenerationMedia.mockResolvedValue(undefined);
  });

  afterEach(() => {
    useCanvasStore.setState({ addEdge: originalAddEdge });
  });

  it('持久化后创建普通图片结果节点并连回全景源节点', async () => {
    const resultNodeId = await commitPanoramaViewSnapshot({
      sourceNodeId,
      dataUrl: 'data:image/png;base64,snapshot',
      title: '全景截图',
    });

    expect(mocks.prepareNodeImage).toHaveBeenCalledWith('data:image/png;base64,snapshot');
    const state = useCanvasStore.getState();
    const resultNode = state.nodes.find((node) => node.id === resultNodeId);
    expect(resultNode).toMatchObject({
      type: CANVAS_NODE_TYPES.exportImage,
      data: {
        displayName: '全景截图',
        resultKind: 'image',
        imageUrl: '/managed/panorama-snapshot.png',
        previewImageUrl: '/managed/panorama-snapshot-preview.webp',
        aspectRatio: '4:3',
      },
    });
    expect(state.edges).toEqual([
      expect.objectContaining({ source: sourceNodeId, target: resultNodeId }),
    ]);
    expect(state.history.past).toHaveLength(1);
    expect(mocks.releaseManagedGenerationMedia).not.toHaveBeenCalled();
  });

  it('派生节点连线失败时删除半成品并回滚已创建媒体', async () => {
    useCanvasStore.setState({ addEdge: vi.fn(() => null) });
    const beforeHistory = structuredClone(useCanvasStore.getState().history);

    await expect(commitPanoramaViewSnapshot({
      sourceNodeId,
      dataUrl: 'data:image/png;base64,snapshot',
      title: '全景截图',
    })).rejects.toThrow('无法连接全景视角截图节点');

    const state = useCanvasStore.getState();
    expect(state.nodes.map((node) => node.id)).toEqual([sourceNodeId]);
    expect(state.edges).toEqual([]);
    expect(state.history).toEqual(beforeHistory);
    expect(state.selectedNodeId).toBe(sourceNodeId);
    expect(mocks.releaseManagedGenerationMedia).toHaveBeenCalledOnce();
    expect(mocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/managed/panorama-snapshot.png',
      '/managed/panorama-snapshot-preview.webp',
    ]);
  });

  it('源节点在图片准备期间消失时不落空节点，并回滚已创建媒体', async () => {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] });

    await expect(commitPanoramaViewSnapshot({
      sourceNodeId,
      dataUrl: 'data:image/png;base64,snapshot',
      title: '全景截图',
    })).rejects.toThrow('全景查看节点已不存在');

    expect(useCanvasStore.getState().nodes).toEqual([]);
    expect(useCanvasStore.getState().edges).toEqual([]);
    expect(mocks.releaseManagedGenerationMedia).toHaveBeenCalledWith([
      '/managed/panorama-snapshot.png',
      '/managed/panorama-snapshot-preview.webp',
    ]);
  });
});
