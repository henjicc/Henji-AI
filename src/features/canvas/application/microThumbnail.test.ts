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
    const { requestMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    const held = await requestMicroThumbnail('image-0').promise;
    for (let i = 1; i < 1024; i++) await requestMicroThumbnail(`image-${i}`).promise;
    expect(getCachedMicroThumbnail('image-0')).toBe(held);
    await requestMicroThumbnail('image-1024').promise;
    expect(getCachedMicroThumbnail('image-1')).toBeNull();
    expect(getCachedMicroThumbnail('image-0')).toBe(held);
    for (let i = 1025; i < 2200; i++) await requestMicroThumbnail(`image-${i}`).promise;
    expect(getCachedMicroThumbnail('image-0')).toBeNull();
    expect(held).toBe('data:image/webp;base64,d2VicA==');
    expect(atob(held.split(',')[1])).toBe('webp');
    expect(Array.from({ length: 2200 }, (_, i) => getCachedMicroThumbnail(`image-${i}`)).filter(Boolean)).toHaveLength(1024);
  });

  it('同时约束字符串大小，过大的结果可显示但不会挤占或无限留在缓存里', async () => {
    const { requestMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    const large = 'data:image/webp;base64,' + 'A'.repeat(9 * 1024 * 1024);
    mocks.encode.mockResolvedValue(large);
    await requestMicroThumbnail('large-1').promise;
    await requestMicroThumbnail('large-2').promise;
    expect(getCachedMicroThumbnail('large-1')).toBeNull();
    expect(getCachedMicroThumbnail('large-2')).toBe(large);
    const oversized = 'data:image/webp;base64,' + 'B'.repeat(17 * 1024 * 1024);
    mocks.encode.mockResolvedValue(oversized);
    expect(await requestMicroThumbnail('oversized').promise).toBe(oversized);
    expect(getCachedMicroThumbnail('oversized')).toBeNull();
    expect(getCachedMicroThumbnail('large-2')).toBe(large);
  });

  it('相同源复用在途任务，队列同时最多生成两张图', async () => {
    const { requestMicroThumbnail } = await import('./microThumbnail');
    const finishers: Array<() => void> = [];
    mocks.load.mockImplementation(() => new Promise(resolve => finishers.push(() => resolve({ naturalWidth: 200, naturalHeight: 100 }))));
    const first = requestMicroThumbnail('first').promise;
    expect(requestMicroThumbnail('first').promise).toBe(first);
    const second = requestMicroThumbnail('second').promise;
    const third = requestMicroThumbnail('third').promise;
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    finishers[0]();
    expect(await first).toBe('first');
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
    finishers[1](); finishers[2]();
    expect(await Promise.all([second, third])).toEqual(['second', 'third']);
    expect(mocks.encode).not.toHaveBeenCalled();
  });

  it('小图和解码或编码失败仍回退源图，命中后不重复生成', async () => {
    const { requestMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    mocks.load.mockRejectedValueOnce(new Error('decode failed'));
    expect(await requestMicroThumbnail('decode-error').promise).toBe('decode-error');
    expect(await requestMicroThumbnail('decode-error').promise).toBe('decode-error');
    expect(mocks.load).toHaveBeenCalledTimes(1);
    mocks.encode.mockRejectedValueOnce(new Error('encode failed'));
    expect(await requestMicroThumbnail('encode-error').promise).toBe('encode-error');
    expect(getCachedMicroThumbnail('encode-error')).toBe('encode-error');
    expect(await requestMicroThumbnail('valid').promise).toMatch(/^data:image\/webp;base64,/);
  });

  it('退出千图画布后跳过全部旧排队工作，新图片只等待已经开始的任务', async () => {
    const { requestMicroThumbnail } = await import('./microThumbnail');
    const finishers: Array<() => void> = [];
    mocks.load.mockImplementation(() => new Promise(resolve => finishers.push(() => resolve({ naturalWidth: 200, naturalHeight: 100 }))));
    const old = Array.from({ length: 1000 }, (_, i) => requestMicroThumbnail(`old-${i}`));
    expect(mocks.load).toHaveBeenCalledTimes(2);
    old.forEach(request => request.release());
    const next = requestMicroThumbnail('new-project');
    expect(mocks.load).toHaveBeenCalledTimes(2);
    finishers[0]();
    await old[0].promise;
    expect(mocks.load).toHaveBeenCalledTimes(3);
    expect(mocks.load).toHaveBeenLastCalledWith('new-project');
    finishers[1](); finishers[2]();
    await Promise.all(old.map(request => request.promise));
    expect(await next.promise).toBe('new-project');
    next.release();
    expect(mocks.load.mock.calls.map(([src]) => src)).toEqual(['old-0', 'old-1', 'new-project']);
  });

  it('同图共享任务只在最后一个使用者释放后取消，重复释放不影响新请求', async () => {
    const { requestMicroThumbnail } = await import('./microThumbnail');
    const finishers: Array<() => void> = [];
    mocks.load.mockImplementation(() => new Promise(resolve => finishers.push(() => resolve({ naturalWidth: 200, naturalHeight: 100 }))));
    const busy = [requestMicroThumbnail('busy-1'), requestMicroThumbnail('busy-2')];
    const first = requestMicroThumbnail('shared');
    const other = requestMicroThumbnail('shared');
    expect(other.promise).toBe(first.promise);
    first.release(); first.release();
    const cancelled = requestMicroThumbnail('cancelled');
    cancelled.release();
    expect(await cancelled.promise).toBe('cancelled');
    const renewed = requestMicroThumbnail('cancelled');
    cancelled.release();
    finishers[0]();
    await busy[0].promise;
    expect(mocks.load).toHaveBeenLastCalledWith('shared');
    finishers[1]();
    await busy[1].promise;
    expect(mocks.load).toHaveBeenLastCalledWith('cancelled');
    other.release();
    const joined = requestMicroThumbnail('shared');
    expect(joined.promise).toBe(other.promise);
    finishers[2](); finishers[3]();
    expect(await Promise.all([other.promise, renewed.promise, joined.promise])).toEqual(['shared', 'cancelled', 'shared']);
    [...busy, renewed, joined].forEach(request => request.release());
  });
});
