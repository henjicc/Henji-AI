import { createLogger } from '@/core/logging';
import { saveAudioFromUrl, saveVideoFromUrl } from '@/utils/save';
import { getAudioDuration } from '@/utils/mediaDimensions';

import { prepareNodeImage, resolveImageDisplayUrl } from '../application/imageData';
import { captureVideoPoster } from './videoPoster';
import type { CanvasMediaType } from './runGeneration';

const logger = createLogger('features.canvas.generation.mediaResultPersist');

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * 将生成结果落地为结果节点的 data 补丁。
 * 媒体一律以本地路径/URL 形式存储，禁止把 data:URL 写入节点 data
 * （图片经 prepareNodeImage 落盘并生成缩略图；视频抓首帧 poster；音频探测时长）。
 */
export async function persistGenerationResult(
  mediaType: CanvasMediaType,
  output: string
): Promise<DynamicValueMap> {
  if (mediaType === 'image') {
    const prepared = await prepareNodeImage(output);
    return {
      imageUrl: prepared.imageUrl,
      previewImageUrl: prepared.previewImageUrl,
      aspectRatio: prepared.aspectRatio,
    };
  }

  if (mediaType === 'video') {
    let localUrl = output;
    if (isRemoteUrl(output)) {
      try {
        localUrl = (await saveVideoFromUrl(output)).fullPath;
      } catch (error) {
        logger.warn('[mediaResultPersist] 视频下载失败，保留远程 URL', error);
      }
    }
    const poster = await captureVideoPoster(localUrl);
    return {
      videoUrl: localUrl,
      previewImageUrl: poster.posterUrl,
      aspectRatio: poster.aspectRatio,
      durationSec: poster.durationSec,
    };
  }

  let localAudioUrl = output;
  if (isRemoteUrl(output)) {
    try {
      localAudioUrl = (await saveAudioFromUrl(output)).fullPath;
    } catch (error) {
      logger.warn('[mediaResultPersist] 音频下载失败，保留远程 URL', error);
    }
  }
  const durationSec = await getAudioDuration(resolveImageDisplayUrl(localAudioUrl)).catch(() => null);
  return {
    audioUrl: localAudioUrl,
    durationSec,
  };
}
