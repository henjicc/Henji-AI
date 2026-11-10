import { createLogger } from '@/core/logging'
import { isDesktopRuntime } from '@/platform/runtime';
import { renderImagePreviewDataUrl, type ImagePreviewMime } from '@/core/imageEdit/preview';

const logger = createLogger('features.canvas.application.imageData')

import {
  prepareNodeImageSource,
} from '@/commands/image';
import {
  blobToDataUrl,
  canvasToDataUrl,
  imageUrlToDataUrl,
  loadImageElement,
  persistImageLocally,
  resolveImageDisplayUrl,
} from '@/services/imageSource';

// 通用图片源助手已抽至 services/imageSource,此处 re-export 维持既有导入路径。
export {
  blobToDataUrl,
  canvasToDataUrl,
  loadImageElement,
  persistImageLocally,
  resolveImageDisplayUrl,
};

export function parseAspectRatio(value: string): number {
  const [width, height] = value.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

export function reduceAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '1:1';
  }

  const gcd = greatestCommonDivisor(Math.round(width), Math.round(height));
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }

  return x || 1;
}

const DEFAULT_PREVIEW_MAX_DIMENSION = 512;

export interface PreparedNodeImage {
  imageUrl: string;
  previewImageUrl: string;
  aspectRatio: string;
  createdFilePaths: string[];
}

const ORIGINAL_IMAGE_ZOOM_THRESHOLD = 1.45;

function isNativeImageRuntime(): boolean {
  return isDesktopRuntime();
}

export function shouldUseOriginalImageByZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= ORIGINAL_IMAGE_ZOOM_THRESHOLD;
}

export async function detectAspectRatio(imageUrl: string): Promise<string> {
  const image = await loadImageElement(imageUrl);
  return reduceAspectRatio(image.naturalWidth, image.naturalHeight);
}

function resolvePreviewMimeType(imageUrl: string): ImagePreviewMime {
  if (imageUrl.startsWith('data:image/png')) {
    return 'image/png';
  }
  if (imageUrl.startsWith('data:image/webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

export async function prepareNodeImage(
  imageUrl: string,
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<PreparedNodeImage> {
  const started = performance.now();
  if (isNativeImageRuntime()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const nativeStarted = performance.now();
    const prepared = await prepareNodeImageSource(imageUrl, safeMaxDimension);
    logger.info(
      `[upload-perf][imageData] prepareNodeImage native-source elapsed=${Math.round(performance.now() - nativeStarted)}ms total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: prepared.imagePath,
      previewImageUrl: prepared.previewImagePath,
      aspectRatio: prepared.aspectRatio,
      createdFilePaths: prepared.createdFilePaths,
    };
  }

  const persistedImagePath = await persistImageLocally(imageUrl);
  const normalizedDataUrl = await imageUrlToDataUrl(persistedImagePath);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
  const previewDataUrl = renderImagePreviewDataUrl(image, normalizedDataUrl, safeMaxDimension, resolvePreviewMimeType(normalizedDataUrl));
  const previewImagePath =
    previewDataUrl === normalizedDataUrl
      ? persistedImagePath
      : await persistImageLocally(previewDataUrl);

  logger.info(
    `[upload-perf][imageData] prepareNodeImage browser-fallback total=${Math.round(performance.now() - started)}ms`
  );
  return {
    imageUrl: persistedImagePath,
    previewImageUrl: previewImagePath,
    aspectRatio: reduceAspectRatio(image.naturalWidth, image.naturalHeight),
    createdFilePaths: [],
  };
}
