// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CANVAS_NODE_TYPES, isAssetGroupNode } from '../domain/canvasNodes';
import { canvasNodeFactory } from './canvasServices';

const mocks = vi.hoisted(() => ({
  importCanvasMediaFile: vi.fn(),
}));

vi.mock('./mediaImport', () => ({
  importCanvasMediaFile: mocks.importCanvasMediaFile,
}));

import { addAssetToAssetGroup, importFilesToAssetGroup } from './assetGroupApplicationService';

const projectId = 'asset-group-import-project';

function emptyProject(): Project {
  return {
    id: projectId,
    name: '素材组导入测试',
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

describe('assetGroupApplicationService media import', () => {
  beforeEach(() => {
    mocks.importCanvasMediaFile.mockReset();
    const group = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.assetGroup, { x: 100, y: 80 }, {
      displayName: '素材组 1', memberOrder: [], coverMemberId: null, bindings: [],
    });
    group.id = 'group-1';
    useCanvasStore.getState().setCanvasData([group], [], { past: [], future: [] });
    useSettingsStore.setState({ useUploadFilenameAsNodeTitle: true });
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

  it('导入多种本地媒体后以一次素材组事务加入并继承文件名', async () => {
    mocks.importCanvasMediaFile
      .mockResolvedValueOnce({
        kind: 'image',
        type: CANVAS_NODE_TYPES.upload,
        data: { imageUrl: '/one.png', previewImageUrl: '/one-preview.png', aspectRatio: '1:1' },
      })
      .mockResolvedValueOnce({
        kind: 'video',
        type: CANVAS_NODE_TYPES.videoUpload,
        data: { videoUrl: '/two.mp4', previewImageUrl: '/two-preview.jpg' },
      });
    const files = [
      new File([], 'one.png', { type: 'image/png' }),
      new File([], 'two.mp4', { type: 'video/mp4' }),
    ];

    const result = await importFilesToAssetGroup({ groupId: 'group-1', files });

    expect(result).toMatchObject({ added: 2, skipped: 0, failed: 0 });
    const nodes = useCanvasStore.getState().nodes;
    const group = nodes.find((node) => node.id === 'group-1');
    expect(group && isAssetGroupNode(group) ? group.data.memberOrder : []).toHaveLength(2);
    expect(nodes.filter((node) => node.parentId === 'group-1')).toEqual([
      expect.objectContaining({ hidden: true, data: expect.objectContaining({ displayName: 'one.png' }) }),
      expect.objectContaining({ hidden: true, data: expect.objectContaining({ displayName: 'two.mp4' }) }),
    ]);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
  });

  it('资产拖入时直接使用可信本地路径创建对应媒体节点', () => {
    const asset: AssetDragPayload = {
      assetId: 'asset-1',
      sourceType: 'asset',
      type: 'audio',
      filePath: '/voice.wav',
      imageUrl: '',
      displayName: '旁白',
    };

    addAssetToAssetGroup({ groupId: 'group-1', asset });

    const member = useCanvasStore.getState().nodes.find((node) => node.parentId === 'group-1');
    expect(member).toMatchObject({
      type: CANVAS_NODE_TYPES.audioUpload,
      hidden: true,
      data: expect.objectContaining({ audioUrl: '/voice.wav', sourceFileName: '旁白' }),
    });
  });
});
