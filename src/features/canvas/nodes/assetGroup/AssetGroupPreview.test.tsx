// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CANVAS_NODE_TYPES,
  type AssetGroupNodeData,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

import { AssetGroupPreview } from './AssetGroupPreview';
import { resolveAssetGroupPreviewItems } from './assetGroupPreviewModel';

vi.mock('@/features/canvas/application/imageData', () => ({
  resolveImageDisplayUrl: (source: string) => `display:${source}`,
}));

function member(
  id: string,
  type: CanvasNode['type'],
  data: CanvasNode['data'],
): CanvasNode {
  return { id, type, data, position: { x: 0, y: 0 } } as CanvasNode;
}

const groupData: AssetGroupNodeData = {
  displayName: '素材组',
  memberOrder: ['image-a', 'video-a', 'audio-a', 'image-b'],
  coverMemberId: 'video-a',
  bindings: [],
};

describe('素材组拼接缩略图', () => {
  it('指定封面排在首位，并按成员顺序收集图片与视频静态封面', () => {
    const members = [
      member('image-a', CANVAS_NODE_TYPES.upload, {
        imageUrl: '/media/original-a.png', previewImageUrl: '/media/preview-a.png', aspectRatio: '1:1',
      }),
      member('video-a', CANVAS_NODE_TYPES.videoUpload, {
        videoUrl: '/media/video-a.mp4', previewImageUrl: '/media/video-a.jpg', aspectRatio: '16:9',
      }),
      member('audio-a', CANVAS_NODE_TYPES.audioUpload, {
        audioUrl: '/media/audio-a.mp3', durationSec: 10,
      }),
      member('image-b', CANVAS_NODE_TYPES.exportImage, {
        imageUrl: '/media/image-b.png', previewImageUrl: null, aspectRatio: '1:1',
      }),
    ];

    expect(resolveAssetGroupPreviewItems(members, groupData)).toEqual([
      { id: 'video-a', kind: 'video', source: '/media/video-a.jpg' },
      { id: 'image-a', kind: 'image', source: '/media/preview-a.png' },
      { id: 'image-b', kind: 'image', source: '/media/image-b.png' },
    ]);
  });

  it('显示前统一转换本地路径，加载失败后回退为媒体图标', () => {
    const { container } = render(<AssetGroupPreview items={[
      { id: 'image-a', kind: 'image', source: '/media/preview-a.png' },
      { id: 'video-a', kind: 'video', source: null },
    ]} />);

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('display:/media/preview-a.png');
    expect(container.querySelector('[data-asset-group-preview-count="2"]')).not.toBeNull();

    if (!image) throw new Error('图片缩略图未渲染');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('最多渲染四格，并在最后一格标记其余数量', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `image-${index}`,
      kind: 'image' as const,
      source: `/media/${index}.png`,
    }));
    const { container, getByText } = render(<AssetGroupPreview items={items} />);

    expect(container.querySelectorAll('[data-asset-group-preview-member]')).toHaveLength(4);
    expect(getByText('+2')).toBeTruthy();
  });
});
