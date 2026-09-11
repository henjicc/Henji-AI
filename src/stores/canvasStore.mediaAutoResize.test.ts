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

describe('统一上传节点尺寸路径', () => {
  beforeEach(() => useCanvasStore.getState().clearCanvas());

  it('图片工具派生的上传节点使用同一默认面积', () => {
    const sourceId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.upload, { x: 0, y: 0 }, { aspectRatio: '16:9' });
    const id = useCanvasStore.getState().addDerivedUploadNode(sourceId, 'C:/media/derived.png', '16:9');
    expect(useCanvasStore.getState().nodes.find(node => node.id === id)).toMatchObject({
      width: 427, height: 240, style: { width: 427, height: 240 },
    });
  });

  it.each([CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.videoUpload])('%s 直接创建、空节点上传、统一入口一致', type => {
    const data = { aspectRatio: '16:9', ...(type === CANVAS_NODE_TYPES.upload
      ? { imageUrl: 'C:/media/image.png' } : { videoUrl: 'C:/media/video.mp4' }) };
    const directId = useCanvasStore.getState().addNode(type, { x: 0, y: 0 }, data);
    const emptyId = useCanvasStore.getState().addNode(type, { x: 500, y: 0 });
    useCanvasStore.getState().updateNodeData(emptyId, data);
    const universalId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.universalUpload, { x: 1000, y: 0 });
    useCanvasStore.getState().resolveUploadPlaceholder(universalId, { type, data });
    for (const id of [directId, emptyId, universalId]) {
      expect(useCanvasStore.getState().nodes.find(node => node.id === id)).toMatchObject({
        width: 427, height: 240, style: { width: 427, height: 240 },
      });
    }
  });

  it.each([CANVAS_NODE_TYPES.upload, CANVAS_NODE_TYPES.videoUpload])('%s 横竖替换保留面积、同一比例保留手动盒子', type => {
    const id = useCanvasStore.getState().addNode(type, { x: 0, y: 0 }, {
      aspectRatio: '16:9', ...(type === CANVAS_NODE_TYPES.upload
        ? { imageUrl: 'C:/media/image.png' } : { videoUrl: 'C:/media/video.mp4' }),
    });
    const current = () => useCanvasStore.getState().nodes.find(node => node.id === id)!;
    useCanvasStore.getState().onNodesChange([
      { id, type: 'dimensions', dimensions: { width: 800, height: 450 }, resizing: true, setAttributes: true },
      { id, type: 'dimensions', resizing: false },
    ]);
    // 上传的比例先到，地址后到；未刷新测量不应让第二个补丁取回旧尺寸。
    useCanvasStore.getState().updateNodeData(id, { aspectRatio: '9:16' });
    useCanvasStore.getState().updateNodeData(id, { aspectRatio: '9:16', previewImageUrl: 'C:/media/new.jpg' });
    expect(current()).toMatchObject({ width: 450, height: 800, data: { isSizeManuallyAdjusted: true } });
    for (let i = 0; i < 6; i++) {
      useCanvasStore.getState().updateNodeData(id, { aspectRatio: i % 2 ? '9:16' : '16:9' });
      expect(current().width! * current().height!).toBe(360000);
    }
    const saved = current();
    useCanvasStore.getState().setCanvasData([saved], []);
    expect(current()).toMatchObject({ width: 450, height: 800 });
  });

  it('音频采用横向面积基准，第一次缩放可撤销且重开后保留尺寸', () => {
    const id = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.audioUpload, { x: 0, y: 0 });
    const current = () => useCanvasStore.getState().nodes[0];
    expect(current()).toMatchObject({ width: 453, height: 226 });
    useCanvasStore.getState().onNodesChange([
      { id, type: 'dimensions', dimensions: { width: 600, height: 300 }, resizing: true, setAttributes: true },
      { id, type: 'dimensions', resizing: false },
    ]);
    expect(current()).toMatchObject({ width: 600, height: 300, data: { isSizeManuallyAdjusted: true } });
    useCanvasStore.getState().updateNodeData(id, { audioUrl: 'C:/media/audio.wav' });
    expect(current()).toMatchObject({ width: 600, height: 300 });
    useCanvasStore.getState().undo();
    useCanvasStore.getState().undo();
    expect(current()).toMatchObject({ width: 453, height: 226 });
    useCanvasStore.getState().redo();
    const saved = current();
    useCanvasStore.getState().setCanvasData([saved], []);
    expect(current()).toMatchObject({ width: 600, height: 300 });
  });
});
