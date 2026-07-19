import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';

import { UiButton, UiIconButton } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { ViewerMarkEditor, type ImageMarkSession } from '@/features/imageMark';
import { ImageInfoPanel } from './ImageInfoPanel';
import { useImageViewerTransform } from './useImageViewerTransform';

const VIEWER_CONTROL_CLASS =
  'inline-flex h-10 items-center justify-center rounded-full border border-white/20 bg-black/60 px-4 text-sm text-white backdrop-blur-xl';
const VIEWER_ICON_BUTTON_CLASS =
  '!h-10 !w-10 !rounded-full !border-white/20 !bg-black/60 !text-white hover:!bg-black/70';

export interface ImageViewerModalProps {
  open: boolean;
  imageUrl: string;
  imageList: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  /** 信息面板读取的来源（本地路径优先），缺省回退 imageUrl */
  infoSource?: string;
  /** 以下为可选编辑器能力（对话模式使用） */
  filePaths?: string[];
  fromUpload?: boolean;
  isEditorMode?: boolean;
  initialMarkSession?: ImageMarkSession;
  onEnterEditor?: () => void;
  onExitEditor?: () => void;
  onSaveEdit?: (dataUrl: string, session: ImageMarkSession) => void;
  onContextMenu?: (e: React.MouseEvent, filePath?: string) => void;
}

/** asset.localhost 显示链接还原为本地路径，供信息面板读取 */
function normalizeInfoSource(url: string): string {
  const match = url.match(/^https?:\/\/asset\.localhost\/(.+)$/i);
  if (!match) {
    return url;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return url;
  }
}

/**
 * 统一图片查看器：画布与对话模式共用。
 * 基础能力：缩放/平移/导航/信息面板；对话模式可选启用编辑器与右键菜单。
 */
export function ImageViewerModal({
  open,
  imageUrl,
  imageList,
  currentIndex,
  onClose,
  onNavigate,
  infoSource,
  filePaths,
  fromUpload = false,
  isEditorMode = false,
  initialMarkSession,
  onEnterEditor,
  onExitEditor,
  onSaveEdit,
  onContextMenu,
}: ImageViewerModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const closeTimerRef = useRef<number | null>(null);

  const {
    containerRef,
    imageRef,
    scaleDisplayRef,
    viewerOpacity,
    resetView,
    handleImageMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleImageMouseMove,
    handleImageLoad,
    isPointOnImageContent,
  } = useImageViewerTransform(open && isVisible && !isEditorMode);

  useEffect(() => {
    if (!isVisible) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isVisible]);

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setOverlayOpacity(0);
      requestAnimationFrame(() => {
        setOverlayOpacity(1);
      });
      return;
    }
    if (!isVisible) return;
    setOverlayOpacity(0);
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 400);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open, isVisible]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    resetView();
  }, [open, imageUrl, resetView]);

  useEffect(() => {
    if (!open || isEditorMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (e.key === 'ArrowRight') {
        onNavigate('next');
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isEditorMode, onNavigate, onClose]);

  if (!isVisible) return null;

  const currentFilePath = filePaths?.[currentIndex];
  const resolvedInfoSource = normalizeInfoSource(infoSource ?? currentFilePath ?? imageUrl);
  const editorAvailable = fromUpload && Boolean(onEnterEditor && onExitEditor && onSaveEdit);

  return (
    <div
      className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[110] overflow-hidden bg-black/90 backdrop-blur-lg`}
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 400ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {editorAvailable && !isEditorMode && (
        <div className="absolute top-12 left-1/2 z-10 -translate-x-1/2">
          <UiButton
            variant="muted"
            size="sm"
            className="rounded-full px-4 backdrop-blur-xl"
            onClick={onEnterEditor}
            title={t('common.edit', '编辑')}
          >
            {t('common.edit', '编辑')}
          </UiButton>
        </div>
      )}

      {isEditorMode && editorAvailable ? (
        <div className="h-full w-full">
          <ViewerMarkEditor
            imageUrl={imageUrl}
            session={initialMarkSession}
            onClose={() => onExitEditor?.()}
            onSave={(dataUrl, session) => {
              onSaveEdit?.(dataUrl, session);
              onExitEditor?.();
            }}
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center overflow-hidden p-4"
          style={{ overscrollBehavior: 'contain' }}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="relative">
            <img
              ref={imageRef}
              src={imageUrl}
              alt={t('viewer.imageAlt', '图片')}
              className="select-none transition-opacity duration-300"
              style={{
                opacity: viewerOpacity * overlayOpacity,
                transformOrigin: 'center',
                width: '95vw',
                height: '95vh',
                objectFit: 'contain',
              }}
              onLoad={handleImageLoad}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onClick={(e) => {
                if (isPointOnImageContent(e.clientX, e.clientY)) {
                  e.stopPropagation();
                } else {
                  onClose();
                }
              }}
              onContextMenu={(e) => onContextMenu?.(e, currentFilePath)}
              draggable={false}
            />
          </div>

          <ImageInfoPanel open={open} imageSource={resolvedInfoSource} />

          <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
            {imageList.length > 1 && (
              <div className="flex items-center gap-3">
                <UiIconButton
                  onClick={() => onNavigate('prev')}
                  disabled={currentIndex <= 0}
                  className={VIEWER_ICON_BUTTON_CLASS}
                  title={t('viewer.prev', '上一张')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </UiIconButton>
                <UiIconButton
                  onClick={() => onNavigate('next')}
                  disabled={currentIndex >= imageList.length - 1}
                  className={VIEWER_ICON_BUTTON_CLASS}
                  title={t('viewer.next', '下一张')}
                >
                  <ChevronRight className="h-5 w-5" />
                </UiIconButton>
              </div>
            )}

            <div className="flex items-center gap-4">
              {imageList.length > 1 && (
                <div className={VIEWER_CONTROL_CLASS}>
                  {currentIndex + 1} / {imageList.length}
                </div>
              )}
              <div ref={scaleDisplayRef} className={`${VIEWER_CONTROL_CLASS} min-w-[74px]`}>
                100%
              </div>
              <UiButton
                onClick={resetView}
                variant="ghost"
                size="sm"
                className={`${VIEWER_CONTROL_CLASS} !px-3 transition-colors hover:bg-white/10`}
                title={t('viewer.reset', '重置视图')}
              >
                <RotateCcw className="h-4 w-4" />
              </UiButton>
              <UiButton
                onClick={onClose}
                variant="ghost"
                size="sm"
                className={`${VIEWER_CONTROL_CLASS} !px-3 transition-colors hover:bg-white/10`}
                title={t('common.close', '关闭')}
              >
                <X className="h-4 w-4" />
              </UiButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
