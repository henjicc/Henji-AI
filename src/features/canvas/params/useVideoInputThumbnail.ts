import { isLikelyLocalImagePath } from '@/services/imageSource';
import { useMicroThumbnail } from '@/features/canvas/nodes/shared/useCanvasMediaThumbnail';

/** 主进程只能为本机文件抽帧落盘；远程地址仍由浏览器取首帧。 */
export function isLocalVideoSource(url: string): boolean {
  return /^(?:henji-media|file):\/\//i.test(url) || isLikelyLocalImagePath(url);
}

/**
 * 参数行的视频缩略图：本机视频取主进程落盘的首帧图（与素材库共用缓存），不挂 <video>。
 * 画布不做可见裁剪，每个常驻 <video> 都是一个解码器实例。取不到或不是本机地址时返回 null。
 */
export function useVideoInputThumbnail(videoUrl: string | null): string | null {
  return useMicroThumbnail(videoUrl, Boolean(videoUrl && isLocalVideoSource(videoUrl)), 'video');
}
