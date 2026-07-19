import { isDesktopRuntime } from '@/platform/runtime';
import { toDisplaySrc } from '@/platform/desktopApi';
import { loadImage, persistImageSource } from '@/commands/image';

/**
 * 通用图片源助手:显示链接解析、本地化、元素加载、DataUrl 转换。
 * 供画布、图片编辑器(imageMark)、查看器等多个领域共用,禁止在各领域重复实现。
 */

const LOCAL_PATH_PREFIX_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

function isNativeImageRuntime(): boolean {
  return isDesktopRuntime();
}

export function isLikelyLocalImagePath(imageUrl: string): boolean {
  if (!imageUrl) {
    return false;
  }

  const lower = imageUrl.toLowerCase();
  if (
    lower.startsWith('data:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('blob:') ||
    lower.startsWith('asset:') ||
    lower.startsWith('tauri:') ||
    lower.startsWith('file://')
  ) {
    return false;
  }

  return LOCAL_PATH_PREFIX_PATTERN.test(imageUrl);
}

export function resolveImageDisplayUrl(imageUrl: string): string {
  const lower = imageUrl.toLowerCase();
  if (lower.startsWith('file://')) {
    if (!isNativeImageRuntime()) {
      return imageUrl;
    }

    try {
      const parsed = new URL(imageUrl);
      const decodedPathname = decodeURIComponent(parsed.pathname);
      const normalizedPath = decodedPathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
      if (!normalizedPath) {
        return imageUrl;
      }
      return toDisplaySrc(normalizedPath);
    } catch {
      return imageUrl;
    }
  }

  if (!isLikelyLocalImagePath(imageUrl)) {
    return imageUrl;
  }

  if (!isNativeImageRuntime()) {
    return imageUrl;
  }

  return toDisplaySrc(imageUrl);
}

export async function persistImageLocally(source: string): Promise<string> {
  if (isLikelyLocalImagePath(source)) {
    return source;
  }

  if (!isNativeImageRuntime()) {
    return source;
  }

  return await persistImageSource(source);
}

export async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = resolveImageDisplayUrl(source);
  if (
    displaySource.startsWith('http://') ||
    displaySource.startsWith('https://') ||
    displaySource.startsWith('asset:')
  ) {
    image.crossOrigin = 'anonymous';
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = displaySource;
  });
}

export async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  if (isLikelyLocalImagePath(imageUrl)) {
    if (isNativeImageRuntime()) {
      return await loadImage(imageUrl);
    }
    const localResponse = await fetch(resolveImageDisplayUrl(imageUrl));
    if (!localResponse.ok) {
      throw new Error('无法读取本地图片数据');
    }
    const localBlob = await localResponse.blob();
    return await blobToDataUrl(localBlob);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error('无法下载图片数据');
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  const reader = new FileReader();

  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
