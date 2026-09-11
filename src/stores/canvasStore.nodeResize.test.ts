import { beforeEach, describe, expect, it } from 'vitest';

import { canvasNodeFactory } from '@/features/canvas/application/canvasServices';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from './canvasStore';
import { normalizeNodes } from './canvasStoreNormalization';
import { DEFAULT_RELIGHT_SETTINGS, type RelightMode } from '@/features/canvas/capabilities/relightPolicy';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { resolveGenerationNodeManualDimension } from '@/features/canvas/nodes/shared/useGenerationNodeMinimumHeight';

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
  it.each(Object.values(canvasNodeDefinitions)
    .filter((definition) => definition.executionKind === 'standard-generation')
    .map((definition) => definition.type))('%s 第一次拖动中立即采用手动尺寸，撤销恢复自动尺寸', (type) => {
    const node = canvasNodeFactory.createNode(type, { x: 40, y: 60 });
    useCanvasStore.getState().setCanvasData([node], []);
    const current = () => useCanvasStore.getState().nodes[0];

    // 内容 ResizeObserver 的测量不代表用户调整，必须继续允许自动收紧。
    useCanvasStore.getState().onNodesChange([
      { id: node.id, type: 'dimensions', dimensions: { width: 720, height: 420 } },
    ]);
    expect(current().data.isSizeManuallyAdjusted).not.toBe(true);
    const initial = current();
    for (const dimensions of [{ width: 820, height: 520 }, { width: 900, height: 580 }]) {
      useCanvasStore.getState().onNodesChange([
        { id: node.id, type: 'dimensions', dimensions, resizing: true, setAttributes: true },
      ]);
      const resized = current();
      expect(resized.data.isSizeManuallyAdjusted).toBe(true);
      expect(resolveGenerationNodeManualDimension(resized.width, 320, resized.data.isSizeManuallyAdjusted === true)).toBe(dimensions.width);
      expect(resolveGenerationNodeManualDimension(resized.height, 160, resized.data.isSizeManuallyAdjusted === true)).toBe(dimensions.height);
    }
    // ReactFlow 的释放事件只取消 resizing，不一定再次携带 dimensions。
    useCanvasStore.getState().onNodesChange([{ id: node.id, type: 'dimensions', resizing: false }]);
    expect(current()).toMatchObject({ width: 900, height: 580, resizing: false });
    useCanvasStore.getState().undo();
    expect(current().data.isSizeManuallyAdjusted).toBe(initial.data.isSizeManuallyAdjusted);
    expect(current().width).toBe(initial.width);
    expect(current().height).toBe(initial.height);
    useCanvasStore.getState().redo();
    expect(current()).toMatchObject({ width: 900, height: 580, data: { isSizeManuallyAdjusted: true } });
  });

  it.each([2 / 3, 3 / 2, 1])('扩图按源图比例 %s 初始化，之后不改写控件的手势尺寸', aspect => {
    const node = { ...canvasNodeFactory.createNode(CANVAS_NODE_TYPES.imageEdit, { x: 40, y: 60 }),
      data: { generationUi: { layoutMode: 'workbench', workbenchEditor: 'outpaint' } } };
    useCanvasStore.getState().setCanvasData([node], []);
    useCanvasStore.getState().updateNodeData(node.id, { outpaintSourceAspectRatio: aspect }, { skipHistory: true });
    const initial = useCanvasStore.getState().nodes[0];
    expect((initial.width! - 218) / (initial.height! - 18)).toBeCloseTo(aspect);
    for (const scale of [1.1, 1.3, 1.15]) {
      const dimensions = { width: initial.width! * scale, height: initial.height! * scale };
      useCanvasStore.getState().onNodesChange([{ id: node.id, type: 'dimensions', dimensions, resizing: true, setAttributes: true }]);
      expect(useCanvasStore.getState().nodes[0]).toMatchObject({ ...dimensions, measured: dimensions, style: dimensions });
      useCanvasStore.getState().updateNodeData(node.id, { outpaintSourceAspectRatio: aspect }, { skipHistory: true });
      expect(useCanvasStore.getState().nodes[0]).toMatchObject(dimensions);
    }
    const last = useCanvasStore.getState().nodes[0];
    useCanvasStore.getState().onNodesChange([{ id: node.id, type: 'dimensions', dimensions: { width: last.width!, height: last.height! }, resizing: false }]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({ width: initial.width, height: initial.height });
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({ width: last.width, height: last.height });
  });
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
