/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasEdge, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { AssetGroupFocusOverlay } from './AssetGroupFocusOverlay';

const mocks = vi.hoisted(() => ({
  removeAssetGroupMember: vi.fn(),
  restoreAssetGroupBinding: vi.fn(),
  updateAssetGroup: vi.fn(),
  nodes: [] as CanvasNode[],
  edges: [] as CanvasEdge[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/canvas/application/assetGroupApplicationService', () => ({
  removeAssetGroupMember: mocks.removeAssetGroupMember,
  restoreAssetGroupBinding: mocks.restoreAssetGroupBinding,
  updateAssetGroup: mocks.updateAssetGroup,
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
    mocks.restoreAssetGroupBinding.mockReset();
    mocks.updateAssetGroup.mockReset();
    mocks.edges = [];
    mocks.nodes = [
      canvasNode('group-1', CANVAS_NODE_TYPES.assetGroup, {
        displayName: '角色素材',
        memberOrder: ['image-1', 'video-1', 'audio-1'],
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
    expect(workspace.querySelectorAll('[data-asset-group-manager-member]')).toHaveLength(3);
    expect(rendered.getAllByTestId('member-preview')).toHaveLength(2);

    fireEvent.click(rendered.getByRole('button', { name: 'canvas.assetGroup.manager.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('在素材卡片上完成排序、封面与移出操作', () => {
    const rendered = render(<AssetGroupFocusOverlay groupId="group-1" onClose={vi.fn()} />);

    fireEvent.click(rendered.getAllByRole('button', { name: 'canvas.assetGroup.manager.moveEarlier' })[1]);
    expect(mocks.updateAssetGroup).toHaveBeenCalledWith({
      groupId: 'group-1',
      memberOrder: ['video-1', 'image-1', 'audio-1'],
    });

    fireEvent.click(rendered.getAllByRole('button', { name: 'canvas.assetGroup.manager.setCover' })[1]);
    expect(mocks.updateAssetGroup).toHaveBeenCalledWith({ groupId: 'group-1', coverMemberId: 'video-1' });

    fireEvent.click(rendered.getAllByRole('button', { name: 'canvas.assetGroup.manager.remove' })[1]);
    expect(mocks.removeAssetGroupMember).toHaveBeenCalledWith({ groupId: 'group-1', memberId: 'video-1' });
  });
});
