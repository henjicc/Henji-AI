import { beforeEach, describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';

function exportImageNode(id: string, resultKind?: DynamicValue): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.exportImage,
    position: { x: 0, y: 0 },
    data: {
      displayName: '结果图片',
      imageUrl: '/tmp/image.png',
      previewImageUrl: null,
      aspectRatio: '2:1',
      ...(resultKind === undefined ? {} : { resultKind }),
    },
  } as CanvasNode;
}

describe('canvasStore imageViewer', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] });
  });

  it('保持旧 openImageViewer 调用并默认平面模式', () => {
    useCanvasStore.getState().openImageViewer(' image-a ', ['image-b', 'image-a', 'image-b']);

    expect(useCanvasStore.getState().imageViewer).toEqual({
      isOpen: true,
      currentImageUrl: 'image-a',
      imageList: ['image-b', 'image-a'],
      currentIndex: 1,
      mode: 'image',
      sourceNodeId: null,
    });
  });

  it('支持统一全景查看请求，未知模式降级为平面', () => {
    useCanvasStore.getState().openImageViewer({
      imageUrl: 'panorama-a',
      mode: 'panorama',
      sourceNodeId: 'result-a',
    });
    expect(useCanvasStore.getState().imageViewer).toMatchObject({
      mode: 'panorama',
      sourceNodeId: 'result-a',
    });

    useCanvasStore.getState().openImageViewer({
      imageUrl: 'image-a',
      mode: 'unknown-mode',
    } as never);
    expect(useCanvasStore.getState().imageViewer.mode).toBe('image');
  });

  it('项目切换与来源节点删除时关闭查看请求', () => {
    useCanvasStore.getState().setCanvasData([exportImageNode('result-a', 'panorama')], []);
    useCanvasStore.getState().openImageViewer({
      imageUrl: 'panorama-a',
      mode: 'panorama',
      sourceNodeId: 'result-a',
    });
    useCanvasStore.getState().deleteNode('result-a');
    expect(useCanvasStore.getState().imageViewer.isOpen).toBe(false);

    useCanvasStore.getState().openImageViewer({ imageUrl: 'plain-a', mode: 'image' });
    useCanvasStore.getState().setCanvasData([], []);
    expect(useCanvasStore.getState().imageViewer.isOpen).toBe(false);
  });

  it('导入节点时保留全景语义，损坏值降级为普通图片', () => {
    useCanvasStore.getState().setCanvasData([
      exportImageNode('panorama', 'panorama'),
      exportImageNode('invalid', 'not-a-result-kind'),
      exportImageNode('missing'),
    ], []);

    const resultKinds = useCanvasStore.getState().nodes.map((node) => node.data.resultKind);
    expect(resultKinds).toEqual(['panorama', 'image', 'image']);
  });
});
