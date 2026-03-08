import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { UiButton, UiIconButton } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { useImageViewerTransform } from '../hooks/useImageViewerTransform';

export interface ImageViewerModalProps {
  open: boolean;
  imageUrl: string;
  imageList: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
}

export function ImageViewerModal({
  open,
  imageUrl,
  imageList,
  currentIndex,
  onClose,
  onNavigate,
}: ImageViewerModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const viewerControlClass = 'inline-flex h-10 items-center justify-center rounded-full border border-white/20 bg-black/60 px-4 text-sm text-white backdrop-blur-xl';
  const viewerIconButtonClass = '!h-10 !w-10 !rounded-full !border-white/20 !bg-black/60 !text-white hover:!bg-black/70';
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
  } = useImageViewerTransform(open && isVisible);

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
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (e.key === 'ArrowRight') {
        onNavigate('next');
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onNavigate, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-[100] overflow-hidden bg-black/90 backdrop-blur-lg`}
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 400ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
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
            draggable={false}
          />
        </div>

        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
          {imageList.length > 1 && (
            <div className="flex items-center gap-3">
              <UiIconButton
                onClick={() => onNavigate('prev')}
                disabled={currentIndex <= 0}
                className={viewerIconButtonClass}
                title={t('viewer.prev', '上一张')}
              >
                <ChevronLeft className="h-5 w-5" />
              </UiIconButton>
              <UiIconButton
                onClick={() => onNavigate('next')}
                disabled={currentIndex >= imageList.length - 1}
                className={viewerIconButtonClass}
                title={t('viewer.next', '下一张')}
              >
                <ChevronRight className="h-5 w-5" />
              </UiIconButton>
            </div>
          )}

          <div className="flex items-center gap-4">
            {imageList.length > 1 && (
              <div className={viewerControlClass}>
                {currentIndex + 1} / {imageList.length}
              </div>
            )}
            <div
              ref={scaleDisplayRef}
              className={`${viewerControlClass} min-w-[74px]`}
            >
              100%
            </div>
            <UiButton
              onClick={resetView}
              variant="ghost"
              size="sm"
              className={`${viewerControlClass} !px-3 transition-colors hover:bg-white/10`}
              title={t('viewer.reset', '重置视图')}
            >
              <RotateCcw className="h-4 w-4" />
            </UiButton>
            <UiButton
              onClick={onClose}
              variant="ghost"
              size="sm"
              className={`${viewerControlClass} !px-3 transition-colors hover:bg-white/10`}
              title={t('common.close', '关闭')}
            >
              <X className="h-4 w-4" />
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
