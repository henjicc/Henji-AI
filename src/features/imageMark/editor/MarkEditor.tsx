import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import {
  DEFAULT_LINE_WIDTH_PERCENT,
  DEFAULT_TEXT_SIZE_PERCENT,
  resolveMosaicPixelSize,
  resolveTextBaseSize,
} from '../domain/metrics';
import { clampCropRect } from '../domain/geometry';
import {
  createEmptyMarkDoc,
  type ImageMarkDoc,
  type MarkToolType,
} from '../domain/types';
import { buildMosaicSourceCanvas, renderOrientedCanvas } from '../render/orientedImage';
import { MarkCanvas } from './MarkCanvas';
import { MarkToolbar } from './MarkToolbar';
import { useMarkController } from './useMarkController';
import {
  CROP_RATIO_OPTIONS,
  VIEWPORT_MIN_HEIGHT_PX,
  VIEWPORT_MIN_WIDTH_PX,
  VIEWPORT_PADDING_PX,
  type MarkEditorStyleState,
} from './shared';

export interface MarkEditorProps {
  sourceImageUrl: string;
  initialDoc?: ImageMarkDoc | null;
  onDocChange?: (doc: ImageMarkDoc) => void;
  initialStyle?: Partial<MarkEditorStyleState>;
  onStyleChange?: (style: MarkEditorStyleState) => void;
  /** 根容器高度控制,默认适配对话框;全屏宿主传 h-full */
  className?: string;
}

/**
 * 统一图片编辑器(快速标记):
 * 画布节点工具、图片查看器、工具箱共用同一实现。
 * 数据为 ImageMarkDoc,导出统一走 render/exportMarkedImage。
 */
export function MarkEditor({
  sourceImageUrl,
  initialDoc,
  onDocChange,
  initialStyle,
  onStyleChange,
  className = 'h-[min(70vh,760px)]',
}: MarkEditorProps): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [doc, setDoc] = useState<ImageMarkDoc>(() => initialDoc ?? createEmptyMarkDoc());
  const [tool, setToolState] = useState<MarkToolType>('rect');
  const [style, setStyle] = useState<MarkEditorStyleState>(() => ({
    color: initialStyle?.color ?? ANNOTATION_DEFAULT_STROKE_HEX,
    lineWidthPercent: initialStyle?.lineWidthPercent ?? DEFAULT_LINE_WIDTH_PERCENT,
    textSizePercent: initialStyle?.textSizePercent ?? DEFAULT_TEXT_SIZE_PERCENT,
  }));
  const [cropRatioValue, setCropRatioValue] = useState('free');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef<Konva.Stage | null>(null);
  const contentGroupRef = useRef<Konva.Group | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  // ==================== 图片加载 ====================

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) {
        setImage(img);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setImage(null);
      }
    };
    img.src = resolveImageDisplayUrl(sourceImageUrl);
    return () => {
      cancelled = true;
    };
  }, [sourceImageUrl]);

  // ==================== 朝向位图与马赛克取样源 ====================

  const { rotate: orientationRotate, mirrored: orientationMirrored } = doc.orientation;
  const orientedCanvas = useMemo(() => {
    if (!image) {
      return null;
    }
    return renderOrientedCanvas(image, { rotate: orientationRotate, mirrored: orientationMirrored });
  }, [image, orientationRotate, orientationMirrored]);

  const imageWidth = orientedCanvas?.width ?? 0;
  const imageHeight = orientedCanvas?.height ?? 0;
  const baseSize = resolveTextBaseSize(imageWidth, imageHeight);
  const hasMosaic = useMemo(() => doc.items.some((item) => item.type === 'mosaic'), [doc.items]);

  const mosaicSource = useMemo(() => {
    if (!orientedCanvas || !hasMosaic) {
      return null;
    }
    return buildMosaicSourceCanvas(
      orientedCanvas,
      resolveMosaicPixelSize(orientedCanvas.width, orientedCanvas.height)
    );
  }, [hasMosaic, orientedCanvas]);

  // ==================== 视口与缩放 ====================

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { stageWidth, stageHeight, scale } = useMemo(() => {
    if (!imageWidth || !imageHeight) {
      return { stageWidth: 820, stageHeight: 480, scale: 1 };
    }
    const maxWidth = Math.max(VIEWPORT_MIN_WIDTH_PX, viewportSize.width - VIEWPORT_PADDING_PX * 2);
    const maxHeight = Math.max(VIEWPORT_MIN_HEIGHT_PX, viewportSize.height - VIEWPORT_PADDING_PX * 2);
    const ratio = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1);
    return {
      stageWidth: Math.max(1, Math.round(imageWidth * ratio)),
      stageHeight: Math.max(1, Math.round(imageHeight * ratio)),
      scale: ratio,
    };
  }, [imageHeight, imageWidth, viewportSize.height, viewportSize.width]);

  // ==================== 控制器 ====================

  const controller = useMarkController({
    doc,
    setDoc,
    onDocChange,
    imageWidth,
    imageHeight,
    baseSize,
    scale,
    tool,
    setTool: setToolState,
    style,
    setStyle,
    onStyleChange,
    stageRef,
    contentGroupRef,
    stageHostRef,
    textInputRef,
  });

  const resolveRatio = useCallback((value: string): number | null => {
    if (value === 'free') {
      return null;
    }
    if (value === 'original') {
      return imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : null;
    }
    return CROP_RATIO_OPTIONS.find((option) => option.value === value)?.ratio ?? null;
  }, [imageHeight, imageWidth]);

  const handleCropRatioChange = useCallback((value: string) => {
    setCropRatioValue(value);
    const ratio = resolveRatio(value);
    if (!ratio || !doc.crop || imageWidth <= 0) {
      return;
    }
    const centerX = doc.crop.x + doc.crop.width / 2;
    const centerY = doc.crop.y + doc.crop.height / 2;
    let width = doc.crop.width;
    let height = width / ratio;
    if (height > imageHeight) {
      height = imageHeight * 0.9;
      width = height * ratio;
    }
    if (width > imageWidth) {
      width = imageWidth * 0.9;
      height = width / ratio;
    }
    controller.commitDoc({
      ...doc,
      crop: clampCropRect(
        { x: centerX - width / 2, y: centerY - height / 2, width, height },
        imageWidth,
        imageHeight
      ),
    });
  }, [controller, doc, imageHeight, imageWidth, resolveRatio]);

  if (!image) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-border-dark bg-bg-dark/85 ${className}`}>
        <span className="text-sm text-text-muted">图片加载中…</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <MarkToolbar
        tool={tool}
        setTool={controller.selectTool}
        style={style}
        onStylePatch={controller.handleStylePatch}
        cropRatioValue={cropRatioValue}
        onCropRatioChange={handleCropRatioChange}
        onCropReset={controller.handleCropReset}
        hasCrop={Boolean(doc.crop)}
        onOrientation={controller.applyOrientation}
        onUndo={controller.handleUndo}
        onRedo={controller.handleRedo}
        onDeleteSelected={controller.handleDeleteSelected}
        onClear={controller.handleClear}
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        canDeleteSelected={Boolean(controller.selectedId)}
        canClear={doc.items.length > 0}
      />

      <MarkCanvas
        orientedCanvas={orientedCanvas}
        mosaicSource={mosaicSource}
        doc={doc}
        draftMark={controller.draftMark}
        tool={tool}
        cropRatio={resolveRatio(cropRatioValue)}
        selectedId={controller.selectedId}
        selectedItem={controller.selectedItem}
        textEditor={controller.textEditor}
        textEditorHostPos={controller.textEditorHostPos}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
        scale={scale}
        viewportRef={viewportRef}
        stageHostRef={stageHostRef}
        stageRef={stageRef}
        contentGroupRef={contentGroupRef}
        textInputRef={textInputRef}
        onStageKeyDown={controller.handleStageKeyDown}
        onPointerDown={controller.handlePointerDown}
        onPointerMove={controller.handlePointerMove}
        onPointerUp={controller.handlePointerUp}
        onStageDblClick={controller.handleStageDblClick}
        onSelectedIdChange={controller.setSelectedId}
        onItemsUpdated={(items) => controller.commitItems(items)}
        onStartTextEditing={(item) => controller.startTextEditing(item)}
        onTextEditorChange={(value) =>
          controller.setTextEditor((previous) => (previous ? { ...previous, value } : previous))
        }
        onCommitTextEditor={controller.handleCommitTextEditor}
        onCancelTextEditor={controller.handleCancelTextEditor}
        onCropChange={controller.handleCropChange}
        onCropCommit={controller.handleCropCommit}
      />
    </div>
  );
}
