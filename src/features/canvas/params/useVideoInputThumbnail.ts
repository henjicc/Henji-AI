import { useEffect, useState } from 'react';

import { getPlatform } from '@/platform';
import { isLikelyLocalImagePath } from '@/services/imageSource';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';

/** 主进程只能为本机文件抽帧落盘；远程地址仍由浏览器取首帧。 */
export function isLocalVideoSource(url: string): boolean {
  return /^(?:henji-media|file):\/\//i.test(url) || isLikelyLocalImagePath(url);
}

/**
 * 参数行的视频缩略图：本机视频取主进程落盘的首帧图（与素材库共用缓存），不挂 <video>。
 * 画布不做可见裁剪，每个常驻 <video> 都是一个解码器实例。取不到或不是本机地址时返回 null。
 */
export function useVideoInputThumbnail(videoUrl: string | null): string | null {
  const [thumbnail, setThumbnail] = useState<{ source: string; url: string } | null>(null);
  useEffect(() => {
    if (!videoUrl || !isLocalVideoSource(videoUrl)) return;
    const controller = new AbortController();
    void getPlatform().video.getCachedThumbnail(videoUrl, controller.signal).then(({ path }) => {
      if (!controller.signal.aborted) setThumbnail({ source: videoUrl, url: resolveImageDisplayUrl(path) });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [videoUrl]);
  return videoUrl && thumbnail?.source === videoUrl ? thumbnail.url : null;
}
