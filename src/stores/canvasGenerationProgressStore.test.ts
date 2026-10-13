// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCanvasGenerationProgressStore as store } from './canvasGenerationProgressStore';

afterEach(() => { cleanup(); store.getState().clearAllProgress(); });

it('其他节点进度变化不重渲染本节点叶子', () => {
  const rendered = vi.fn();
  renderHook(() => { const progress = store(state => state.progress.a); rendered(); return progress; });
  const initial = rendered.mock.calls.length;
  act(() => store.getState().setProgress('b', 0.3));
  expect(rendered.mock.calls.length).toBe(initial);
  act(() => store.getState().setProgress('a', 0.3));
  expect(rendered.mock.calls.length).toBe(initial + 1);
});

it('相等写入和无命中清理不通知订阅者', () => {
  store.getState().setProgress('a', 0.4);
  const snapshot = store.getState();
  const notify = vi.fn();
  const unsubscribe = store.subscribe(notify);
  store.getState().setProgress('a', 0.4005);
  store.getState().setProgress('missing', null);
  store.getState().clearProgress(new Set(['missing']));
  expect(store.getState()).toBe(snapshot);
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});

it('钳制进度并按节点清理，空表重复清理不通知', () => {
  store.getState().setProgress('a', 2);
  store.getState().setProgress('b', -1);
  expect(store.getState().progress).toEqual({ a: 1, b: 0 });
  store.getState().clearProgress(new Set(['a']));
  expect(store.getState().progress).toEqual({ b: 0 });
  store.getState().setProgress('b', null);
  const notify = vi.fn();
  const unsubscribe = store.subscribe(notify);
  store.getState().clearAllProgress();
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});
