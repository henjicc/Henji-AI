import { memo, useCallback, useState, type ImgHTMLAttributes, type MouseEvent, type SyntheticEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton } from '@/components/ui';
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasImageViewerMode } from '@/features/canvas/domain/canvasNodes';

export interface CanvasNodeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  viewerSourceUrl?: string | null;
  viewerImageList?: Array<string | null | undefined>;
  viewerMode?: CanvasImageViewerMode;
  viewerSourceNodeId?: string;
  disableViewer?: boolean;
  /**
   * 图片读不出来时的样子：`detail`（默认）整块叠红斜纹，写“素材找不到”与文件名；`icon` 只叠红斜纹与警示图标
   * （放不下字的小缩略图）；`none` 保持浏览器默认（图片只是附带的预览，读不出来不代表素材丢了）。
   */
  failure?: 'detail' | 'icon' | 'none';
  /** 给了就在“素材找不到”下面放“重新链接”（能换一份文件的节点） */
  onRelink?: () => void;
}

function mediaFileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
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
  failure = 'detail',
  onRelink,
  onDoubleClick,
  onError,
  src,
  ...props
}: CanvasNodeImageProps) => {
  const { t } = useTranslation();
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  // 记下读失败的是哪个地址：地址换了（重新链接、生成出新图）就重新尝试显示
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const handleError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (typeof src === 'string' && src) setFailedSrc(src);
    onError?.(event);
  }, [onError, src]);

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

  if (failure !== 'none' && typeof src === 'string' && src && failedSrc === src) {
    const fileName = mediaFileName(typeof viewerSourceUrl === 'string' && viewerSourceUrl ? viewerSourceUrl : src);
    return (
      <div
        data-canvas-media-missing
        role="img"
        aria-label={t('canvas.mediaMissing')}
        className={`${props.className ?? ''} ui-hatch-danger flex flex-col items-center justify-center gap-1 overflow-hidden text-center`}
      >
        <TriangleAlert aria-hidden className={`${failure === 'icon' ? UI_ICON_SIZE_CLASS.sm : UI_ICON_SIZE_CLASS.lg} shrink-0 text-danger-text`} />
        {failure === 'detail' ? (
          <>
            <span className="text-13 font-medium text-text1">{t('canvas.mediaMissing')}</span>
            {fileName ? <span className="max-w-full truncate px-3 text-xs text-text2" title={fileName}>{fileName}</span> : null}
            {onRelink ? (
              <UiButton
                size="sm"
                variant="secondary"
                className="nodrag mt-1"
                onClick={(event) => {
                  event.stopPropagation();
                  onRelink();
                }}
              >
                {t('canvas.relink')}
              </UiButton>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <img
      decoding="async"
      {...props}
      onError={handleError}
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
