// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn() }));
vi.mock('@/platform', () => ({ getPlatform: () => ({ image: { getCachedThumbnail: mocks.thumbnail } }) }));
vi.mock('@/services/imageSource', () => ({
  resolveImageDisplayUrl: (path: string) => `henji-media://${path}`,
  isLikelyLocalImagePath: (src: string) => /^[A-Za-z]:[\\/]/.test(src),
}));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn() }) }));

const local = (name: string) => `D:/media/${name}.png`;

beforeEach(() => {
  vi.resetModules();
  mocks.thumbnail.mockReset().mockImplementation(async (src: string) => ({ path: `T:/thumbs/${src.slice(-12)}.webp` }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('微缩略图', () => {
  it('本地图片交给主进程落盘缩略图，渲染层只拿显示地址；远程与 data 地址直接用源图', async () => {
    const { requestMicroThumbnail } = await import('./microThumbnail');
    expect(await requestMicroThumbnail('henji-media://local/D%3A/a.png').promise).toMatch(/^henji-media:\/\/T:\/thumbs\//);
    expect(await requestMicroThumbnail('https://example.com/a.png').promise).toBe('https://example.com/a.png');
    expect(await requestMicroThumbnail('data:image/png;base64,AA==').promise).toBe('data:image/png;base64,AA==');
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.thumbnail).toHaveBeenCalledWith('henji-media://local/D%3A/a.png');
  });

  it('超过容量后逐出最久未使用项，命中后不重复请求', async () => {
    const { requestMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    const held = await requestMicroThumbnail(local('image-0')).promise;
    for (let i = 1; i < 1024; i++) await requestMicroThumbnail(local(`image-${i}`)).promise;
    expect(getCachedMicroThumbnail(local('image-0'))).toBe(held);
    await requestMicroThumbnail(local('image-1024')).promise;
    expect(getCachedMicroThumbnail(local('image-1'))).toBeNull();
    expect(getCachedMicroThumbnail(local('image-0'))).toBe(held);
    await requestMicroThumbnail(local('image-0')).promise;
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1025);
  });

  it('主进程失败时本次回退源图，不写缓存，下次进入视口重试', async () => {
    const { requestMicroThumbnail, getCachedMicroThumbnail } = await import('./microThumbnail');
    mocks.thumbnail.mockRejectedValueOnce(new Error('decode failed'));
    expect(await requestMicroThumbnail(local('broken')).promise).toBe(local('broken'));
    expect(getCachedMicroThumbnail(local('broken'))).toBeNull();
    expect(await requestMicroThumbnail(local('broken')).promise).toMatch(/^henji-media:\/\/T:\/thumbs\//);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(2);
  });

  it('相同源复用在途任务，同时最多 4 个；离开画布后撤掉还没开始的排队任务', async () => {
    const { requestMicroThumbnail } = await import('./microThumbnail');
    const finishers: Array<() => void> = [];
    mocks.thumbnail.mockImplementation((src: string) => new Promise(resolve => finishers.push(() => resolve({ path: `${src}.webp` }))));
    const old = Array.from({ length: 1000 }, (_, i) => requestMicroThumbnail(local(`old-${i}`)));
    expect(requestMicroThumbnail(local('old-0')).promise).toBe(old[0].promise);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(4);
    old.forEach(request => request.release());
    const next = requestMicroThumbnail(local('new-project'));
    expect(mocks.thumbnail).toHaveBeenCalledTimes(4);
    finishers[0]();
    await old[0].promise;
    expect(mocks.thumbnail).toHaveBeenLastCalledWith(local('new-project'));
    finishers.slice(1).forEach(finish => finish());
    expect(await old[999].promise).toBe(local('old-999'));
    expect(await next.promise).toBe(`henji-media://${local('new-project')}.webp`);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(5);
  });
});
