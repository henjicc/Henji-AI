import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCcw, X, GripVertical } from 'lucide-react';

import { UiButton, UiIconButton, UiOptionButton, UiError, UiSharedGlassHost } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DURATION, uiTransition } from '@/components/ui/motion';
import type {
  ImageEditSessionData,
  ImageEditSessionReferenceV3,
} from '@/core/imageEdit';
import { ImageInfoPanel } from './ImageInfoPanel';
import { createLogger } from '@/core/logging';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import { useImageViewerTransform, type ImageComparisonMode } from './useImageViewerTransform';

// 图片编辑器只在用户进入编辑模式时挂载，避免把编辑运行时压进常用的只读查看路径。
const ViewerMarkEditor = React.lazy(() =>
  import('@/features/imageMark').then((m) => ({ default: m.ViewerMarkEditor })),
);

const logger = createLogger('components.mediaViewer.ImageViewerModal');

/** 只读读数芯片（页码 / 缩放比例）：静态玻璃，无交互态 */
const VIEWER_CONTROL_CLASS =
  'ui-glass inline-flex h-10 items-center justify-center rounded-full px-4 text-sm text-white';
/** 玻璃上的圆形图标按钮，配合 `appearance="glass"`：这里只给形状，材质与交互态归 primitive */
const VIEWER_ICON_BUTTON_CLASS = '!h-10 !w-10 !rounded-full';
/** 玻璃上的胶囊按钮，配合 `variant="glass"` */
const VIEWER_PILL_BUTTON_CLASS = '!h-10 !rounded-full !px-3';

export interface ImageViewerModalProps {
  open: boolean;
  imageUrl: string;
  /** 放大结果对应的生成输入快照；缺省时只有普通查看。 */
  comparisonImageUrl?: string;
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
  initialEditSession?: ImageEditSessionData;
  onEnterEditor?: () => void;
  onExitEditor?: () => void;
  onSaveEdit?: (mediaUrl: string, session: ImageEditSessionData) => void;
  onEditSessionChange?: (session: ImageEditSessionReferenceV3) => void;
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
  comparisonImageUrl,
  imageList,
  currentIndex,
  onClose,
  onNavigate,
  infoSource,
  filePaths,
  fromUpload = false,
  isEditorMode = false,
  initialEditSession,
  onEnterEditor,
  onExitEditor,
  onSaveEdit,
  onEditSessionChange,
  onContextMenu,
}: ImageViewerModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [requestedMode, setRequestedMode] = useState<ImageComparisonMode>('single');
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  const comparisonAvailable = Boolean(comparisonImageUrl) && failedOriginal !== comparisonImageUrl;
  const mode = comparisonAvailable ? requestedMode : 'single';
  const comparing = mode !== 'single';
  const comparisonStageRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLButtonElement>(null);
  const dividerPointerRef = useRef<number | null>(null);
  const dividerPositionRef = useRef(50);
  const setDivider = (value: number) => {
    const position = Math.max(0, Math.min(100, value));
    dividerPositionRef.current = position;
    if (wipeRef.current) wipeRef.current.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    if (dividerRef.current) {
      dividerRef.current.style.left = `${position}%`;
      dividerRef.current.setAttribute('aria-valuenow', String(Math.round(position)));
    }
  };
  const resetComparison = () => { resetView(); setDivider(50); };
  const closeTimerRef = useRef<number | null>(null);

  const {
    containerRef,
    imageRef,
    comparisonImageRef,
    scaleDisplayRef,
    viewerOpacity,
    resetView,
    handleImageMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleImageMouseMove,
    handleImageLoad,
    isPointOnImageContent,
  } = useImageViewerTransform(open && isVisible && !isEditorMode, mode);

  useEffect(() => {
    setRequestedMode('single');
    setFailedOriginal(null);
    dividerPositionRef.current = 50;
  }, [open, imageUrl, comparisonImageUrl]);

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
      if (e.defaultPrevented) return;
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
      data-image-viewer="true"
      data-comparison-mode={mode}
      role="dialog"
      aria-label={t('viewer.imageAlt', '图片')}
      aria-modal="true"
      className={/* ui-surface-allow: 全屏沉浸式媒体查看器，铺满视口，不是 UiModal 的居中卡片语义（见重要记录 003） */ `fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-viewer overflow-hidden bg-black/90`}
      style={{
        opacity: overlayOpacity,
        transition: uiTransition(['opacity'], UI_DURATION.viewer),
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {editorAvailable && !isEditorMode && (
        <div className="absolute top-12 left-1/2 z-10 -translate-x-1/2">
          <UiButton
            variant="glass"
            size="sm"
            className="rounded-full px-4"
            onClick={onEnterEditor}
            title={t('common.edit', '编辑')}
          >
            {t('common.edit', '编辑')}
          </UiButton>
        </div>
      )}

      {isEditorMode && editorAvailable ? (
        <div className="h-full w-full">
          <React.Suspense fallback={null}>
            <ViewerMarkEditor
              imageUrl={imageUrl}
              session={initialEditSession}
              onSessionChange={onEditSessionChange}
              onClose={() => onExitEditor?.()}
              onSave={(dataUrl, session) => {
                onSaveEdit?.(dataUrl, session);
                onExitEditor?.();
              }}
            />
          </React.Suspense>
        </div>
      ) : (
        <UiSharedGlassHost
          ref={containerRef}
          minTargets={3}
          // 宿主默认 relative；沉浸查看必须覆盖它，否则绝对定位的对比画面会让宿主高度塌缩。
          className="!absolute inset-0 flex items-center justify-center overflow-hidden p-4"
          style={{ overscrollBehavior: 'contain' }}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {comparing ? (
            <div ref={comparisonStageRef} className="absolute inset-x-4 top-16 bottom-36 bg-bg-dark" data-comparison-stage="true">
              <div
                className="absolute inset-y-0 right-0 overflow-hidden"
                style={{ width: mode === 'side-by-side' ? '50%' : '100%' }}
                data-comparison-pane="result"
              >
                <img
                  ref={imageRef}
                  src={resolveImageDisplayUrl(imageUrl)}
                  alt={t('viewer.upscaled', '放大后')}
                  className="h-full w-full select-none object-contain"
                  draggable={false}
                  onLoad={handleImageLoad}
                  onMouseDown={handleImageMouseDown}
                  onMouseMove={handleImageMouseMove}
                  onContextMenu={(e) => onContextMenu?.(e, currentFilePath)}
                />
              </div>
              <div
                ref={wipeRef}
                className="absolute inset-y-0 left-0 overflow-hidden bg-bg-dark"
                style={{
                  width: mode === 'side-by-side' ? '50%' : '100%',
                  clipPath: mode === 'overlay' ? `inset(0 ${100 - dividerPositionRef.current}% 0 0)` : undefined,
                }}
                data-comparison-pane="original"
              >
                <img
                  ref={comparisonImageRef}
                  src={resolveImageDisplayUrl(comparisonImageUrl ?? '')}
                  alt={t('viewer.original', '原图')}
                  className="h-full w-full select-none object-contain"
                  draggable={false}
                  onLoad={handleImageLoad}
                  onMouseDown={handleImageMouseDown}
                  onMouseMove={handleImageMouseMove}
                  onError={() => {
                    logger.warn('image_viewer.comparison.failed', { reason: 'original_image_load_failed' });
                    setFailedOriginal(comparisonImageUrl ?? null);
                  }}
                />
              </div>
              <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
                {t('viewer.original', '原图')}
              </span>
              <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
                {t('viewer.upscaled', '放大后')}
              </span>
              {mode === 'overlay' && (
                <UiButton
                  ref={dividerRef}
                  variant="plain"
                  role="slider"
                  aria-label={t('viewer.comparisonDivider', '对比分界线')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(dividerPositionRef.current)}
                  aria-orientation="horizontal"
                  className="absolute inset-y-0 !h-full !w-8 -translate-x-1/2 !cursor-ew-resize !p-0 touch-none"
                  style={{ left: `${dividerPositionRef.current}%` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    handleContainerMouseUp();
                    dividerPointerRef.current = event.pointerId;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (dividerPointerRef.current !== event.pointerId) return;
                    const rect = comparisonStageRef.current?.getBoundingClientRect();
                    if (rect?.width) setDivider((event.clientX - rect.left) / rect.width * 100);
                  }}
                  onPointerUp={(event) => {
                    dividerPointerRef.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={() => { dividerPointerRef.current = null; }}
                  onLostPointerCapture={() => { dividerPointerRef.current = null; }}
                  onKeyDown={(event) => {
                    const next = event.key === 'ArrowLeft' ? dividerPositionRef.current - 2
                      : event.key === 'ArrowRight' ? dividerPositionRef.current + 2
                        : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : null;
                    if (next === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDivider(next);
                  }}
                >
                  <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white" />
                  <span className="pointer-events-none relative flex h-10 w-7 items-center justify-center rounded-full bg-panel text-text-dark shadow-panel">
                    <GripVertical className="h-5 w-5" />
                  </span>
                </UiButton>
              )}
            </div>
          ) : (
            <div className="relative">
              <img
                ref={imageRef}
                src={resolveImageDisplayUrl(imageUrl)}
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
          )}

          <UiIconButton
            appearance="glass"
            onClick={onClose}
            className={`${VIEWER_ICON_BUTTON_CLASS} absolute right-4 top-4 z-sticky`}
            title={t('common.close', '关闭')}
            aria-label={t('common.close', '关闭')}
          >
            <X className="h-5 w-5" />
          </UiIconButton>

          <ImageInfoPanel open={open} imageSource={resolvedInfoSource} />

          <div className="absolute bottom-8 left-1/2 z-sticky flex -translate-x-1/2 flex-col items-center gap-3">
            {comparisonImageUrl && (
              <div className="ui-glass flex max-w-full items-center gap-1 rounded-full p-1" role="group" aria-label={t('viewer.compare', '对比查看')}>
                {(['single', 'side-by-side', 'overlay'] as const).map((value) => (
                  <UiOptionButton
                    key={value}
                    variant="menu"
                    active={mode === value}
                    aria-pressed={mode === value}
                    disabled={value !== 'single' && !comparisonAvailable}
                    className="!rounded-full !px-4 !py-2 whitespace-nowrap"
                    onClick={() => setRequestedMode(value)}
                  >
                    {value === 'single' ? t('viewer.resultOnly', '仅结果')
                      : value === 'side-by-side' ? t('viewer.sideBySide', '左右对比')
                        : t('viewer.overlay', '叠加对比')}
                  </UiOptionButton>
                ))}
              </div>
            )}
            {failedOriginal && <UiError size="xs" message={t('viewer.originalUnavailable', '原图无法加载，仍可查看放大结果')} />}
            {imageList.length > 1 && (
              <div className="flex items-center gap-3">
                <UiIconButton
                  appearance="glass"
                  onClick={() => onNavigate('prev')}
                  disabled={currentIndex <= 0}
                  className={VIEWER_ICON_BUTTON_CLASS}
                  title={t('viewer.prev', '上一张')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </UiIconButton>
                <UiIconButton
                  appearance="glass"
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
                onClick={resetComparison}
                variant="glass"
                size="sm"
                className={VIEWER_PILL_BUTTON_CLASS}
                title={t('viewer.reset', '重置视图')}
              >
                <RotateCcw className="h-4 w-4" />
              </UiButton>
            </div>
          </div>
        </UiSharedGlassHost>
      )}
    </div>
  );
}
