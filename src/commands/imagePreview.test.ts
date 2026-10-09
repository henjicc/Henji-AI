// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createImagePreviewPlan, renderImagePreviewDataUrl } from '@/core/imageEdit/preview';

const mocks = vi.hoisted(() => ({
  image: { naturalWidth: 1601, naturalHeight: 900 } as HTMLImageElement,
}));
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: vi.fn() }));
vi.mock('./imageCommandShared', () => ({
  isNativeImageRuntime: () => false,
  loadImageElement: async () => mocks.image,
  sourceToDataUrl: async (source: string) => source,
  reduceAspectRatio: () => '1601:900',
}));
vi.mock('./imagePersistenceCommands', () => ({ persistImageSource: async (source: string) => source }));
vi.mock('@/services/imageSource', () => ({
  loadImageElement: async () => mocks.image,
  imageUrlToDataUrl: async (source: string) => source,
}));

import { prepareNodeImageSource } from './image';
import { createPreviewDataUrl } from '@/features/canvas/application/imageData';

afterEach(() => { vi.restoreAllMocks(); });

function mockCanvas(): Array<{ width: number; height: number; args: unknown[] }> {
  const encoded: Array<{ width: number; height: number; args: unknown[] }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement, ...args) {
    encoded.push({ width: this.width, height: this.height, args });
    return `data:${args[0]};base64,preview`;
  });
  return encoded;
}

it.each(['png', 'webp', 'jpeg'])('两入口缩放同一 %s 图片至同尺寸，保持各自编码策略', async extension => {
  const encoded = mockCanvas();
  const source = `data:image/${extension};base64,source`;
  const command = await prepareNodeImageSource(source, 512);
  const canvas = await createPreviewDataUrl(source, 512);
  expect(encoded).toEqual([
    { width: 512, height: 288, args: ['image/jpeg', 0.86] },
    { width: 512, height: 288, args: extension === 'jpeg' ? ['image/jpeg', 0.86] : [`image/${extension}`] },
  ]);
  expect(command.previewImagePath).toBe('data:image/jpeg;base64,preview');
  expect(canvas).toBe(`data:image/${extension};base64,preview`);
});

it('不放大图片，竖图和极窄图片保留宽高比及至少一像素', () => {
  expect(createImagePreviewPlan(80, 40, 512, 'image/png')).toEqual({ width: 80, height: 40, mime: 'image/png' });
  expect(createImagePreviewPlan(900, 1601, 512, 'image/webp')).toEqual({ width: 288, height: 512, mime: 'image/webp' });
  expect(createImagePreviewPlan(1, 10000, 512, 'image/jpeg')).toEqual({ width: 1, height: 512, mime: 'image/jpeg', quality: 0.86 });
});

it('尺寸无需缩小或无法获取绘制上下文时保留原始数据', () => {
  const create = vi.spyOn(document, 'createElement');
  expect(renderImagePreviewDataUrl(mocks.image, 'source', 2000, 'image/png')).toBe('source');
  expect(create).not.toHaveBeenCalled();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  expect(renderImagePreviewDataUrl(mocks.image, 'source', 512, 'image/png')).toBe('source');
});
