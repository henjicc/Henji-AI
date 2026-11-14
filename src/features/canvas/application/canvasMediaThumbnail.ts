import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import { isLikelyLocalImagePath, resolveImageDisplayUrl } from '@/services/imageSource';

const logger = createLogger('features.canvas.application.canvasMediaThumbnail');

/**
 * 画布媒体缩略图的唯一入口：节点只存原媒体，缩略图在显示时按原媒体向主进程要。
 * 解码与重编码由主进程在线程池里做，结果按文件身份落进程序缩略图目录（与素材库共用），
 * 重启和换画布都直接命中；缓存被清掉也只是重做一次。渲染层只拿 henji-media 地址，不把它写进节点。
 * 主进程每个任务都把原图整张读进内存再解码，同时进行的任务固定为少量，不随核数放大；
 * 排队也让离开视口的节点能撤掉还没开始的任务。
 */
const MAX_CONCURRENT_GENERATIONS = 4;

/** 节点正文的预览图边长：常规倍率下够清楚，放大到看原图的倍率才换原图。 */
export const CANVAS_PREVIEW_THUMBNAIL_SIZE = 512;

export type CanvasThumbnailKind = 'image' | 'video';

export interface CanvasThumbnailSpec {
  kind: CanvasThumbnailKind;
  /** 原媒体：本机路径、henji-media、http(s)、data 或 blob 地址。 */
  source: string;
  /** 省略为素材库尺寸（远景与低倍率用的微缩略图）。 */
  maxSize?: number;
}

/** 只存显示地址（短字符串），按项数淘汰最久未用的。 */
const thumbnailCache = new Map<string, string | null>();
const MAX_CACHE_ENTRIES = 1024;

export interface CanvasThumbnailRequest {
  /** 图片取不到缩略图时给原图；视频取不到时为 null。 */
  promise: Promise<string | null>;
  release(): void;
}

interface GenerationTask {
  key: string;
  spec: CanvasThumbnailSpec;
  promise: Promise<string | null>;
  resolve: (url: string | null) => void;
  users: number;
  running: boolean;
}

const pendingGenerations = new Map<string, GenerationTask>();

export function canvasThumbnailKey(spec: CanvasThumbnailSpec): string {
  return `${spec.kind}|${spec.maxSize ?? 0}|${spec.source}`;
}

function cacheThumbnail(key: string, url: string | null): void {
  thumbnailCache.set(key, url);
  while (thumbnailCache.size > MAX_CACHE_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest === undefined) break;
    thumbnailCache.delete(oldest);
  }
}

let activeGenerations = 0;
// 按加入顺序调度，取消排队任务为 O(1)，避免切换大画布时逐项扫描队列。
const generationWaiters = new Set<GenerationTask>();

function isLocalMediaSource(src: string): boolean {
  return /^(?:henji-media|file):\/\//i.test(src) || isLikelyLocalImagePath(src);
}

/** 取不到缩略图时的回退：图片用原图（转成可显示地址，调用方可能给的是裸路径），视频不挂解码器，没有封面。 */
function fallback(spec: CanvasThumbnailSpec): string | null {
  return spec.kind === 'image' ? resolveImageDisplayUrl(spec.source) : null;
}

async function generateThumbnail(spec: CanvasThumbnailSpec): Promise<string | null> {
  // 远程、data、blob 地址没有可落盘的文件身份：图片直接用源图，视频由调用方决定是否挂播放器。
  if (!isLocalMediaSource(spec.source)) return fallback(spec);
  const { path } = spec.kind === 'image'
    ? await getPlatform().image.getCachedThumbnail(spec.source, spec.maxSize)
    : await getPlatform().video.getCachedThumbnail(spec.source, undefined, spec.maxSize);
  return resolveImageDisplayUrl(path);
}

/** 命中缓存时同步返回地址；未生成过返回 undefined（不触发生成）。 */
export function getCachedCanvasThumbnail(spec: CanvasThumbnailSpec): string | null | undefined {
  const key = canvasThumbnailKey(spec);
  if (!thumbnailCache.has(key)) return undefined;
  const cached = thumbnailCache.get(key) ?? null;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, cached);
  return cached;
}

async function runGeneration(task: GenerationTask): Promise<void> {
  try {
    const result = await generateThumbnail(task.spec);
    cacheThumbnail(task.key, result);
    task.resolve(result);
  } catch (error) {
    // 失败不进缓存：本次先回退，下次进入视口再试。
    logger.debug('[canvasMediaThumbnail] 生成失败，回退', { kind: task.spec.kind, src: task.spec.source, error: String(error) });
    task.resolve(fallback(task.spec));
  } finally {
    pendingGenerations.delete(task.key);
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
 * 移除排队项并以回退值结束 Promise。已开始的任务保持并发名额，完成后仍可复用结果。
 */
export function requestCanvasThumbnail(spec: CanvasThumbnailSpec): CanvasThumbnailRequest {
  const cached = getCachedCanvasThumbnail(spec);
  if (cached !== undefined) {
    return { promise: Promise.resolve(cached), release: () => undefined };
  }
  const key = canvasThumbnailKey(spec);
  let task = pendingGenerations.get(key);
  if (!task) {
    let resolve!: (url: string | null) => void;
    const promise = new Promise<string | null>((complete) => { resolve = complete; });
    task = { key, spec, promise, resolve, users: 0, running: false };
    pendingGenerations.set(key, task);
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
        pendingGenerations.delete(key);
        retained.resolve(fallback(spec));
      }
    },
  };
}
