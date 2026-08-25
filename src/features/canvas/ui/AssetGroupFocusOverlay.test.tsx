/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload';
import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { AssetGroupFocusOverlay } from './AssetGroupFocusOverlay';

const mocks = vi.hoisted(() => ({
  addAssetToAssetGroup: vi.fn(),
  importFilesToAssetGroup: vi.fn(),
  readAssetDragPayload: vi.fn<[DataTransfer], AssetDragPayload | null>(() => null),
  removeAssetGroupMember: vi.fn(),
  restoreAssetGroupBinding: vi.fn(),
  updateAssetGroup: vi.fn(),
  nodes: [] as CanvasNode[],
  edges: [] as CanvasEdge[],
}));

vi.mock('@/features/assets/drag/assetDragPayload', () => ({
  readAssetDragPayload: mocks.readAssetDragPayload,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/canvas/application/assetGroupApplicationService', () => ({
  addAssetToAssetGroup: mocks.addAssetToAssetGroup,
  importFilesToAssetGroup: mocks.importFilesToAssetGroup,
  removeAssetGroupMember: mocks.removeAssetGroupMember,
  restoreAssetGroupBinding: mocks.restoreAssetGroupBinding,
  updateAssetGroup: mocks.updateAssetGroup,
}));

vi.mock('@/features/canvas/ui/AssetGroupMediaViewers', () => ({
  AssetGroupMediaViewers: ({ selectedMemberId }: { selectedMemberId: string | null }) => (
    <div data-testid="viewer-selection">{selectedMemberId}</div>
  ),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    nodes: mocks.nodes,
    edges: mocks.edges,
  }),
}));

vi.mock('@/features/canvas/nodes/assetGroup/AssetGroupPreview', () => ({
  AssetGroupPreview: () => <div data-testid="member-preview" />,
}));

function canvasNode(id: string, type: CanvasNode['type'], data: CanvasNode['data']): CanvasNode {
  return { id, type, data, position: { x: 0, y: 0 } } as CanvasNode;
}

describe('AssetGroupFocusOverlay', () => {
  beforeEach(() => {
    mocks.removeAssetGroupMember.mockReset();
    mocks.addAssetToAssetGroup.mockReset();
    mocks.importFilesToAssetGroup.mockReset();
    mocks.readAssetDragPayload.mockReset();
    mocks.readAssetDragPayload.mockReturnValue(null);
    mocks.importFilesToAssetGroup.mockResolvedValue({
      projectId: 'project-1', groupId: 'group-1', added: 1, skipped: 0, failed: 0,
    });
    mocks.restoreAssetGroupBinding.mockReset();
    mocks.updateAssetGroup.mockReset();
    mocks.edges = [];
    mocks.nodes = [
      canvasNode('group-1', CANVAS_NODE_TYPES.assetGroup, {
        displayName: '角色素材',
        memberOrder: ['image-1', 'video-1', 'audio-1', 'image-2'],
        coverMemberId: 'image-1',
        bindings: [],
      }),
      { ...canvasNode('image-1', CANVAS_NODE_TYPES.upload, {
        displayName: '正面', imageUrl: '/image.png', previewImageUrl: '/image-preview.png', aspectRatio: '1:1',
      }), parentId: 'group-1' },
      { ...canvasNode('video-1', CANVAS_NODE_TYPES.videoUpload, {
        displayName: '动作', videoUrl: '/video.mp4', previewImageUrl: '/video-preview.jpg', durationSec: 2,
      }), parentId: 'group-1' },
      { ...canvasNode('audio-1', CANVAS_NODE_TYPES.audioUpload, {
        displayName: '声音', audioUrl: '/audio.mp3', durationSec: 2,
      }), parentId: 'group-1' },
      { ...canvasNode('image-2', CANVAS_NODE_TYPES.upload, {
        displayName: '侧面', imageUrl: '/image-2.png', previewImageUrl: '/image-2-preview.png', aspectRatio: '1:1',
      }), parentId: 'group-1' },
    ];
  });

  afterEach(cleanup);

  it('以不模糊的全画布工作面展示每个素材及其就地操作', () => {
    const onClose = vi.fn();
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={onClose} />);
    const workspace = rendered.getByRole('region', { name: 'canvas.assetGroup.manager.label' });

    expect(workspace.className).toContain('inset-0');
    expect(workspace.className).toContain('bg-app');
    expect(workspace.querySelector('.ui-glass-scrim')).toBeNull();
    expect(workspace.querySelectorAll('[data-asset-group-manager-member]')).toHaveLength(4);
    expect(rendered.getAllByTestId('member-preview')).toHaveLength(3);

    fireEvent.click(rendered.getByRole('button', { name: 'canvas.assetGroup.manager.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('按媒体类型独立编号与排序，并能设置封面', () => {
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={vi.fn()} />);
    const imageSection = rendered.container.querySelector('[data-asset-group-kind="image"]');
    if (!imageSection) throw new Error('image section missing');

    const imageCards = imageSection.querySelectorAll('[data-asset-group-manager-member]');
    expect(imageCards[0].getAttribute('data-asset-group-member-index')).toBe('1');
    expect(imageCards[1].getAttribute('data-asset-group-member-index')).toBe('2');
    fireEvent.click(within(imageSection as HTMLElement).getAllByRole('button', {
      name: 'canvas.assetGroup.manager.moveEarlier',
    })[1]);
    expect(mocks.updateAssetGroup).toHaveBeenCalledWith({
      groupId: 'group-1',
      memberOrder: ['image-2', 'video-1', 'audio-1', 'image-1'],
    });

    fireEvent.click(within(imageSection as HTMLElement).getAllByRole('button', {
      name: 'canvas.assetGroup.manager.setCover',
    })[1]);
    expect(mocks.updateAssetGroup).toHaveBeenCalledWith({ groupId: 'group-1', coverMemberId: 'image-2' });
  });

  it('移出前二次确认，并允许当前管理会话不再提示', () => {
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={vi.fn()} />);

    fireEvent.click(rendered.getAllByRole('button', { name: 'canvas.assetGroup.manager.remove' })[0]);
    expect(mocks.removeAssetGroupMember).not.toHaveBeenCalled();
    fireEvent.click(rendered.getByRole('checkbox', { name: 'canvas.assetGroup.manager.skipRemoveConfirmation' }));
    fireEvent.click(rendered.getByRole('button', { name: 'canvas.assetGroup.manager.removeConfirmAction' }));
    expect(mocks.removeAssetGroupMember).toHaveBeenCalledWith({ groupId: 'group-1', memberId: 'image-1' });

    fireEvent.click(rendered.getAllByRole('button', { name: 'canvas.assetGroup.manager.remove' })[1]);
    expect(mocks.removeAssetGroupMember).toHaveBeenLastCalledWith({ groupId: 'group-1', memberId: 'image-2' });
  });

  it('双击调用对应查看器，并可从按钮选择多个媒体文件加入', async () => {
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={vi.fn()} />);
    const firstCard = rendered.container.querySelector('[data-asset-group-manager-member="image-1"]');
    const preview = firstCard?.querySelector('.aspect-video');
    if (!preview) throw new Error('preview missing');
    fireEvent.doubleClick(preview);
    expect(rendered.getByTestId('viewer-selection').textContent).toBe('image-1');

    const input = rendered.container.querySelector('input[type="file"]');
    if (!input) throw new Error('file input missing');
    const files = [
      new File([], 'one.png', { type: 'image/png' }),
      new File([], 'two.mp4', { type: 'video/mp4' }),
    ];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(mocks.importFilesToAssetGroup).toHaveBeenCalledWith({
      groupId: 'group-1',
      files,
    }));
  });

  it('接收从资产库拖入的图片、视频或音频', () => {
    const asset: AssetDragPayload = {
      assetId: 'asset-1', sourceType: 'asset', type: 'video', filePath: '/asset.mp4', imageUrl: '',
    };
    mocks.readAssetDragPayload.mockReturnValue(asset);
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={vi.fn()} />);
    const workspace = rendered.getByRole('region', { name: 'canvas.assetGroup.manager.label' });

    fireEvent.drop(workspace, {
      dataTransfer: {
        types: ['application/x-henji-drag-data'],
        files: [],
        dropEffect: 'none',
      },
    });

    expect(mocks.addAssetToAssetGroup).toHaveBeenCalledWith({ groupId: 'group-1', asset });
  });
});
