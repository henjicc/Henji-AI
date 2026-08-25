/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { AssetGroupMediaViewers } from './AssetGroupMediaViewers';

vi.mock('@/features/canvas/application/imageData', () => ({
  resolveImageDisplayUrl: (source: string) => `display:${source}`,
}));

vi.mock('@/components/mediaViewer/ImageViewerModal', () => ({
  ImageViewerModal: ({ open, imageUrl, onNavigate }: {
    open: boolean;
    imageUrl: string;
    onNavigate: (direction: 'prev' | 'next') => void;
  }) => open ? (
    <div data-testid="image-viewer">
      {imageUrl}
      <div data-testid="navigate-next" onClick={() => onNavigate('next')}>next</div>
    </div>
  ) : null,
}));

vi.mock('@/components/mediaViewer/VideoViewerModal', () => ({
  VideoViewerModal: ({ open, videoUrl }: { open: boolean; videoUrl: string }) => (
    open ? <div data-testid="video-viewer">{videoUrl}</div> : null
  ),
}));

vi.mock('@/components/mediaViewer/AudioViewerModal', () => ({
  AudioViewerModal: ({ open, audioUrl }: { open: boolean; audioUrl: string }) => (
    open ? <div data-testid="audio-viewer">{audioUrl}</div> : null
  ),
}));

function node(id: string, type: CanvasNode['type'], data: CanvasNode['data']): CanvasNode {
  return { id, type, data, position: { x: 0, y: 0 } } as CanvasNode;
}

const members = [
  node('image-1', CANVAS_NODE_TYPES.upload, { imageUrl: '/one.png', aspectRatio: '1:1' }),
  node('image-2', CANVAS_NODE_TYPES.upload, { imageUrl: '/two.png', aspectRatio: '1:1' }),
  node('video-1', CANVAS_NODE_TYPES.videoUpload, { videoUrl: '/clip.mp4' }),
  node('audio-1', CANVAS_NODE_TYPES.audioUpload, { audioUrl: '/voice.wav' }),
];

describe('AssetGroupMediaViewers', () => {
  afterEach(cleanup);

  it('使用三类统一查看器，并支持图片间导航', () => {
    const onSelectMember = vi.fn();
    const rendered = render(
      <AssetGroupMediaViewers
        members={members}
        selectedMemberId="image-1"
        onSelectMember={onSelectMember}
        onClose={vi.fn()}
      />,
    );
    expect(rendered.getByTestId('image-viewer').textContent).toContain('display:/one.png');
    fireEvent.click(rendered.getByTestId('navigate-next'));
    expect(onSelectMember).toHaveBeenCalledWith('image-2');

    rendered.rerender(
      <AssetGroupMediaViewers
        members={members}
        selectedMemberId="video-1"
        onSelectMember={onSelectMember}
        onClose={vi.fn()}
      />,
    );
    expect(rendered.getByTestId('video-viewer').textContent).toBe('display:/clip.mp4');

    rendered.rerender(
      <AssetGroupMediaViewers
        members={members}
        selectedMemberId="audio-1"
        onSelectMember={onSelectMember}
        onClose={vi.fn()}
      />,
    );
    expect(rendered.getByTestId('audio-viewer').textContent).toBe('display:/voice.wav');
  });
});
