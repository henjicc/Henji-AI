// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasMediaPreview, useMicroThumbnail } from './useCanvasMediaThumbnail';

const mocks = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn() }));
vi.mock('@/features/canvas/application/canvasMediaThumbnail', () => ({
  CANVAS_PREVIEW_THUMBNAIL_SIZE: 512,
  canvasThumbnailKey: (spec: { kind: string; source: string; maxSize?: number }) => `${spec.kind}|${spec.maxSize ?? 0}|${spec.source}`,
  requestCanvasThumbnail: (spec: { source: string }) => mocks.request(spec.source, spec),
  getCachedCanvasThumbnail: (spec: { source: string }) => mocks.cached(spec.source),
}));
vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (source: string) => `display:${source}` }));
beforeEach(() => { mocks.request.mockReset(); mocks.cached.mockReset().mockReturnValue(undefined); });
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

it('有作品自带预览直接用；只存原媒体或带回旧缩略图路径时按原媒体取预览尺寸缩略图，取图期间为 undefined', async () => {
  let resolve!: (value: string | null) => void;
  mocks.request.mockImplementation(() => ({ promise: new Promise<string | null>(complete => { resolve = complete; }), release: vi.fn() }));
  const stored = renderHook(() => useCanvasMediaPreview('image', 'D:/a.png', 'D:/a-preview.jpg'));
  expect(stored.result.current).toBe('display:D:/a-preview.jpg');
  expect(mocks.request).not.toHaveBeenCalled();
  const derived = renderHook(() => useCanvasMediaPreview('video', 'D:/a.mp4', null));
  expect(derived.result.current).toBeUndefined();
  expect(mocks.request).toHaveBeenCalledWith('D:/a.mp4', { kind: 'video', source: 'D:/a.mp4', maxSize: 512 });
  await act(async () => { resolve('henji-media://poster'); });
  expect(derived.result.current).toBe('henji-media://poster');
  expect(renderHook(() => useCanvasMediaPreview('image', null, null)).result.current).toBeNull();
  mocks.request.mockClear();
  renderHook(() => useCanvasMediaPreview('image', 'D:/b.png', 'E:/HenjiAI/.system/Thumbnails/image-b.jpg'));
  expect(mocks.request).toHaveBeenCalledWith('D:/b.png', { kind: 'image', source: 'D:/b.png', maxSize: 512 });
});
