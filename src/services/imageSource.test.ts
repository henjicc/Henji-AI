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

import { loadImageElement } from './imageSource';

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
