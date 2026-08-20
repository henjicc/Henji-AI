import { createLogger } from '@/core/logging';
import { canvasToDataUrl, loadImageElement } from '@/services/imageSource';
import { clampCropRect } from '../domain/geometry';
import { hasMarkEffect, type ImageMarkDoc } from '../domain/types';
import { drawMarkItems } from './drawMarks';
import { renderOrientedCanvas } from './orientedImage';

const logger = createLogger('features.imageMark');

/**
 * 按原图分辨率离屏合成:朝向 → 标记 → 裁剪。
 * 所有宿主(画布工具/查看器/工具箱)统一走这里导出,保证结果一致。
 */
export async function exportMarkedImage(sourceUrl: string, doc: ImageMarkDoc): Promise<string> {
  const startedAt = performance.now();
  logger.debug('image_mark.export.start', {
    itemCount: doc.items.length,
    rotate: doc.orientation.rotate,
    mirrored: doc.orientation.mirrored,
    hasCrop: Boolean(doc.crop),
  });

  let image: HTMLImageElement;
  try {
    image = await loadImageElement(sourceUrl);
  } catch (error) {
    logger.error('image_mark.export.failed', {
      itemCount: doc.items.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return exportMarkedImageFromSource(image, doc, startedAt);
}

/** 已在浏览器内存中的底图直接进入标注与裁剪合成，避免重复编码、解码。 */
export function exportMarkedImageFromSource(
  source: HTMLImageElement | HTMLCanvasElement,
  doc: ImageMarkDoc,
  startedAt = performance.now(),
): string {
  try {
    const oriented = renderOrientedCanvas(source, doc.orientation);
    const context = oriented.getContext('2d');
    if (!context) {
      throw new Error('无法初始化画布');
    }

    if (doc.items.length > 0) {
      drawMarkItems(context, doc.items, oriented.width, oriented.height, {
        baseCanvas: oriented,
      });
    }

    let output = oriented;
    if (doc.crop) {
      const crop = clampCropRect(doc.crop, oriented.width, oriented.height);
      const cropped = document.createElement('canvas');
      cropped.width = Math.max(1, Math.round(crop.width));
      cropped.height = Math.max(1, Math.round(crop.height));
      const croppedContext = cropped.getContext('2d');
      if (!croppedContext) {
        throw new Error('无法初始化画布');
      }
      croppedContext.drawImage(
        oriented,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        cropped.width,
        cropped.height
      );
      output = cropped;
    }

    const dataUrl = canvasToDataUrl(output);
    logger.info('image_mark.export.completed', {
      itemCount: doc.items.length,
      width: output.width,
      height: output.height,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return dataUrl;
  } catch (error) {
    logger.error('image_mark.export.failed', {
      itemCount: doc.items.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export { hasMarkEffect };
