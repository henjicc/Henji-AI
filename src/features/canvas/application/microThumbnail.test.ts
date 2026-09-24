// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), encode: vi.fn() }));
vi.mock('./imageData', () => ({ loadImageElement: mocks.load, blobToDataUrl: mocks.encode }));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn() }) }));

beforeEach(() => {
  vi.resetModules();
  mocks.load.mockReset().mockResolvedValue({ naturalWidth: 512, naturalHeight: 256 });
  mocks.encode.mockReset().mockResolvedValue('data:image/webp;base64,d2VicA==');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['webp'], { type: 'image/webp' })));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('微缩略图缓存生命周期', () => {
  it('超过容量后逐出最久未使用项，已交给节点的编码内容仍完整有效', async () => {
    const { ensureMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    const held = await ensureMicroThumbnail('image-0');
    for (let i = 1; i < 1024; i++) await ensureMicroThumbnail(`image-${i}`);
    expect(getCachedMicroThumbnail('image-0')).toBe(held);
    await ensureMicroThumbnail('image-1024');
    expect(getCachedMicroThumbnail('image-1')).toBeNull();
    expect(getCachedMicroThumbnail('image-0')).toBe(held);
    for (let i = 1025; i < 2200; i++) await ensureMicroThumbnail(`image-${i}`);
    expect(getCachedMicroThumbnail('image-0')).toBeNull();
    expect(held).toBe('data:image/webp;base64,d2VicA==');
    expect(atob(held.split(',')[1])).toBe('webp');
    expect(Array.from({ length: 2200 }, (_, i) => getCachedMicroThumbnail(`image-${i}`)).filter(Boolean)).toHaveLength(1024);
  });

  it('同时约束字符串大小，过大的结果可显示但不会挤占或无限留在缓存里', async () => {
    const { ensureMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    const large = 'data:image/webp;base64,' + 'A'.repeat(9 * 1024 * 1024);
    mocks.encode.mockResolvedValue(large);
    await ensureMicroThumbnail('large-1');
    await ensureMicroThumbnail('large-2');
    expect(getCachedMicroThumbnail('large-1')).toBeNull();
    expect(getCachedMicroThumbnail('large-2')).toBe(large);
    const oversized = 'data:image/webp;base64,' + 'B'.repeat(17 * 1024 * 1024);
    mocks.encode.mockResolvedValue(oversized);
    expect(await ensureMicroThumbnail('oversized')).toBe(oversized);
    expect(getCachedMicroThumbnail('oversized')).toBeNull();
    expect(getCachedMicroThumbnail('large-2')).toBe(large);
  });

  it('相同源复用在途任务，队列同时最多生成两张图', async () => {
    const { ensureMicroThumbnail } = await import('./microThumbnail');
    const finishers: Array<() => void> = [];
    mocks.load.mockImplementation(() => new Promise(resolve => finishers.push(() => resolve({ naturalWidth: 200, naturalHeight: 100 }))));
    const first = ensureMicroThumbnail('first');
    expect(ensureMicroThumbnail('first')).toBe(first);
    const second = ensureMicroThumbnail('second');
    const third = ensureMicroThumbnail('third');
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    finishers[0]();
    expect(await first).toBe('first');
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
    finishers[1](); finishers[2]();
    expect(await Promise.all([second, third])).toEqual(['second', 'third']);
    expect(mocks.encode).not.toHaveBeenCalled();
  });

  it('小图和解码或编码失败仍回退源图，命中后不重复生成', async () => {
    const { ensureMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    mocks.load.mockRejectedValueOnce(new Error('decode failed'));
    expect(await ensureMicroThumbnail('decode-error')).toBe('decode-error');
    expect(await ensureMicroThumbnail('decode-error')).toBe('decode-error');
    expect(mocks.load).toHaveBeenCalledTimes(1);
    mocks.encode.mockRejectedValueOnce(new Error('encode failed'));
    expect(await ensureMicroThumbnail('encode-error')).toBe('encode-error');
    expect(getCachedMicroThumbnail('encode-error')).toBe('encode-error');
    expect(await ensureMicroThumbnail('valid')).toMatch(/^data:image\/webp;base64,/);
  });
});
