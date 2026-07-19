import { useEffect, useState } from 'react';

import {
  ensureMicroThumbnail,
  getCachedMicroThumbnail,
} from '@/features/canvas/application/microThumbnail';

interface MicroThumbEntry {
  src: string;
  url: string;
}

/**
 * 低倍率下为媒体节点提供微缩略图地址。
 * active 为 true 时按需生成（后台队列、会话级缓存），生成完成前返回 null（调用方继续用原缩略图，不闪空白）；
 * active 为 false 时恒返回 null，不触发任何生成。
 */
export function useMicroThumbnail(src: string | null, active: boolean): string | null {
  const [entry, setEntry] = useState<MicroThumbEntry | null>(() => {
    if (!src) {
      return null;
    }
    const cached = getCachedMicroThumbnail(src);
    return cached ? { src, url: cached } : null;
  });

  useEffect(() => {
    if (!active || !src) {
      return;
    }
    const cached = getCachedMicroThumbnail(src);
    if (cached) {
      setEntry((current) => (current?.src === src ? current : { src, url: cached }));
      return;
    }

    let cancelled = false;
    void ensureMicroThumbnail(src).then((url) => {
      if (!cancelled) {
        setEntry({ src, url });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [src, active]);

  return active && src && entry?.src === src ? entry.url : null;
}
