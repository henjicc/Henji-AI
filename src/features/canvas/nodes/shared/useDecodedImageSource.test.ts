// @vitest-environment jsdom
import { createElement, Fragment } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

interface DecodeRequest { src: string; resolve: () => void; reject: () => void }
let requests: DecodeRequest[];
beforeEach(() => {
  vi.resetModules();
  requests = [];
  vi.stubGlobal('Image', class {
    src = '';
    decode(): Promise<void> {
      return new Promise((resolve, reject) => {
        requests.push({ src: this.src, resolve, reject: () => reject(new Error('decode failed')) });
      });
    }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('千个同图节点共用在途预解码，完成后再次请求仍重新预热', async () => {
  const { useDecodedImageSource } = await import('./useDecodedImageSource');
  function Node(): null { useDecodedImageSource('shared'); return null; }
  const view = render(createElement(Fragment, null, Array.from({ length: 1000 }, (_, key) => createElement(Node, { key }))));
  expect(requests.map(request => request.src)).toEqual(['shared']);
  await act(async () => { requests[0].resolve(); });
  view.unmount();
  renderHook(() => useDecodedImageSource('shared'));
  expect(requests.map(request => request.src)).toEqual(['shared', 'shared']);
  await act(async () => { requests[1].resolve(); });
});

it('换图期间保留旧图，取消一个使用者不影响共享解码，晚到的结果不能覆盖新目标', async () => {
  const { useDecodedImageSource } = await import('./useDecodedImageSource');
  const first = renderHook(({ src }) => useDecodedImageSource(src), { initialProps: { src: 'old' } });
  const second = renderHook(({ src }) => useDecodedImageSource(src), { initialProps: { src: 'old' } });
  await act(async () => { requests[0].resolve(); });
  first.rerender({ src: 'next' }); second.rerender({ src: 'next' });
  expect(first.result.current).toBe('old');
  expect(second.result.current).toBe('old');
  expect(requests).toHaveLength(2);
  first.rerender({ src: 'latest' });
  await act(async () => { requests[2].resolve(); });
  expect(first.result.current).toBe('latest');
  await act(async () => { requests[1].resolve(); });
  expect(first.result.current).toBe('latest');
  expect(second.result.current).toBe('next');
});

it('失败仍交回浏览器显示且允许后续重试，清空和卸载不提交晚到结果', async () => {
  const { useDecodedImageSource } = await import('./useDecodedImageSource');
  const first = renderHook(({ src }) => useDecodedImageSource(src), { initialProps: { src: 'old' as string | null } });
  await act(async () => { requests[0].resolve(); });
  first.rerender({ src: 'failed' });
  await act(async () => { requests[1].reject(); });
  expect(first.result.current).toBe('failed');
  const retry = renderHook(() => useDecodedImageSource('failed'));
  expect(requests).toHaveLength(3);
  retry.unmount();
  first.rerender({ src: 'waiting' });
  first.rerender({ src: null });
  expect(first.result.current).toBeNull();
  await act(async () => { requests[2].resolve(); requests[3].resolve(); });
  expect(first.result.current).toBeNull();
});

it('最后一个使用者卸载后不保留未完成记录，旧任务结束也不能清除新的同源请求', async () => {
  const { useDecodedImageSource } = await import('./useDecodedImageSource');
  const old = renderHook(() => useDecodedImageSource('same'));
  old.unmount();
  renderHook(() => useDecodedImageSource('same'));
  expect(requests).toHaveLength(2);
  await act(async () => { requests[0].resolve(); });
  renderHook(() => useDecodedImageSource('same'));
  expect(requests).toHaveLength(2);
  await act(async () => { requests[1].resolve(); });
});
