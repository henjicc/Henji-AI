// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMicroThumbnail } from './useMicroThumbnail';

const mocks = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn() }));
vi.mock('@/features/canvas/application/microThumbnail', () => ({ requestMicroThumbnail: mocks.request, getCachedMicroThumbnail: mocks.cached }));
beforeEach(() => { mocks.request.mockReset(); mocks.cached.mockReset().mockReturnValue(null); });
afterEach(() => { cleanup(); });

it('换图、退出低倍率和卸载都释放请求，过期结果不会覆盖当前图片', async () => {
  const entries = new Map<string, { resolve: (value: string) => void; release: ReturnType<typeof vi.fn> }>();
  mocks.request.mockImplementation((src: string) => {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>(complete => { resolve = complete; });
    const release = vi.fn();
    entries.set(src, { resolve, release });
    return { promise, release };
  });
  const view = renderHook(({ src, active }) => useMicroThumbnail(src, active), { initialProps: { src: 'old', active: true } });
  view.rerender({ src: 'new', active: true });
  expect(entries.get('old')?.release).toHaveBeenCalledOnce();
  await act(async () => { entries.get('new')?.resolve('data:new'); });
  expect(view.result.current).toBe('data:new');
  await act(async () => { entries.get('old')?.resolve('data:old'); });
  expect(view.result.current).toBe('data:new');
  view.rerender({ src: 'new', active: false });
  expect(entries.get('new')?.release).toHaveBeenCalledOnce();
  expect(view.result.current).toBeNull();
  view.rerender({ src: 'last', active: true });
  view.unmount();
  expect(entries.get('last')?.release).toHaveBeenCalledOnce();
});
