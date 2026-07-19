import { createLogger } from '@/core/logging';

import { loadImageElement } from './imageData';

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
 * src → 微缩略图地址（blob: URL，或源图本身已足够小时等于 src）。
 * 会话级缓存、不淘汰：单张 webp 微图约 5~15KB，数百媒体节点合计仅数 MB，
 * 淘汰反而有 blob URL 被在显节点引用后失效的风险。
 */
const microThumbCache = new Map<string, string>();
const pendingGenerations = new Map<string, Promise<string>>();

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
  return URL.createObjectURL(blob);
}

/** 命中缓存时同步返回微缩略图地址，未生成过返回 null（不触发生成） */
export function getCachedMicroThumbnail(src: string): string | null {
  return microThumbCache.get(src) ?? null;
}

/** 确保 src 的微缩略图已生成（带并发限制与去重）；失败时缓存源图本身避免反复重试 */
export function ensureMicroThumbnail(src: string): Promise<string> {
  const cached = microThumbCache.get(src);
  if (cached) {
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
      microThumbCache.set(src, result);
      return result;
    } catch (error) {
      logger.debug('[microThumbnail] 生成失败，回退源图', { src, error: String(error) });
      microThumbCache.set(src, src);
      return src;
    } finally {
      releaseGenerationSlot();
      pendingGenerations.delete(src);
    }
  })();
  pendingGenerations.set(src, task);
  return task;
}
