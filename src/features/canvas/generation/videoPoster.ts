import { createLogger } from '@/core/logging';

import {
  persistImageLocally,
  reduceAspectRatio,
  resolveImageDisplayUrl,
} from '../application/imageData';

const logger = createLogger('features.canvas.generation.videoPoster');

const POSTER_MAX_DIMENSION = 512;
const POSTER_CAPTURE_TIME_SEC = 0;
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

const ASPECT_RATIO_PROBE_TIMEOUT_MS = 5_000;

/**
 * 只读取视频元数据（宽高），不等待帧抓取，用于上传时尽快拿到宽高比让节点立即重新适配。
 * 比 captureVideoPoster 快得多：不需要 seek 到具体帧再绘制 canvas。
 * 有主进程可用时优先走 ffprobe（无需加载整段视频），失败（如 blob: URL 主进程无法解析）时回退 HTML5 探测。
 */
export async function detectVideoAspectRatioFromSource(videoSource: string): Promise<string> {
  if (window.henjiNative) {
    try {
      const info = await window.henjiNative.video.readVideoInfo(videoSource);
      return reduceAspectRatio(info.width, info.height);
    } catch {
      // 主进程无法解析该来源（如尚未落盘的 blob: URL），走下面的渲染层后备逻辑
    }
  }
  return detectVideoAspectRatioFallback(videoSource);
}

function detectVideoAspectRatioFallback(videoSource: string): Promise<string> {
  const displayUrl = resolveImageDisplayUrl(videoSource);

  return new Promise<string>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeAttribute('src');
      video.load();
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('视频宽高探测超时'));
    }, ASPECT_RATIO_PROBE_TIMEOUT_MS);

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      const ratio = video.videoWidth && video.videoHeight
        ? reduceAspectRatio(video.videoWidth, video.videoHeight)
        : '16:9';
      cleanup();
      resolve(ratio);
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('视频宽高探测失败'));
    };
    video.src = displayUrl;
  });
}

/**
 * 抓取视频首帧作为 poster 并落盘，同时返回宽高比与时长。
 * 有主进程可用时优先并行调用 ffprobe（宽高/时长）+ ffmpeg（首帧截图），失败时回退渲染层 HTML5 Video。
 * 失败时降级返回空 poster（节点回退到图标占位）。
 */
export async function captureVideoPoster(videoSource: string): Promise<VideoPosterInfo> {
  if (window.henjiNative) {
    try {
      const info = await window.henjiNative.video.readVideoInfo(videoSource);
      const thumbnail = await window.henjiNative.video.generateThumbnail({
        source: videoSource,
        timeOffsetSeconds: POSTER_CAPTURE_TIME_SEC,
        knownDurationSeconds: info.durationSeconds,
      });
      const posterUrl = await persistImageLocally(thumbnail.dataUrl);
      return {
        posterUrl,
        aspectRatio: reduceAspectRatio(info.width, info.height),
        durationSec: info.durationSeconds,
      };
    } catch (error) {
      logger.warn('[videoPoster] 主进程截帧失败，回退渲染层', error);
    }
  }
  return captureVideoPosterFallback(videoSource);
}

async function captureVideoPosterFallback(videoSource: string): Promise<VideoPosterInfo> {
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
          video.currentTime = 0;
        } catch {
          settle(null);
        }
      };
      // currentTime 已经是 0 时浏览器不一定触发 seeked，loadeddata 才是首帧可绘制的稳定信号。
      video.onloadeddata = () => settle(drawPosterDataUrl(video));
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
