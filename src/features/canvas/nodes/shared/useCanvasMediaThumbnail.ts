import { useEffect, useMemo, useState } from 'react';

import {
  CANVAS_PREVIEW_THUMBNAIL_SIZE,
  canvasThumbnailKey,
  getCachedCanvasThumbnail,
  requestCanvasThumbnail,
  type CanvasThumbnailKind,
  type CanvasThumbnailSpec,
} from '@/features/canvas/application/canvasMediaThumbnail';
import { isProgramThumbnailLocation } from '@/core/documents/kinds/canvas';
import { resolveImageDisplayUrl } from '@/services/imageSource';

/** 作品自带的预览；空值与指向程序缩略图目录的旧值（撤销记录、剪贴板带回来的）都算没有。 */
function workPreview(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() && !isProgramThumbnailLocation(value) ? value : null;
}

interface ThumbnailEntry {
  key: string;
  url: string | null;
}

/**
 * 按原媒体取缩略图（后台队列、会话级缓存）。spec 为 null 时不生成、返回 null；
 * 生成完成前返回 undefined，调用方决定这段时间显示什么。spec 须按内容记忆，换对象就是换请求。
 */
function useCanvasThumbnail(spec: CanvasThumbnailSpec | null): string | null | undefined {
  const key = spec ? canvasThumbnailKey(spec) : null;
  const [entry, setEntry] = useState<ThumbnailEntry | null>(() => {
    if (!spec || !key) return null;
    const cached = getCachedCanvasThumbnail(spec);
    return cached === undefined ? null : { key, url: cached };
  });

  useEffect(() => {
    if (!spec || !key) return;
    const cached = getCachedCanvasThumbnail(spec);
    if (cached !== undefined) {
      setEntry((current) => (current?.key === key ? current : { key, url: cached }));
      return;
    }
    let cancelled = false;
    const request = requestCanvasThumbnail(spec);
    void request.promise.then((url) => {
      if (!cancelled) setEntry({ key, url });
    });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [key, spec]);

  if (!spec || !key) return null;
  if (entry?.key === key) return entry.url;
  // 换了来源而新来源已在缓存里：本次渲染就用上，不空一帧。
  const cached = getCachedCanvasThumbnail(spec);
  return cached === undefined ? undefined : cached;
}

/**
 * 低倍率下为媒体节点提供微缩略图地址。
 * active 为 true 时按需生成，生成完成前返回 null（调用方继续用原缩略图，不闪空白）；
 * active 为 false 时恒返回 null，不触发任何生成。
 */
export function useMicroThumbnail(src: string | null, active: boolean, kind: CanvasThumbnailKind = 'image'): string | null {
  const spec = useMemo<CanvasThumbnailSpec | null>(
    () => (active && src ? { kind, source: src } : null),
    [active, kind, src],
  );
  return useCanvasThumbnail(spec) ?? null;
}

/**
 * 节点正文的预览图：节点数据里存了作品自带的预览（生成结果的封面、编辑结果的预览）就用它；
 * 只存了原媒体的（导入、素材库拖入）按原媒体取缓存缩略图，不把缩略图地址写回节点。
 * 取缩略图期间返回 undefined（视频节点据此不先挂播放器），没有可显示的预览返回 null。
 */
export function useCanvasMediaPreview(
  kind: CanvasThumbnailKind,
  source: string | null | undefined,
  storedPreview: string | null | undefined,
): string | null | undefined {
  const stored = workPreview(storedPreview);
  const spec = useMemo<CanvasThumbnailSpec | null>(
    () => (!stored && source ? { kind, source, maxSize: CANVAS_PREVIEW_THUMBNAIL_SIZE } : null),
    [kind, source, stored],
  );
  const derived = useCanvasThumbnail(spec);
  return stored ? resolveImageDisplayUrl(stored) : derived;
}

/** 微缩略图的来源：作品自带的预览，没有就用原图（不对派生的预览缩略图再取一次）。 */
export function microThumbnailSource(storedPreview: string | null | undefined, original: string | null | undefined): string | null {
  const source = workPreview(storedPreview) ?? original ?? null;
  return source ? resolveImageDisplayUrl(source) : null;
}

/**
 * 一组媒体的微缩略图（提示词里的引用标签等列表）：按缓存键返回已取到的地址，未取到的不在表里。
 * specs 须按内容记忆（内容不变就沿用同一个数组），否则每次渲染都会重排请求。
 */
export function useCanvasThumbnails(specs: readonly CanvasThumbnailSpec[]): ReadonlyMap<string, string | null> {
  // 已在缓存里的先填上：节点重新挂上时标签不空一帧。
  const [resolved, setResolved] = useState<ReadonlyMap<string, string | null>>(() => {
    const cached = new Map<string, string | null>();
    for (const spec of specs) {
      const url = getCachedCanvasThumbnail(spec);
      if (url !== undefined) cached.set(canvasThumbnailKey(spec), url);
    }
    return cached;
  });
  useEffect(() => {
    let cancelled = false;
    const requests = specs.map((spec) => {
      const key = canvasThumbnailKey(spec);
      const request = requestCanvasThumbnail(spec);
      void request.promise.then((url) => {
        if (!cancelled) setResolved((current) => (current.get(key) === url ? current : new Map(current).set(key, url)));
      });
      return request;
    });
    return () => {
      cancelled = true;
      requests.forEach((request) => request.release());
    };
  }, [specs]);
  return resolved;
}
