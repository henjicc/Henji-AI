// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn(), poster: vi.fn() }));
vi.mock('@/platform', () => ({ getPlatform: () => ({ image: { getCachedThumbnail: mocks.thumbnail }, video: { getCachedThumbnail: mocks.poster } }) }));
vi.mock('@/services/imageSource', () => ({
  resolveImageDisplayUrl: (path: string) => /^[A-Za-z]:[\/]/.test(path) ? `henji-media://${path}` : path,
  isLikelyLocalImagePath: (src: string) => /^[A-Za-z]:[\\/]/.test(src),
}));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn() }) }));

const local = (name: string) => `D:/media/${name}.png`;
const image = (source: string, maxSize?: number) => ({ kind: 'image' as const, source, ...(maxSize ? { maxSize } : {}) });

beforeEach(() => {
  vi.resetModules();
  mocks.thumbnail.mockReset().mockImplementation(async (src: string) => ({ path: `T:/thumbs/${src.slice(-12)}.webp` }));
  mocks.poster.mockReset().mockImplementation(async (src: string) => ({ path: `T:/posters/${src.slice(-12)}.webp` }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('画布媒体缩略图', () => {
  it('本地图片交给主进程落盘缩略图，渲染层只拿显示地址；远程与 data 地址直接用源图', async () => {
    const { requestCanvasThumbnail } = await import('./canvasMediaThumbnail');
    expect(await requestCanvasThumbnail(image('henji-media://local/D%3A/a.png')).promise).toMatch(/^henji-media:\/\/T:\/thumbs\//);
    expect(await requestCanvasThumbnail(image('https://example.com/a.png')).promise).toBe('https://example.com/a.png');
    expect(await requestCanvasThumbnail(image('data:image/png;base64,AA==')).promise).toBe('data:image/png;base64,AA==');
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.thumbnail).toHaveBeenCalledWith('henji-media://local/D%3A/a.png', undefined);
  });

  it('超过容量后逐出最久未使用项，命中后不重复请求', async () => {
    const { requestCanvasThumbnail, getCachedCanvasThumbnail } = await import('./canvasMediaThumbnail');
    const held = await requestCanvasThumbnail(image(local('image-0'))).promise;
    for (let i = 1; i < 1024; i++) await requestCanvasThumbnail(image(local(`image-${i}`))).promise;
    expect(getCachedCanvasThumbnail(image(local('image-0')))).toBe(held);
    await requestCanvasThumbnail(image(local('image-1024'))).promise;
    expect(getCachedCanvasThumbnail(image(local('image-1')))).toBeUndefined();
    expect(getCachedCanvasThumbnail(image(local('image-0')))).toBe(held);
    await requestCanvasThumbnail(image(local('image-0'))).promise;
    expect(mocks.thumbnail).toHaveBeenCalledTimes(1025);
  });

  it('主进程失败时本次回退源图，不写缓存，下次进入视口重试', async () => {
    const { requestCanvasThumbnail, getCachedCanvasThumbnail } = await import('./canvasMediaThumbnail');
    mocks.thumbnail.mockRejectedValueOnce(new Error('decode failed'));
    expect(await requestCanvasThumbnail(image(local('broken'))).promise).toBe(`henji-media://${local('broken')}`);
    expect(getCachedCanvasThumbnail(image(local('broken')))).toBeUndefined();
    expect(await requestCanvasThumbnail(image(local('broken'))).promise).toMatch(/^henji-media:\/\/T:\/thumbs\//);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(2);
  });

  it('相同源复用在途任务，同时最多 4 个；离开画布后撤掉还没开始的排队任务', async () => {
    const { requestCanvasThumbnail } = await import('./canvasMediaThumbnail');
    const finishers: Array<() => void> = [];
    mocks.thumbnail.mockImplementation((src: string) => new Promise(resolve => finishers.push(() => resolve({ path: `${src}.webp` }))));
    const old = Array.from({ length: 1000 }, (_, i) => requestCanvasThumbnail(image(local(`old-${i}`))));
    expect(requestCanvasThumbnail(image(local('old-0'))).promise).toBe(old[0].promise);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(4);
    old.forEach(request => request.release());
    const next = requestCanvasThumbnail(image(local('new-project')));
    expect(mocks.thumbnail).toHaveBeenCalledTimes(4);
    finishers[0]();
    await old[0].promise;
    expect(mocks.thumbnail).toHaveBeenLastCalledWith(local('new-project'), undefined);
    finishers.slice(1).forEach(finish => finish());
    expect(await old[999].promise).toBe(`henji-media://${local('old-999')}`);
    expect(await next.promise).toBe(`henji-media://${local('new-project')}.webp`);
    expect(mocks.thumbnail).toHaveBeenCalledTimes(5);
  });

  it('预览尺寸与微缩略图各成一份缓存；视频按原视频抽帧，远程视频与失败都不给封面', async () => {
    const { requestCanvasThumbnail } = await import('./canvasMediaThumbnail');
    await requestCanvasThumbnail(image(local('a'))).promise;
    await requestCanvasThumbnail(image(local('a'), 512)).promise;
    expect(mocks.thumbnail.mock.calls).toEqual([[local('a'), undefined], [local('a'), 512]]);
    expect(await requestCanvasThumbnail({ kind: 'video', source: 'D:/media/clip.mp4', maxSize: 512 }).promise).toMatch(/^henji-media:\/\/T:\/posters\//);
    expect(mocks.poster).toHaveBeenCalledWith('D:/media/clip.mp4', undefined, 512);
    expect(await requestCanvasThumbnail({ kind: 'video', source: 'https://example.com/a.mp4' }).promise).toBeNull();
    mocks.poster.mockRejectedValueOnce(new Error('ffmpeg failed'));
    expect(await requestCanvasThumbnail({ kind: 'video', source: 'D:/media/broken.mp4' }).promise).toBeNull();
  });
});
