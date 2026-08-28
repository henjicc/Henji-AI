import { useEffect, useMemo, useState } from 'react';

import { createLogger } from '@/core/logging';
import { resolveImageDisplayUrl } from '@/services/imageSource';

import { isEquirectangularPanoramaDimensions } from './panoramaRenderResources';

const logger = createLogger('features.canvas.panoramaViewer');

export type PanoramaImageResource =
  | { status: 'idle'; displayUrl: string }
  | { status: 'loading'; displayUrl: string }
  | {
      status: 'ready';
      displayUrl: string;
      image: HTMLImageElement;
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
        const isEquirectangular = isEquirectangularPanoramaDimensions(width, height);
        setResource({ status: 'ready', displayUrl, image, width, height, isEquirectangular });
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
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
      image.src = '';
    };
  }, [active, displayUrl, retryRevision, sourceNodeId]);

  return resource;
}
