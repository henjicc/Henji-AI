// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => true,
}));

vi.mock('@/platform/desktopApi', () => ({
  toDisplaySrc: (localPath: string) => `henji-media://local/${encodeURIComponent(localPath)}`,
}));

vi.mock('@/commands/image', () => ({
  loadImage: vi.fn(),
  persistImageSource: vi.fn(),
}));

import { imageUrlToDataUrl, loadImageElement, resolveImageDisplayUrl, toFetchableMediaUrl } from './imageSource';
import { toDisplayAudioSrc } from '@/components/params/panels/minimaxVoiceClone/utils';
import { decodeMediaFileUrl } from '@/utils/mediaFileUrl';

class FakeImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private currentSource = '';

  get src(): string {
    return this.currentSource;
  }

  set src(value: string) {
    this.currentSource = value;
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadImageElement', () => {
  it('本地图片转换为 henji-media 协议后启用匿名跨域，避免污染导出画布', async () => {
    vi.stubGlobal('Image', FakeImage);

    const image = await loadImageElement('D:\\images\\source.png');

    expect(image.crossOrigin).toBe('anonymous');
    expect(image.src).toBe('henji-media://local/D%3A%5Cimages%5Csource.png');
  });
});

describe('图片、声音与 fetch 共用媒体路径解析', () => {
  it.each([
    ['D:\\media\\声音.wav', 'D:\\media\\声音.wav'],
    ['D:/media/声音.wav', 'D:/media/声音.wav'],
    ['\\\\server\\share\\声音.wav', '\\\\server\\share\\声音.wav'],
    ['//server/share/声音.wav', '//server/share/声音.wav'],
    ['file:///D:/media/%E5%A3%B0%E9%9F%B3.wav', 'D:/media/声音.wav'],
    ['file://server/share/%E5%A3%B0%E9%9F%B3.wav', '//server/share/声音.wav'],
    ['file:///C:/media/a%20b.wav', 'C:/media/a b.wav'],
  ])('%s 保留本地路径语义并转为宿主媒体 URL', (source, path) => {
    const expected = `henji-media://local/${encodeURIComponent(path)}`;
    expect(resolveImageDisplayUrl(source)).toBe(expected);
    expect(toDisplayAudioSrc(`  ${source}  `)).toBe(expected);
    expect(toFetchableMediaUrl(source)).toBe(expected);
    if (source.startsWith('file:')) expect(decodeMediaFileUrl(source)).toBe(path);
  });

  it.each([
    '', 'data:audio/wav;base64,AAAA', 'blob:https://example.com/audio',
    'henji-media://local/already-encoded', 'https://example.com/media.wav',
  ])('%s 在所有入口保持不变', source => {
    expect(toDisplayAudioSrc(source)).toBe(source);
    expect(resolveImageDisplayUrl(source)).toBe(source);
    expect(toFetchableMediaUrl(source)).toBe(source);
  });

  it('file URL 读取经可读取解析器，避免把 file:// 直接交给 fetch', async () => {
    const blob = new Blob(['media'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    await imageUrlToDataUrl('file://server/share/image.png');
    expect(fetchMock).toHaveBeenCalledWith('henji-media://local/%2F%2Fserver%2Fshare%2Fimage.png');
  });
});
