import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type Konva from 'konva';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import {
  DEFAULT_LINE_WIDTH_PERCENT,
  DEFAULT_MOSAIC_STRENGTH_PERCENT,
  DEFAULT_TEXT_SIZE_PERCENT,
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
import { MarkEditorContextProvider, type MarkEditorContextValue } from './MarkEditorContext';
import { useMarkController } from './useMarkController';
import { useMarkHistory, type MarkHistoryController } from './useMarkHistory';
import { useNonPassiveWheel } from './useNonPassiveWheel';
import { ImageEditorShell } from '@/features/imageEdit/editor/ImageEditorShell';
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
  /** 宿主动作(取消/保存/复制等),渲染在工具行最右侧 */
  toolbarActions?: React.ReactNode;
  /** 根容器高度控制,默认适配对话框;全屏宿主传 h-full */
  className?: string;
  /** legacy 保持旧纵向布局；shell 使用顶部标注栏与右侧工具面板。 */
  layout?: 'legacy' | 'shell';
  /** shell 布局的右侧工具与参数面板，内容位于 MarkEditor 上下文内。 */
  rightPanel?: React.ReactNode;
  /** 受控文档控制器；统一图片编辑器通过此边界接入 V2 会话。 */
  documentController?: MarkEditorDocumentController;
}

export interface MarkEditorDocumentController {
  doc: ImageMarkDoc;
  setDoc: Dispatch<SetStateAction<ImageMarkDoc>>;
  onDocChange?: (doc: ImageMarkDoc) => void;
  history: MarkHistoryController;
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
  toolbarActions,
  className = 'h-[min(70vh,760px)]',
  layout = 'legacy',
  rightPanel,
  documentController,
}: MarkEditorProps): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [localDoc, setLocalDoc] = useState<ImageMarkDoc>(() => initialDoc ?? createEmptyMarkDoc());
  const [tool, setToolState] = useState<MarkToolType>('callout');
  const [style, setStyle] = useState<MarkEditorStyleState>(() => ({
    color: initialStyle?.color ?? ANNOTATION_DEFAULT_STROKE_HEX,
    lineWidthPercent: initialStyle?.lineWidthPercent ?? DEFAULT_LINE_WIDTH_PERCENT,
    textSizePercent: initialStyle?.textSizePercent ?? DEFAULT_TEXT_SIZE_PERCENT,
    mosaicStrengthPercent: initialStyle?.mosaicStrengthPercent ?? DEFAULT_MOSAIC_STRENGTH_PERCENT,
    mosaicMode: initialStyle?.mosaicMode ?? 'pixel',
    calloutShape: initialStyle?.calloutShape ?? 'rect',
  }));
  const [cropRatioValue, setCropRatioValue] = useState('free');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef<Konva.Stage | null>(null);
  const contentGroupRef = useRef<Konva.Group | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const localDocRef = useRef(localDoc);
  localDocRef.current = localDoc;
  const localHistory = useMarkHistory({
    docRef: localDocRef,
    setDoc: setLocalDoc,
    onDocChange,
    onHistoryNavigate: () => undefined,
  });
  const doc = documentController?.doc ?? localDoc;
  const setDoc = documentController?.setDoc ?? setLocalDoc;
  const resolvedOnDocChange = documentController?.onDocChange ?? onDocChange;
  const history = documentController?.history ?? localHistory;

  // ==================== 图片加载 ====================

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) {
        setImage(img);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setImage(null);
        setLoadFailed(true);
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

  // 打码取样源:按像素块尺寸惰性构建并缓存,朝向位图变化时整体失效;
  // 绘制草稿时即可取到,保证拖拽实时预览
  const mosaicSourceCacheRef = useRef<{
    canvas: HTMLCanvasElement | null;
    bySize: Map<number, HTMLCanvasElement>;
  }>({ canvas: null, bySize: new Map() });
  const getMosaicSource = useCallback((pixelSize: number): HTMLCanvasElement | null => {
    if (!orientedCanvas || pixelSize <= 0) {
      return null;
    }
    const cache = mosaicSourceCacheRef.current;
    if (cache.canvas !== orientedCanvas) {
      cache.canvas = orientedCanvas;
      cache.bySize.clear();
    }
    let source = cache.bySize.get(pixelSize) ?? null;
    if (!source) {
      source = buildMosaicSourceCanvas(orientedCanvas, pixelSize);
      cache.bySize.set(pixelSize, source);
    }
    return source;
  }, [orientedCanvas]);

  // ==================== 视口与缩放 ====================

  // 依赖 image:加载占位阶段视口容器尚未挂载,图片就绪后重新绑定 ResizeObserver
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
  }, [image]);

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
    onDocChange: resolvedOnDocChange,
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
    history,
  });

  // 选中标记后在画布上滚轮直接调节线宽/字号/打码强度
  const adjustSelectedByWheel = controller.adjustSelectedByWheel;
  useNonPassiveWheel(
    viewportRef,
    (event) => {
      if (adjustSelectedByWheel(event.deltaY)) {
        event.preventDefault();
      }
    },
    image
  );

  // 编辑器挂载期间全局响应快捷键(输入控件聚焦时除外),不要求画布先获得焦点
  const editorKeyDownHandler = controller.handleEditorKeyDown;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      editorKeyDownHandler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorKeyDownHandler]);

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
        <span className="text-sm text-text-muted">{loadFailed ? '图片加载失败' : '图片加载中…'}</span>
      </div>
    );
  }

  const toolbar = (
    <MarkToolbar
        variant={layout === 'shell' ? 'annotation' : 'legacy'}
        tool={tool}
        setTool={controller.selectTool}
        style={style}
        onStylePatch={controller.handleStylePatch}
        onStyleWheel={controller.adjustStyleByWheel}
        cropRatioValue={cropRatioValue}
        onCropRatioChange={handleCropRatioChange}
        onCropReset={controller.handleCropReset}
        hasCrop={Boolean(doc.crop)}
        onOrientation={controller.applyOrientation}
        onUndo={controller.handleUndo}
        onRedo={controller.handleRedo}
        onClear={controller.handleClear}
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        canClear={doc.items.length > 0}
        actions={toolbarActions}
      />
  );

  const canvas = (
    <MarkCanvas
        orientedCanvas={orientedCanvas}
        getMosaicSource={getMosaicSource}
        doc={doc}
        draftMark={controller.draftMark}
        tool={tool}
        cropRatio={resolveRatio(cropRatioValue)}
        selectedId={controller.selectedId}
        selectedItem={controller.selectedItem}
        activeLabelId={controller.activeLabelId}
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
        onPointerDown={controller.handlePointerDown}
        onPointerMove={controller.handlePointerMove}
        onPointerUp={controller.handlePointerUp}
        onStageDblClick={controller.handleStageDblClick}
        onSelectedIdChange={controller.setSelectedId}
        onSelectLabel={controller.selectLabel}
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
  );

  const contextValue: MarkEditorContextValue = {
    doc,
    tool,
    selectTool: controller.selectTool,
    style,
    onStylePatch: controller.handleStylePatch,
    cropRatioValue,
    onCropRatioChange: handleCropRatioChange,
    onCropReset: controller.handleCropReset,
    hasCrop: Boolean(doc.crop),
    onOrientation: controller.applyOrientation,
    history,
  };

  const content = layout === 'shell'
    ? (
      <ImageEditorShell
        className={className}
        toolbar={toolbar}
        canvas={canvas}
        sidePanel={rightPanel ?? <div className="flex-1" />}
      />
    )
    : (
      <div className={`flex flex-col gap-3 ${className}`}>
        {toolbar}
        {canvas}
      </div>
    );

  return <MarkEditorContextProvider value={contextValue}>{content}</MarkEditorContextProvider>;
}
