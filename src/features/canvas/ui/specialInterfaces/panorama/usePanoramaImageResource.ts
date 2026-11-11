import { useEffect, useMemo, useState } from 'react';

import { createLogger } from '@/core/logging';
import { resolveImageDisplayUrl } from '@/services/imageSource';

import { isEquirectangularPanoramaDimensions } from './panoramaRenderResources';
import type { PanoramaProjectionMode } from '@/features/canvas/domain/panoramaViewer';

const logger = createLogger('features.canvas.panoramaViewer');

export type PanoramaImageResource =
  | { status: 'idle'; displayUrl: string }
  | { status: 'loading'; displayUrl: string }
  | {
      status: 'ready';
      displayUrl: string;
      /** 传给球面的贴图源：超过 textureMaxWidth 时是在后台缩小、已上下翻转的位图。 */
      image: HTMLImageElement | ImageBitmap;
      width: number;
      height: number;
      isEquirectangular: boolean;
    }
  | { status: 'error'; displayUrl: string; message: string };

function shouldUseAnonymousCors(source: string): boolean {
  return /^(?:https?:|asset:|henji-media:)/i.test(source);
}

export function usePanoramaImageResource(
  imageUrl: string,
  active: boolean,
  retryRevision: number,
  sourceNodeId?: string | null,
  projectionMode: PanoramaProjectionMode = 'strict-2:1',
  /**
   * 球面贴图的最大宽度。画布节点里的小视口用不到 8K 原图的细节，整张传给显卡却要卡一下；
   * 全屏查看器不传，保留原图清晰度。
   */
  textureMaxWidth?: number,
): PanoramaImageResource {
  const displayUrl = useMemo(() => resolveImageDisplayUrl(imageUrl), [imageUrl]);
  const [resource, setResource] = useState<PanoramaImageResource>({
    status: active ? 'loading' : 'idle',
    displayUrl,
  });

  useEffect(() => {
    if (!active || !displayUrl) {
      setResource({ status: 'idle', displayUrl });
      return;
    }

    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    const image = new Image();
    image.decoding = 'async';
    if (shouldUseAnonymousCors(displayUrl)) image.crossOrigin = 'anonymous';
    setResource({ status: 'loading', displayUrl });
    logger.info('全景图片加载开始', {
      event: 'panorama.viewer.load.start',
      sourceNodeId: sourceNodeId ?? null,
    });

    const handleLoad = async (): Promise<void> => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        if (cancelled) return;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const isEquirectangular = isEquirectangularPanoramaDimensions(width, height, projectionMode);
        if (textureMaxWidth && width > textureMaxWidth && typeof createImageBitmap === 'function') {
          // 只在图片加载时缩一次，之后每次建立球面都直接用这张位图；位图贴图不认 WebGL 的上下翻转开关，所以在这里先翻好
          bitmap = await createImageBitmap(image, {
            resizeWidth: textureMaxWidth,
            resizeHeight: Math.round((height * textureMaxWidth) / width),
            resizeQuality: 'high',
            imageOrientation: 'flipY',
          });
          if (cancelled) {
            bitmap.close();
            return;
          }
        }
        setResource({ status: 'ready', displayUrl, image: bitmap ?? image, width, height, isEquirectangular });
        logger.info('全景图片加载完成', {
          event: 'panorama.viewer.load.completed',
          sourceNodeId: sourceNodeId ?? null,
          width,
          height,
          isEquirectangular,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '图片解码失败';
        setResource({ status: 'error', displayUrl, message });
        logger.error('全景图片解码失败', error, {
          event: 'panorama.viewer.load.failed',
          context: { sourceNodeId: sourceNodeId ?? null, phase: 'decode' },
        });
      }
    };

    const handleError = (): void => {
      if (cancelled) return;
      const message = '图片加载失败';
      setResource({ status: 'error', displayUrl, message });
      logger.error('全景图片加载失败', new Error(message), {
        event: 'panorama.viewer.load.failed',
        context: { sourceNodeId: sourceNodeId ?? null, phase: 'load' },
      });
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);
    image.src = displayUrl;

    return () => {
      cancelled = true;
      bitmap?.close();
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
      image.src = '';
    };
  }, [active, displayUrl, projectionMode, retryRevision, sourceNodeId, textureMaxWidth]);

  return resource;
}
