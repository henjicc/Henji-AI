import { createLogger } from '@/core/logging';

import { blobToDataUrl, loadImageElement } from './imageData';

const logger = createLogger('features.canvas.application.microThumbnail');

/**
 * 微缩略图最长边。取值依据：媒体节点常见宽度 ~320px，低倍率阈值 ≤0.6，
 * 屏显尺寸 ≤ 320 × 0.6 ≈ 192 CSS px，2x DPR 下 ≈ 384 设备像素；
 * 256 在"平衡"阈值（0.4 → 256 设备像素）下逐像素对齐，视觉无损。
 */
const MICRO_THUMB_MAX_DIMENSION = 256;
/** 源图最长边不超过该值时不再降采样（重编码得不偿失），直接复用源地址 */
const MICRO_THUMB_SKIP_DIMENSION = Math.round(MICRO_THUMB_MAX_DIMENSION * 1.25);
/** 同时生成的微缩略图数量上限，避免跨越阈值时上百个节点同时解码造成主线程风暴 */
const MAX_CONCURRENT_GENERATIONS = 2;

/**
 * 用可独立持有的 data URL 缓存同一份 WebP 编码，避免永久注册 blob URL。
 * 淘汰只释放缓存引用；节点及预解码切换仍可持有旧地址，不会因淘汰变成空白。
 * 项数与字符串字节估算双重限额，防止长会话、失败源或长 data URL 持续累积。
 */
const microThumbCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 1024;
const MAX_CACHE_STRING_BYTES = 32 * 1024 * 1024;
let cachedStringBytes = 0;
const pendingGenerations = new Map<string, Promise<string>>();

function cacheThumbnail(src: string, url: string): void {
  const bytes = (src.length + url.length) * 2;
  if (bytes > MAX_CACHE_STRING_BYTES) return;
  microThumbCache.set(src, url);
  cachedStringBytes += bytes;
  while (microThumbCache.size > MAX_CACHE_ENTRIES || cachedStringBytes > MAX_CACHE_STRING_BYTES) {
    const oldest = microThumbCache.entries().next().value;
    if (!oldest) break;
    microThumbCache.delete(oldest[0]);
    cachedStringBytes -= (oldest[0].length + oldest[1].length) * 2;
  }
}

let activeGenerations = 0;
const generationWaiters: Array<() => void> = [];

async function acquireGenerationSlot(): Promise<void> {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    await new Promise<void>((resolve) => generationWaiters.push(resolve));
  }
  activeGenerations += 1;
}

function releaseGenerationSlot(): void {
  activeGenerations -= 1;
  generationWaiters.shift()?.();
}

async function generateMicroThumbnail(src: string): Promise<string> {
  const image = await loadImageElement(src);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestSide || longestSide <= MICRO_THUMB_SKIP_DIMENSION) {
    return src;
  }

  const scale = MICRO_THUMB_MAX_DIMENSION / longestSide;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return src;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // webp 保留透明通道；跨域被污染的 canvas 会在 toBlob 抛错，走 catch 回退源图
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.8);
  });
  if (!blob) {
    return src;
  }
  return blobToDataUrl(blob);
}

/** 命中缓存时同步返回微缩略图地址，未生成过返回 null（不触发生成） */
export function getCachedMicroThumbnail(src: string): string | null {
  const cached = microThumbCache.get(src);
  if (cached === undefined) return null;
  microThumbCache.delete(src);
  microThumbCache.set(src, cached);
  return cached;
}

/** 确保 src 的微缩略图已生成（带并发限制与去重）；失败时缓存源图本身避免反复重试 */
export function ensureMicroThumbnail(src: string): Promise<string> {
  const cached = getCachedMicroThumbnail(src);
  if (cached !== null) {
    return Promise.resolve(cached);
  }
  const pending = pendingGenerations.get(src);
  if (pending) {
    return pending;
  }

  const task = (async () => {
    await acquireGenerationSlot();
    try {
      const result = await generateMicroThumbnail(src);
      cacheThumbnail(src, result);
      return result;
    } catch (error) {
      logger.debug('[microThumbnail] 生成失败，回退源图', { src, error: String(error) });
      cacheThumbnail(src, src);
      return src;
    } finally {
      releaseGenerationSlot();
      pendingGenerations.delete(src);
    }
  })();
  pendingGenerations.set(src, task);
  return task;
}
