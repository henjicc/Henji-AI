import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import { isLikelyLocalImagePath, resolveImageDisplayUrl } from '@/services/imageSource';

const logger = createLogger('features.canvas.application.microThumbnail');

/**
 * 解码与重编码由主进程在线程池里做，结果按文件身份落进程序缩略图目录（与素材库共用），
 * 重启和换画布都直接命中；渲染层只拿 henji-media 地址。
 * 主进程每个任务都把原图整张读进内存再解码，同时进行的任务固定为少量，不随核数放大；
 * 排队也让离开视口的节点能撤掉还没开始的任务。
 */
const MAX_CONCURRENT_GENERATIONS = 4;

/** 只存显示地址（短字符串），按项数淘汰最久未用的。 */
const microThumbCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 1024;
export interface MicroThumbnailRequest {
  promise: Promise<string>;
  release(): void;
}

interface GenerationTask {
  src: string;
  promise: Promise<string>;
  resolve: (url: string) => void;
  users: number;
  running: boolean;
}

const pendingGenerations = new Map<string, GenerationTask>();

function cacheThumbnail(src: string, url: string): void {
  microThumbCache.set(src, url);
  while (microThumbCache.size > MAX_CACHE_ENTRIES) {
    const oldest = microThumbCache.keys().next().value;
    if (oldest === undefined) break;
    microThumbCache.delete(oldest);
  }
}

let activeGenerations = 0;
// 按加入顺序调度，取消排队任务为 O(1)，避免切换大画布时逐项扫描队列。
const generationWaiters = new Set<GenerationTask>();

function isLocalMediaSource(src: string): boolean {
  return /^(?:henji-media|file):\/\//i.test(src) || isLikelyLocalImagePath(src);
}

async function generateMicroThumbnail(src: string): Promise<string> {
  // 远程、data、blob 地址没有可落盘的文件身份，直接用源图。
  if (!isLocalMediaSource(src)) return src;
  const { path } = await getPlatform().image.getCachedThumbnail(src);
  return resolveImageDisplayUrl(path);
}

/** 命中缓存时同步返回微缩略图地址，未生成过返回 null（不触发生成） */
export function getCachedMicroThumbnail(src: string): string | null {
  const cached = microThumbCache.get(src);
  if (cached === undefined) return null;
  microThumbCache.delete(src);
  microThumbCache.set(src, cached);
  return cached;
}

async function runGeneration(task: GenerationTask): Promise<void> {
  try {
    const result = await generateMicroThumbnail(task.src);
    cacheThumbnail(task.src, result);
    task.resolve(result);
  } catch (error) {
    // 失败不进缓存：本次先显示源图，下次进入视口再试。
    logger.debug('[microThumbnail] 生成失败，回退源图', { src: task.src, error: String(error) });
    task.resolve(task.src);
  } finally {
    pendingGenerations.delete(task.src);
    activeGenerations -= 1;
    drainGenerationQueue();
  }
}

function drainGenerationQueue(): void {
  while (activeGenerations < MAX_CONCURRENT_GENERATIONS) {
    const task = generationWaiters.values().next().value;
    if (!task) return;
    generationWaiters.delete(task);
    task.running = true;
    activeGenerations += 1;
    void runGeneration(task);
  }
}

/**
 * 共用同源生成任务；调用方离开时 release。最后一个使用者释放尚未开始的任务时，
 * 移除排队项并以源图结束 Promise。已开始的任务保持并发名额，完成后仍可复用结果。
 */
export function requestMicroThumbnail(src: string): MicroThumbnailRequest {
  const cached = getCachedMicroThumbnail(src);
  if (cached !== null) {
    return { promise: Promise.resolve(cached), release: () => undefined };
  }
  let task = pendingGenerations.get(src);
  if (!task) {
    let resolve!: (url: string) => void;
    const promise = new Promise<string>((complete) => { resolve = complete; });
    task = { src, promise, resolve, users: 0, running: false };
    pendingGenerations.set(src, task);
    generationWaiters.add(task);
  }
  task.users += 1;
  drainGenerationQueue();
  let released = false;
  const retained = task;
  return {
    promise: retained.promise,
    release: () => {
      if (released) return;
      released = true;
      retained.users -= 1;
      if (retained.users === 0 && !retained.running && generationWaiters.delete(retained)) {
        pendingGenerations.delete(src);
        retained.resolve(src);
      }
    },
  };
}
