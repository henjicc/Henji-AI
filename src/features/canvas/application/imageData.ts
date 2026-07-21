import { createLogger } from '@/core/logging'
import { isDesktopRuntime } from '@/platform/runtime';

const logger = createLogger('features.canvas.application.imageData')

import {
  prepareNodeImageBinary,
  prepareNodeImageSource,
} from '@/commands/image';
import {
  blobToDataUrl,
  canvasToDataUrl,
  imageUrlToDataUrl,
  isLikelyLocalImagePath,
  loadImageElement,
  persistImageLocally,
  readFileAsDataUrl,
  resolveImageDisplayUrl,
} from '@/services/imageSource';

// 通用图片源助手已抽至 services/imageSource,此处 re-export 维持既有导入路径。
export {
  blobToDataUrl,
  canvasToDataUrl,
  imageUrlToDataUrl,
  isLikelyLocalImagePath,
  loadImageElement,
  persistImageLocally,
  readFileAsDataUrl,
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
}

const ORIGINAL_IMAGE_ZOOM_THRESHOLD = 1.45;

function isNativeImageRuntime(): boolean {
  return isDesktopRuntime();
}

export function shouldUseOriginalImageByZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= ORIGINAL_IMAGE_ZOOM_THRESHOLD;
}

export function extractBase64Payload(dataUrl: string): string {
  const [, payload = ''] = dataUrl.split(',');
  return payload;
}

function resolveFileExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  if (mime === 'image/tiff') return 'tiff';
  if (mime === 'image/avif') return 'avif';

  const name = file.name.trim();
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  return 'png';
}

export async function prepareNodeImageFromFile(
  file: File,
  maxPreviewDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<PreparedNodeImage> {
  const started = performance.now();
  const nativeFilePath = (file as File & { path?: string }).path;
  const normalizedPath = typeof nativeFilePath === 'string' ? nativeFilePath.trim() : '';
  const canUseLocalPath =
    normalizedPath.length > 0
    && (isLikelyLocalImagePath(normalizedPath) || normalizedPath.toLowerCase().startsWith('file://'));
  if (canUseLocalPath) {
    const prepared = await prepareNodeImage(normalizedPath, maxPreviewDimension);
    logger.info(
      `[upload-perf][imageData] prepareNodeImageFromFile path-mode name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - started)}ms`
    );
    return prepared;
  }

  if (isNativeImageRuntime()) {
    const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
    const readStarted = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const readElapsed = Math.round(performance.now() - readStarted);
    const extension = resolveFileExtension(file);
    const nativeStarted = performance.now();
    const prepared = await prepareNodeImageBinary(bytes, extension, safeMaxDimension);
    const nativeElapsed = Math.round(performance.now() - nativeStarted);
    logger.info(
      `[upload-perf][imageData] prepareNodeImageFromFile binary-mode name="${file.name}" size=${file.size}B readArrayBuffer=${readElapsed}ms nativePrepare=${nativeElapsed}ms total=${Math.round(performance.now() - started)}ms`
    );
    return {
      imageUrl: prepared.imagePath,
      previewImageUrl: prepared.previewImagePath,
      aspectRatio: prepared.aspectRatio,
    };
  }

  const dataUrlStarted = performance.now();
  const source = await readFileAsDataUrl(file);
  const dataUrlElapsed = Math.round(performance.now() - dataUrlStarted);
  const prepared = await prepareNodeImage(source, maxPreviewDimension);
  logger.info(
    `[upload-perf][imageData] prepareNodeImageFromFile dataurl-fallback name="${file.name}" size=${file.size}B readDataUrl=${dataUrlElapsed}ms total=${Math.round(performance.now() - started)}ms`
  );
  return prepared;
}

export async function detectAspectRatio(imageUrl: string): Promise<string> {
  const image = await loadImageElement(imageUrl);
  return reduceAspectRatio(image.naturalWidth, image.naturalHeight);
}

function resolvePreviewMimeType(imageUrl: string): string {
  if (imageUrl.startsWith('data:image/png')) {
    return 'image/png';
  }
  if (imageUrl.startsWith('data:image/webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function renderPreviewDataUrl(
  image: HTMLImageElement,
  sourceDataUrl: string,
  maxDimension: number
): string {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (longestSide <= maxDimension) {
    return sourceDataUrl;
  }

  const scale = maxDimension / longestSide;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return sourceDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const mimeType = resolvePreviewMimeType(sourceDataUrl);
  if (mimeType === 'image/jpeg') {
    return canvas.toDataURL(mimeType, 0.86);
  }
  return canvas.toDataURL(mimeType);
}

export async function createPreviewDataUrl(
  imageUrl: string,
  maxDimension = DEFAULT_PREVIEW_MAX_DIMENSION
): Promise<string> {
  const normalizedDataUrl = await imageUrlToDataUrl(imageUrl);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxDimension));
  return renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
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
    };
  }

  const persistedImagePath = await persistImageLocally(imageUrl);
  const normalizedDataUrl = await imageUrlToDataUrl(persistedImagePath);
  const image = await loadImageElement(normalizedDataUrl);
  const safeMaxDimension = Math.max(64, Math.floor(maxPreviewDimension));
  const previewDataUrl = renderPreviewDataUrl(image, normalizedDataUrl, safeMaxDimension);
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
  };
}
