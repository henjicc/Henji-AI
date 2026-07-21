import { beforeEach, describe, expect, it } from 'vitest';

import { resolveMinEdgeFittedSize } from '@/features/canvas/application/imageNodeSizing';
import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type VideoMediaNodeData,
} from '@/features/canvas/domain/canvasNodes';

import { useCanvasStore } from './canvasStore';

describe('视频结果节点尺寸自适应', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([], []);
  });

  it('使用 1:1 创建视频生成占位节点', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.exportVideo,
      { x: 0, y: 0 }
    );
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);

    expect((node?.data as VideoMediaNodeData | undefined)?.aspectRatio).toBe(DEFAULT_ASPECT_RATIO);
  });

  it('视频结果写回后按实际比例更新节点尺寸', () => {
    const nodeId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.exportVideo,
      { x: 0, y: 0 }
    );
    const aspectRatio = '9:16';
    const expectedSize = resolveMinEdgeFittedSize(aspectRatio, {
      minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
      minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
    });

    useCanvasStore.getState().updateNodeData(nodeId, {
      videoUrl: 'C:/generated/video.mp4',
      aspectRatio,
    });

    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    expect(node?.width).toBe(expectedSize.width);
    expect(node?.height).toBe(expectedSize.height);
    expect(node?.style).toMatchObject(expectedSize);
  });
});
