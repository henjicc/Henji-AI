import { createLogger } from '@/core/logging';
import { saveAudioFromUrl, saveVideoFromUrl } from '@/utils/save';
import { getAudioDuration } from '@/utils/mediaDimensions';
import { getPlatform } from '@/platform';

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
): Promise<{ patch: DynamicValueMap; createdFilePaths: string[] }> {
  if (mediaType === 'image') {
    const prepared = await prepareNodeImage(output);
    return {
      patch: {
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: prepared.aspectRatio,
      },
      createdFilePaths: prepared.createdFilePaths,
    };
  }

  if (mediaType === 'video') {
    let localUrl = output;
    const createdFilePaths: string[] = [];
    if (isRemoteUrl(output)) {
      try {
        const saved = await saveVideoFromUrl(output);
        localUrl = saved.fullPath;
        if (saved.created) createdFilePaths.push(localUrl);
      } catch (error) {
        logger.warn('[mediaResultPersist] 视频下载失败，保留远程 URL', error);
      }
    }
    try {
      const poster = await captureVideoPoster(localUrl);
      createdFilePaths.push(...poster.createdFilePaths);
      return {
        patch: {
          videoUrl: localUrl,
          previewImageUrl: poster.posterUrl,
          aspectRatio: poster.aspectRatio,
          durationSec: poster.durationSec,
        },
        createdFilePaths,
      };
    } catch (error) {
      await releaseCreatedGenerationMedia(createdFilePaths);
      throw error;
    }
  }

  let localAudioUrl = output;
  const createdFilePaths: string[] = [];
  if (isRemoteUrl(output)) {
    try {
      const saved = await saveAudioFromUrl(output);
      localAudioUrl = saved.fullPath;
      if (saved.created) createdFilePaths.push(localAudioUrl);
    } catch (error) {
      logger.warn('[mediaResultPersist] 音频下载失败，保留远程 URL', error);
    }
  }
  const durationSec = await getAudioDuration(resolveImageDisplayUrl(localAudioUrl)).catch(() => null);
  return { patch: { audioUrl: localAudioUrl, durationSec }, createdFilePaths };
}

async function releaseCreatedGenerationMedia(filePaths: readonly string[]): Promise<void> {
  if (filePaths.length === 0) return;
  await getPlatform().image.releaseManagedGenerationMedia([...new Set(filePaths)]).catch((error) => {
    logger.error('[mediaResultPersist] 媒体准备失败后的受管文件回滚失败', error);
  });
}
