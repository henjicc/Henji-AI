import { memo, useCallback, type ImgHTMLAttributes, type MouseEvent } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasImageViewerMode } from '@/features/canvas/domain/canvasNodes';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  viewerMode?: CanvasImageViewerMode;
  viewerSourceNodeId?: string;
  disableViewer?: boolean;
}

function normalizeViewerList(
  imageList: Array<string | null | undefined> | undefined,
  currentImageUrl: string
): string[] {
  const deduped: string[] = [];
  for (const rawItem of imageList ?? []) {
    const item = typeof rawItem === 'string' ? rawItem.trim() : '';
    if (!item || deduped.includes(item)) {
      continue;
    }
    deduped.push(item);
  }

  if (!deduped.includes(currentImageUrl)) {
    deduped.unshift(currentImageUrl);
  }

  return deduped.length > 0 ? deduped : [currentImageUrl];
}

export const CanvasNodeImage = memo(({
  viewerSourceUrl,
  viewerImageList,
  viewerMode = 'image',
  viewerSourceNodeId,
  disableViewer = false,
  onDoubleClick,
  src,
  ...props
}: CanvasNodeImageProps) => {
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLImageElement>) => {
    onDoubleClick?.(event);

    if (event.defaultPrevented || disableViewer) {
      return;
    }

    const fallbackSrc = event.currentTarget.currentSrc || (typeof src === 'string' ? src : '');
    const resolvedSource =
      typeof viewerSourceUrl === 'string' && viewerSourceUrl.trim().length > 0
        ? viewerSourceUrl.trim()
        : fallbackSrc.trim();
    if (!resolvedSource) {
      return;
    }

    event.stopPropagation();
    openImageViewer({
      imageUrl: resolvedSource,
      imageList: normalizeViewerList(viewerImageList, resolvedSource),
      mode: viewerMode,
      sourceNodeId: viewerSourceNodeId,
    });
  }, [
    disableViewer,
    onDoubleClick,
    openImageViewer,
    src,
    viewerImageList,
    viewerMode,
    viewerSourceNodeId,
    viewerSourceUrl,
  ]);

  return (
    <img
      decoding="async"
      {...props}
      src={src}
      data-viewer-src={
        typeof viewerSourceUrl === 'string' && viewerSourceUrl.trim().length > 0
          ? viewerSourceUrl.trim()
          : undefined
      }
      data-viewer-mode={viewerMode}
      onDoubleClick={handleDoubleClick}
    />
  );
});

CanvasNodeImage.displayName = 'CanvasNodeImage';
