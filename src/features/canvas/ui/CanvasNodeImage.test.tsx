/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCanvasStore } from '@/stores/canvasStore';

import { CanvasNodeImage } from './CanvasNodeImage';

describe('CanvasNodeImage 查看路由', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] });
  });

  afterEach(() => cleanup());

  it('全景结果双击时保留查看模式与来源节点', () => {
    const rendered = render(
      <CanvasNodeImage
        src="preview.png"
        alt="preview"
        viewerSourceUrl="panorama.png"
        viewerImageList={['panorama.png', 'other.png']}
        viewerMode="panorama"
        viewerSourceNodeId="result-panorama"
      />,
    );

    fireEvent.doubleClick(rendered.getByAltText('preview'));

    expect(useCanvasStore.getState().imageViewer).toMatchObject({
      isOpen: true,
      currentImageUrl: 'panorama.png',
      imageList: ['panorama.png', 'other.png'],
      mode: 'panorama',
      sourceNodeId: 'result-panorama',
    });
  });

  it('普通图片和旧调用继续进入平面查看', () => {
    const rendered = render(
      <CanvasNodeImage src="plain.png" alt="plain" viewerSourceUrl="plain-original.png" />,
    );

    fireEvent.doubleClick(rendered.getByAltText('plain'));

    expect(useCanvasStore.getState().imageViewer).toMatchObject({
      currentImageUrl: 'plain-original.png',
      mode: 'image',
      sourceNodeId: null,
    });
  });
});
