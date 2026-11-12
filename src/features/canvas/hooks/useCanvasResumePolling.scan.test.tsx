// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resume: vi.fn() }));
type TestNode = { id: string; position: { x: number; y: number }; data: Record<string, unknown> };
const canvas = vi.hoisted(() => ({ store: null as unknown as import('zustand').UseBoundStore<import('zustand').StoreApi<{ nodes: TestNode[] }>> }));
vi.mock('@/stores/canvasStore', async () => {
  const { create: createStore } = await import('zustand');
  canvas.store = createStore<{ nodes: TestNode[] }>(() => ({ nodes: [] }));
  return { useCanvasStore: canvas.store };
});
vi.mock('@/stores/projectStore', () => ({ useProjectStore: (select: (state: { currentProjectId: string }) => unknown) => select({ currentProjectId: 'project' }) }));
vi.mock('../application/canvasResumePollingService', () => ({ resumeCanvasProjectGeneration: mocks.resume }));

import { useCanvasResumePolling } from './useCanvasResumePolling';

afterEach(cleanup);

describe('画布续查扫描时机', () => {
  it('打开时整体扫一遍；拖动只改位置不扫描，data 变化只交出变化的节点', () => {
    const nodes: TestNode[] = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, position: { x: 0, y: 0 }, data: { i } }));
    canvas.store.setState({ nodes });
    renderHook(() => useCanvasResumePolling());
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    expect(mocks.resume).toHaveBeenLastCalledWith('project');
    act(() => {
      for (let frame = 1; frame <= 60; frame++) {
        canvas.store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'n1' ? { ...node, position: { x: frame, y: frame } } : node) }));
      }
    });
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    act(() => {
      canvas.store.setState(state => ({ nodes: [...state.nodes.map(node => node.id === 'n2' ? { ...node, data: { serverTaskId: 'task' } } : node), { id: 'n3', position: { x: 0, y: 0 }, data: {} }] }));
    });
    expect(mocks.resume).toHaveBeenCalledTimes(2);
    expect(mocks.resume).toHaveBeenLastCalledWith('project', new Set(['n2', 'n3']));
  });
});
