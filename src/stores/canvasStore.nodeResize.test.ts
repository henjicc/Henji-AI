import { beforeEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';
import { normalizeNodes } from './canvasStoreNormalization';
import { DEFAULT_RELIGHT_SETTINGS, type RelightMode } from '@/features/canvas/capabilities/relightPolicy';

const TOOL_GENERATION_NODE_TYPES: readonly CanvasNodeType[] = [
  CANVAS_NODE_TYPES.panoramaGen,
  CANVAS_NODE_TYPES.relightGen,
  CANVAS_NODE_TYPES.multiAngleGen,
  CANVAS_NODE_TYPES.upscaleGen,
  CANVAS_NODE_TYPES.elementEditGen,
  CANVAS_NODE_TYPES.layerSeparationGen,
];

beforeEach(() => {
  useCanvasStore.getState().clearCanvas();
});

describe('画布工具节点尺寸跟踪', () => {
  it.each(TOOL_GENERATION_NODE_TYPES)('%s 缩放结束后锁定真实尺寸', (type) => {
    const node = { ...canvasNodeFactory.createNode(type, { x: 40, y: 60 }), style: { width: 680, height: 360 } };
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
    expect(resized?.style).toEqual({ width: 920, height: 580 });
  });
});

describe('打光工作台历史尺寸兼容', () => {
  it('自动尺寸重开后统一为当前布局，合法手动尺寸保持原样', () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.relightGen, { x: 40, y: 60 });
    const legacy = { ...node, width: 680, height: 360, measured: { width: 680, height: 360 },
      style: { width: 680, height: 360, opacity: 0.8 } };
    const [automatic] = normalizeNodes([legacy]);
    expect(automatic.width).toBe(720);
    expect(automatic.height).toBe(420);
    expect(automatic.measured).toEqual({ width: 720, height: 420 });
    expect(automatic.style).toEqual({ width: 720, height: 420, opacity: 0.8 });
    const [manual] = normalizeNodes([{ ...legacy, data: { ...legacy.data, isSizeManuallyAdjusted: true } }]);
    expect(manual.width).toBe(680);
    expect(manual.height).toBe(360);
    expect(manual.style).toEqual(legacy.style);
  });

  it('修复已保存的窄外框，避免手动模式被 ReactFlow 绘制盒裁切', () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.relightGen, { x: 40, y: 60 });
    const [restored] = normalizeNodes([{ ...node, width: 350, height: 280,
      measured: { width: 350, height: 280 }, style: { width: 350, height: 280 },
      data: { ...node.data, isSizeManuallyAdjusted: true } }]);
    expect(restored).toMatchObject({ width: 600, height: 300, style: { width: 600, height: 300 },
      measured: { width: 600, height: 300 } });
  });

  it('模式切换固定右边缘、分别保留手动尺寸，撤销和重开后仍保持一致', () => {
    const node = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.relightGen, { x: 40, y: 60 });
    useCanvasStore.getState().setCanvasData([node], []);
    const current = () => useCanvasStore.getState().nodes[0];
    const switchMode = (lightingMode: RelightMode) => useCanvasStore.getState().updateNodeData(node.id,
      { relightSettings: { ...DEFAULT_RELIGHT_SETTINGS, lightingMode } });
    const resize = (width: number, height: number) => useCanvasStore.getState().onNodesChange([
      { id: node.id, type: 'dimensions', dimensions: { width, height }, resizing: true, setAttributes: true },
      { id: node.id, type: 'dimensions', dimensions: { width, height }, resizing: false },
    ]);
    const assertBox = (width: number, height: number, right: number) => {
      expect(current()).toMatchObject({ width, height, style: { width, height }, measured: { width, height } });
      expect(current().position.x + width).toBe(right);
    };
    switchMode('smart');
    assertBox(360, 420, 760);
    switchMode('manual');
    assertBox(720, 420, 760);
    resize(920, 580);
    switchMode('smart');
    assertBox(360, 420, 960);
    resize(460, 640);
    switchMode('manual');
    assertBox(920, 580, 1060);
    useCanvasStore.getState().undo();
    assertBox(460, 640, 1060);
    useCanvasStore.getState().redo();
    assertBox(920, 580, 1060);
    const saved = current();
    useCanvasStore.getState().setCanvasData([saved], []);
    switchMode('smart');
    assertBox(460, 640, 1060);
  });
});
