import { beforeEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';
import { normalizeNodes } from './canvasStoreNormalization';

const TOOL_GENERATION_NODE_TYPES: readonly CanvasNodeType[] = [
  CANVAS_NODE_TYPES.panoramaGen,
  CANVAS_NODE_TYPES.relightGen,
  CANVAS_NODE_TYPES.multiAngleGen,
  CANVAS_NODE_TYPES.upscaleGen,
  CANVAS_NODE_TYPES.portraitTextureGen,
  CANVAS_NODE_TYPES.elementEditGen,
  CANVAS_NODE_TYPES.layerSeparationGen,
];

beforeEach(() => {
  useCanvasStore.getState().clearCanvas();
});

describe('画布工具节点尺寸跟踪', () => {
  it.each(TOOL_GENERATION_NODE_TYPES)('%s 缩放结束后锁定真实尺寸', (type) => {
    const node = canvasNodeFactory.createNode(type, { x: 40, y: 60 });
    useCanvasStore.getState().setCanvasData([node], []);

    useCanvasStore.getState().onNodesChange([
      {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: 920, height: 580 },
        resizing: true,
        setAttributes: true,
      },
      {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: 920, height: 580 },
        resizing: false,
      },
    ]);

    const resized = useCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id);
    expect(resized?.width).toBe(920);
    expect(resized?.height).toBe(580);
    expect(resized?.data.isSizeManuallyAdjusted).toBe(true);
  });
});

describe('打光工作台历史尺寸兼容', () => {
  it('自动尺寸重开后交给工作台测量，手动尺寸保持原样', () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.relightGen, { x: 40, y: 60 });
    const legacy = { ...node, width: 680, height: 360, measured: { width: 680, height: 360 },
      style: { width: 680, height: 360, opacity: 0.8 } };
    const [automatic] = normalizeNodes([legacy]);
    expect(automatic.width).toBeUndefined();
    expect(automatic.height).toBeUndefined();
    expect(automatic.measured).toBeUndefined();
    expect(automatic.style).toEqual({ opacity: 0.8 });
    const [manual] = normalizeNodes([{ ...legacy, data: { ...legacy.data, isSizeManuallyAdjusted: true } }]);
    expect(manual.width).toBe(680);
    expect(manual.height).toBe(360);
    expect(manual.style).toEqual(legacy.style);
  });
});
