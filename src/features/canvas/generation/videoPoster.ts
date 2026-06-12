import { createLogger } from '@/core/logging';

import {
  persistImageLocally,
  reduceAspectRatio,
  resolveImageDisplayUrl,
} from '../application/imageData';

const logger = createLogger('features.canvas.generation.videoPoster');

const POSTER_MAX_DIMENSION = 512;
const POSTER_CAPTURE_TIME_SEC = 0.1;
const POSTER_TIMEOUT_MS = 15_000;

export interface VideoPosterInfo {
  /** 首帧 poster 本地路径（失败时为 null） */
  posterUrl: string | null;
  aspectRatio: string;
  durationSec: number | null;
}

function drawPosterDataUrl(video: HTMLVideoElement): string | null {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) {
    return null;
  }

  const longestSide = Math.max(videoWidth, videoHeight);
  const scale = longestSide > POSTER_MAX_DIMENSION ? POSTER_MAX_DIMENSION / longestSide : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(videoWidth * scale));
  canvas.height = Math.max(1, Math.round(videoHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 抓取视频首帧作为 poster 并落盘，同时返回宽高比与时长。
 * 失败时降级返回空 poster（节点回退到图标占位）。
 */
export async function captureVideoPoster(videoSource: string): Promise<VideoPosterInfo> {
  const displayUrl = resolveImageDisplayUrl(videoSource);

  const captured = await new Promise<{ dataUrl: string | null; aspectRatio: string; durationSec: number | null }>(
    (resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';

      let settled = false;
      const settle = (dataUrl: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        const aspectRatio = video.videoWidth && video.videoHeight
          ? reduceAspectRatio(video.videoWidth, video.videoHeight)
          : '16:9';
        const durationSec = Number.isFinite(video.duration) ? video.duration : null;
        video.removeAttribute('src');
        video.load();
        resolve({ dataUrl, aspectRatio, durationSec });
      };

      const timeoutId = window.setTimeout(() => settle(null), POSTER_TIMEOUT_MS);

      video.onloadedmetadata = () => {
        try {
          video.currentTime = Math.min(POSTER_CAPTURE_TIME_SEC, Math.max(0, video.duration - 0.01));
        } catch {
          settle(null);
        }
      };
      video.onseeked = () => settle(drawPosterDataUrl(video));
      video.onerror = () => settle(null);
      video.src = displayUrl;
    }
  );

  if (!captured.dataUrl) {
    logger.warn('[videoPoster] 首帧抓取失败，使用占位展示', { videoSource });
    return { posterUrl: null, aspectRatio: captured.aspectRatio, durationSec: captured.durationSec };
  }

  try {
    const posterUrl = await persistImageLocally(captured.dataUrl);
    return { posterUrl, aspectRatio: captured.aspectRatio, durationSec: captured.durationSec };
  } catch (error) {
    logger.warn('[videoPoster] poster 落盘失败', error);
    return { posterUrl: null, aspectRatio: captured.aspectRatio, durationSec: captured.durationSec };
  }
}
