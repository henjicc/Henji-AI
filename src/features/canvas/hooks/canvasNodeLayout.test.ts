/** @vitest-environment jsdom */
import type { InternalNode, Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvasNodeLayout, resumeCanvasNodeMeasurement } from './canvasNodeLayout';

const frames = new Map<number, FrameRequestCallback>();
const disposers: Array<() => void> = [];
let sequence = 0;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { disposers.splice(0).forEach(stop => stop()); frames.clear(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function draw(count = 1) {
  for (let index = 0; index < count; index++) {
    await Promise.resolve();
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(index * 16));
  }
}
function fixture() {
  const root = document.createElement('div'); document.body.append(root);
  const nodeLookup = new Map<string, InternalNode>();
  const elements = [0, 3000].map((x, index) => {
    const userNode: Node = { id: String(index), data: { prompt: '保留草稿' }, position: { x, y: 0 } };
    nodeLookup.set(userNode.id, { ...userNode, measured: { width: 300, height: 200 },
      internals: { positionAbsolute: userNode.position, z: 0, userNode, handleBounds: { source: [], target: [] } } });
    const element = document.createElement('div');
    element.className = 'react-flow__node'; element.dataset.id = userNode.id;
    const editor = document.createElement('div'); editor.tabIndex = 0; editor.textContent = '保留草稿'; element.append(editor);
    root.append(element); return element;
  });
  const updateNodeInternals = vi.fn((updates: Map<string, { nodeElement: HTMLElement }>) => {
    for (const update of updates.values()) expect(update.nodeElement.hasAttribute('data-canvas-layout-suspended')).toBe(false);
  });
  const state = { domNode: root, nodeLookup, width: 1000, height: 800, transform: [0, 0, 1] as [number, number, number], updateNodeInternals };
  const listeners = new Set<() => void>();
  const dispose = createCanvasNodeLayout({ getState: () => state, subscribe: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; } });
  disposers.push(dispose);
  const publish = () => listeners.forEach(listener => listener());
  const viewport = (x: number) => { state.transform = [x, 0, 1]; publish(); };
  return { state, elements, publish, viewport, dispose, listeners, updateNodeInternals };
}
const suspended = (element: Element) => element.getAttribute('data-canvas-layout-suspended') === 'true';

it('持久化尺寸不能代替首次端口测量，测量完成后才暂停屏外布局', async () => {
  const { state, elements, publish } = fixture();
  const node = state.nodeLookup.get('1')!;
  node.internals.handleBounds = undefined;
  await draw(4);
  expect(suspended(elements[1])).toBe(false);
  node.internals.handleBounds = { source: [], target: [] };
  publish(); await draw();
  expect(suspended(elements[1])).toBe(true);
});

it('只暂停屏外节点，进入缓冲区同步恢复，保留图数据与 DOM 身份', async () => {
  const { state, elements, viewport } = fixture();
  const original = state.nodeLookup.get('1');
  const editor = elements[1].firstChild;
  await draw(4);
  expect(suspended(elements[0])).toBe(false);
  expect(suspended(elements[1])).toBe(true);
  expect(frames.size).toBe(0);
  viewport(-1600);
  expect(suspended(elements[1])).toBe(false);
  expect(state.nodeLookup.get('1')).toBe(original);
  expect(elements[1].firstChild).toBe(editor);
});

it('后台数据或隐藏内容变化先恢复并重测，稳定后才暂停', async () => {
  const { state, elements, publish, updateNodeInternals } = fixture();
  await draw(4);
  const node = state.nodeLookup.get('1')!;
  state.nodeLookup.set('1', { ...node, internals: { ...node.internals, userNode: { ...node.internals.userNode, data: { prompt: '新草稿' } } } });
  publish(); await draw();
  expect(suspended(elements[1])).toBe(false);
  await draw(3);
  expect(updateNodeInternals).toHaveBeenCalled();
  expect(suspended(elements[1])).toBe(true);
  updateNodeInternals.mockClear();
  elements[1].firstChild!.textContent = '参数联动';
  await draw();
  expect(suspended(elements[1])).toBe(false);
  await draw(3);
  expect(updateNodeInternals).toHaveBeenCalled();
});

it('端口测量唤醒不被同一帧多个视口通知提前撤销', async () => {
  const { elements, viewport } = fixture();
  await draw(4);
  resumeCanvasNodeMeasurement(elements[1]);
  viewport(1); viewport(2); viewport(3);
  expect(suspended(elements[1])).toBe(false);
  await draw();
  expect(suspended(elements[1])).toBe(false);
  await draw(2);
  expect(suspended(elements[1])).toBe(true);
});

it('Tab 恢复完整顺序，重新用鼠标后仍保留当前焦点所在节点', async () => {
  const { elements } = fixture();
  await draw(4);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(suspended(elements[1])).toBe(false);
  const editor = elements[1].firstElementChild as HTMLElement; editor.focus();
  window.dispatchEvent(new Event('pointerdown'));
  await draw(3);
  expect(suspended(elements[1])).toBe(false);
  expect(document.activeElement).toBe(editor);
});

it('节点删除与画布退出解除测量唤醒、观察和排队回调', async () => {
  const { elements, dispose, listeners } = fixture();
  await draw(4);
  elements[1].remove(); await draw(3);
  resumeCanvasNodeMeasurement(elements[1]);
  expect(frames.size).toBe(0);
  dispose();
  expect(listeners.size).toBe(0);
  expect(frames.size).toBe(0);
  expect(suspended(elements[0])).toBe(false);
});
