/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactFlowProps } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import { CanvasViewportFlow } from './CanvasViewportFlow';

const store = vi.hoisted(() => ({ getState: () => ({ domNode: null }), subscribe: () => () => {} }));
vi.mock('../hooks/canvasNodeLayout', () => ({ createCanvasNodeLayout: () => () => {} }));
let flow: ReactFlowProps<CanvasNode, CanvasEdge>;
vi.mock('@xyflow/react', () => ({
  useStoreApi: () => store,
  ReactFlow: (props: ReactFlowProps<CanvasNode, CanvasEdge>) => {
    flow = props;
    return <div data-testid="flow" onPointerDownCapture={props.onPointerDownCapture} onKeyDownCapture={props.onKeyDownCapture} />;
  },
}));

const frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); frames.clear(); vi.unstubAllGlobals(); });

function drawFrame(): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach(callback => callback(16)));
}

it('一帧内合并多个视口，只提交最新位置和缩放', () => {
  render(<CanvasViewportFlow defaultViewport={{ x: 0, y: 0, zoom: 1 }} />);
  act(() => {
    for (let index = 1; index <= 100; index++) flow.onViewportChange?.({ x: index, y: -index, zoom: 0.5 });
  });
  expect(frames.size).toBe(1);
  expect(flow.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  drawFrame();
  expect(flow.viewport).toEqual({ x: 100, y: -100, zoom: 0.5 });
  expect(frames.size).toBe(0);
});

it('手势结束先提交最后位置，再通知保存；新输入开始前也提交剩余视口', () => {
  const next = { x: 40, y: 80, zoom: 0.5 };
  const end = vi.fn(() => expect(flow.viewport).toEqual(next));
  const pointer = vi.fn(() => expect(flow.viewport?.x).toBe(90));
  const key = vi.fn(() => expect(flow.viewport?.x).toBe(120));
  const view = render(<CanvasViewportFlow onMoveEnd={end} onPointerDownCapture={pointer} onKeyDownCapture={key} />);
  act(() => { flow.onViewportChange?.(next); flow.onMoveEnd?.(null, next); });
  expect(end).toHaveBeenCalledOnce();
  act(() => flow.onViewportChange?.({ ...next, x: 90 }));
  fireEvent.pointerDown(document.body);
  expect(flow.viewport?.x).toBe(90);
  fireEvent.pointerDown(view.getByTestId('flow'));
  expect(pointer).toHaveBeenCalledOnce();
  act(() => flow.onViewportChange?.({ ...next, x: 120 }));
  fireEvent.keyDown(view.getByTestId('flow'), { key: 'ArrowRight' });
  expect(key).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});

it('程序恢复不等待下一帧，卸载后丢弃未处理的帧和微任务', async () => {
  const view = render(<CanvasViewportFlow />);
  const next = { x: -200, y: 75, zoom: 0.75 };
  await act(async () => { flow.onViewportChange?.(next); flow.onMove?.(null, next); await Promise.resolve(); });
  expect(flow.viewport).toEqual(next);
  expect(frames.size).toBe(0);
  act(() => { flow.onViewportChange?.({ ...next, x: -300 }); flow.onMove?.(null, next); });
  view.unmount();
  await act(async () => { await Promise.resolve(); });
  expect(frames.size).toBe(0);
  expect(flow.viewport).toEqual(next);
});

it('编辑后交互回调保持同一身份，调用时仍收到最新逻辑和原始参数', () => {
  const first = vi.fn();
  const latest = vi.fn();
  const props = (callback: typeof first) => ({ onNodesChange: callback, onEdgesChange: callback,
    onConnect: callback, onConnectStart: callback, onConnectEnd: callback,
    onNodeDragStart: callback, onNodeDragStop: callback, onSelectionDragStart: callback,
    onSelectionDragStop: callback, onMoveStart: callback, onMove: callback, onMoveEnd: callback,
    onEdgeDoubleClick: callback, onNodeContextMenu: callback, onPaneClick: callback, onPaneContextMenu: callback });
  const view = render(<CanvasViewportFlow {...props(first)} />);
  const before = flow;
  view.rerender(<CanvasViewportFlow {...props(latest)} />);
  for (const key of Object.keys(props(latest)) as Array<keyof ReturnType<typeof props>>) expect(flow[key]).toBe(before[key]);
  const changes = [{ id: 'new-selection', type: 'select' as const, selected: true }];
  act(() => flow.onNodesChange?.(changes));
  expect(latest).toHaveBeenCalledWith(changes);
  expect(first).not.toHaveBeenCalled();
});

it('移除回调后已保存的代理不会继续执行旧逻辑，重新启用仍委托最新回调', () => {
  const first = vi.fn();
  const latest = vi.fn();
  const view = render(<CanvasViewportFlow onNodesChange={first} />);
  const retained = flow.onNodesChange;
  view.rerender(<CanvasViewportFlow />);
  expect(flow.onNodesChange).toBeUndefined();
  act(() => retained?.([]));
  expect(first).not.toHaveBeenCalled();
  view.rerender(<CanvasViewportFlow onNodesChange={latest} />);
  expect(flow.onNodesChange).toBe(retained);
  act(() => retained?.([]));
  expect(latest).toHaveBeenCalledOnce();
});
