import { MaskRegionRasterizer } from './regionWorkerClient';
import { UiButton, UiError } from '@/components/ui';
import { createLogger } from '@/core/logging';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewportPan } from '@/core/viewport/zoomPan';
import { useZoomPanViewport } from '@/hooks/useZoomPanViewport';
import {
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
} from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  BLACK_HEX,
  WHITE_HEX,
} from '@/core/theme/colorTokens';
import { normalizeMaskBrushHardness } from './brushHardness';
import {
  appendMaskPoint,
  clampMaskPoint,
  fitMaskStage,
  isMaskStroke,
  resolveMaskShapeBounds,
} from './maskDocument';
import type {
  MaskEditorDocument,
  MaskMark,
  MaskPoint,
  MaskStrokeMode,
  MaskTool,
} from './types';

interface MaskEditorCanvasProps {
  image: HTMLImageElement;
  document: MaskEditorDocument;
  tool: MaskTool;
  mode: MaskStrokeMode;
  brushSize: number;
  brushHardness: number;
  onMarkComplete: (mark: MaskMark) => void;
}

const logger = createLogger('features.maskEditor.preview');

/** 相对“适合”最多放大 8 倍，不缩得比“适合”更小（再小没有用处）。 */
const ZOOM_LIMITS = { min: 1, max: 8 };

/** 遮罩叠在画面上的不透明度：Worker 算出的预览与正在画的一笔用同一个值。 */
const MASK_PREVIEW_OPACITY = 0.55;

function createMarkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mask-mark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraft(
  tool: MaskTool,
  mode: MaskStrokeMode,
  point: MaskPoint,
  brushSize: number,
  brushHardness: number
): MaskMark {
  if (tool === 'brush') {
    return {
      id: createMarkId(),
      kind: 'stroke',
      mode,
      size: brushSize,
      hardness: normalizeMaskBrushHardness(brushHardness),
      points: [point],
    };
  }
  return {
    id: createMarkId(),
    kind: tool,
    mode,
    points: tool === 'lasso' ? [point] : [point, point],
  };
}

function updateDraftPoint(mark: MaskMark, point: MaskPoint): MaskMark {
  if (isMaskStroke(mark) || mark.kind === 'lasso') {
    const points = appendMaskPoint(mark.points, point);
    return points === mark.points ? mark : { ...mark, points };
  }
  return { ...mark, points: [mark.points[0], point] };
}

function isMeaningfulMark(mark: MaskMark): boolean {
  if (isMaskStroke(mark)) return mark.points.length > 0;
  if (mark.kind === 'lasso') return mark.points.length >= 3;
  const [start, end] = mark.points;
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = Math.abs(end.y - start.y);
  return mark.kind === 'circle' ? Math.max(deltaX, deltaY) >= 1 : deltaX >= 1 && deltaY >= 1;
}

export const MaskEditorCanvas = memo(function MaskEditorCanvas({
  image,
  document,
  tool,
  mode,
  brushSize,
  brushHardness,
  onMarkComplete,
}: MaskEditorCanvasProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<MaskMark | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const cursorRef = useRef<Konva.Group>(null);
  // 正在画的这一笔直接用形状画出来；松手提交后继续留着，等遮罩预览算出包含它的结果再撤掉，中间不闪
  const [draft, setDraft] = useState<MaskMark | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      setViewportSize((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }
    draftRef.current = null;
    setDraft(null);
  }, [document.sourceRef, mode, tool]);

  useEffect(() => () => {
    if (renderFrameRef.current !== null) window.cancelAnimationFrame(renderFrameRef.current);
  }, []);

  const { t } = useTranslation('ui');
  const fit = fitMaskStage(
    viewportSize.width,
    viewportSize.height,
    document.width,
    document.height
  );
  // 放大后画面比视口大时，边缘不拖进视口里；比视口小时保持居中
  const clampPan = useCallback((pan: ViewportPan, zoom: number): ViewportPan => {
    const maxX = Math.max(0, (document.width * fit.scale * zoom - viewportSize.width) / 2);
    const maxY = Math.max(0, (document.height * fit.scale * zoom - viewportSize.height) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) };
  }, [document.height, document.width, fit.scale, viewportSize.height, viewportSize.width]);
  const view = useZoomPanViewport(viewportRef, { limits: ZOOM_LIMITS, clampPan, resetKey: document.sourceRef });
  const panReadyRef = useRef(view.panReady);
  panReadyRef.current = view.panReady;
  // 画面在舞台上的像素尺度与左上角位置：舞台铺满视口，画面按“适合 × 缩放”居中再加平移
  const displayScale = fit.scale * view.zoom;
  const placed = useMemo(() => {
    const width = document.width * displayScale;
    const height = document.height * displayScale;
    return {
      x: (viewportSize.width - width) / 2 + view.pan.x,
      y: (viewportSize.height - height) / 2 + view.pan.y,
      gridWidth: Math.max(1, Math.round(width)),
      gridHeight: Math.max(1, Math.round(height)),
    };
  }, [displayScale, document.height, document.width, view.pan.x, view.pan.y, viewportSize.height, viewportSize.width]);
  // 遮罩只算视口里看得见的那一块，按屏幕分辨率求值：放大后边缘清楚，算量也不随放大倍数增长
  const visible = useMemo(() => {
    const x = Math.max(0, Math.floor(-placed.x));
    const y = Math.max(0, Math.floor(-placed.y));
    const right = Math.min(placed.gridWidth, Math.ceil(viewportSize.width - placed.x));
    const bottom = Math.min(placed.gridHeight, Math.ceil(viewportSize.height - placed.y));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }, [placed, viewportSize.height, viewportSize.width]);

  const rasterizerRef = useRef<MaskRegionRasterizer | null>(null);
  // 预览记下自己算出时的画面尺度：缩放、平移时先把旧预览按新尺度摆到对的位置，新的算好再替换，不会闪
  const [preview, setPreview] = useState<{ canvas: HTMLCanvasElement; region: { x: number; y: number; width: number; height: number }; gridWidth: number } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    const rasterizer = new MaskRegionRasterizer({ version: 1, sourceRef: document.sourceRef,
      width: document.width, height: document.height, strokes: [] });
    rasterizerRef.current = rasterizer;
    return () => { rasterizer.dispose(); rasterizerRef.current = null; };
  }, [document.sourceRef, document.width, document.height, previewAttempt]);

  // 像素求值在 Worker 里，只按已提交的遮罩算；正在画的那一笔不进求值，笔画再多拖动也不变慢
  useEffect(() => {
    const rasterizer = rasterizerRef.current;
    if (!rasterizer) return;
    let cancelled = false;
    setPreviewFailed(false);
    logger.debug('遮罩预览求值开始', { event: 'mask_editor.preview.start' });
    const region = visible;
    const gridWidth = placed.gridWidth;
    void rasterizer.readLatest(document, region, { width: gridWidth, height: placed.gridHeight })
      .then(coverage => {
        if (cancelled) return;
        const canvas = window.document.createElement('canvas');
        canvas.width = region.width; canvas.height = region.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法初始化遮罩预览');
        const pixels = context.createImageData(region.width, region.height);
        const color = ANNOTATION_DEFAULT_STROKE_HEX.slice(1);
        const channels = [0, 2, 4].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
        for (let i = 0; i < coverage.length; i++) {
          for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = channels[c];
          pixels.data[i * 4 + 3] = Math.round(coverage[i] * MASK_PREVIEW_OPACITY * 255);
        }
        context.putImageData(pixels, 0, 0);
        setPreview({ canvas, region, gridWidth });
        if (!draftRef.current) setDraft(null);
        logger.debug('遮罩预览求值完成', { event: 'mask_editor.preview.completed' });
      }).catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null); setPreviewFailed(true);
        logger.error('遮罩预览求值失败', error, { event: 'mask_editor.preview.failed' });
      });
    return () => { cancelled = true; };
  }, [document, placed.gridWidth, placed.gridHeight, visible, previewAttempt]);

  /** 指针在画面里的位置（文档像素，不夹到画面边缘）；画面外返回的点超出 0…宽高。 */
  const rawPoint = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>): MaskPoint | null => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return null;
    return { x: (pointer.x - placed.x) / displayScale, y: (pointer.y - placed.y) / displayScale };
  }, [displayScale, placed.x, placed.y]);
  const insideImage = useCallback((point: MaskPoint): boolean => (
    point.x >= 0 && point.y >= 0 && point.x <= document.width && point.y <= document.height
  ), [document.height, document.width]);

  /**
   * 笔刷光圈直接移动 Konva 节点，不走 React 渲染：每次移动只重画光圈这一层，跟手。
   * 指针出了画面就藏起光圈、换回普通光标，不把光圈夹在画面边缘。
   */
  const moveCursor = useCallback((point: MaskPoint | null, stage: Konva.Stage | null) => {
    const cursor = cursorRef.current;
    const inside = point !== null && insideImage(point);
    if (cursor) {
      const show = inside && tool === 'brush' && !panReadyRef.current;
      cursor.visible(show);
      if (show) cursor.position(point);
      cursor.getLayer()?.batchDraw();
    }
    const container = stage?.container();
    // 平移时交给抓手光标的类名；画面外明确用普通箭头，不继承画布节点的拖动光标
    if (container) container.style.cursor = panReadyRef.current ? '' : !inside ? 'default' : tool === 'brush' ? 'none' : 'crosshair';
  }, [insideImage, tool]);

  const scheduleDraftRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      setDraft(draftRef.current);
    });
  }, []);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.evt.preventDefault();
    if (view.panReady) return;
    const point = rawPoint(event);
    if (!point || !insideImage(point)) return;
    draftRef.current = createDraft(tool, mode, point, brushSize, brushHardness);
    scheduleDraftRender();
  }, [brushHardness, brushSize, insideImage, mode, rawPoint, scheduleDraftRender, tool, view.panReady]);

  const handlePointerMove = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const point = rawPoint(event);
    if (event.evt instanceof MouseEvent) moveCursor(point, event.target.getStage());
    const current = draftRef.current;
    if (!current || !point) return;
    event.evt.preventDefault();
    const next = updateDraftPoint(current, clampMaskPoint(point, document.width, document.height));
    if (next === current) return;
    draftRef.current = next;
    scheduleDraftRender();
  }, [document.height, document.width, moveCursor, rawPoint, scheduleDraftRender]);

  const handlePointerUp = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    if (isMeaningfulMark(current)) {
      setDraft(current);
      onMarkComplete(current);
    } else {
      setDraft(null);
    }
  }, [onMarkComplete]);

  const handleMouseLeave = useCallback((event: KonvaEventObject<MouseEvent>) => {
    handlePointerUp();
    moveCursor(null, event.target.getStage());
  }, [handlePointerUp, moveCursor]);

  const cursorClass = view.panning ? 'cursor-grabbing' : view.panReady ? 'cursor-grab' : '';
  const zoomLabel = view.zoom === 1 ? t('viewportZoom.fit') : `${Math.round(view.zoom * 100)}%`;
  const normalizedHardness = normalizeMaskBrushHardness(brushHardness);
  const previewScale = preview ? placed.gridWidth / preview.gridWidth : 1;

  return (
    <div
      ref={viewportRef}
      className="nopan nowheel relative min-h-0 flex-1 overflow-hidden"
      data-application-observation-region="mask_editor.canvas"
    >
      {previewFailed ? <div className="absolute inset-0 z-raised bg-gap/85"><UiError className="h-full" title="遮罩预览失败" message="请重试，或关闭后重新打开参考图。" onRetry={() => setPreviewAttempt(value => value + 1)} /></div> : null}
      <Stage
        width={viewportSize.width}
        height={viewportSize.height}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchEnd={handlePointerUp}
        onMouseLeave={handleMouseLeave}
        className={cursorClass}
      >
        <Layer listening={false}>
          <KonvaImage image={image} x={placed.x} y={placed.y} width={document.width * displayScale} height={document.height * displayScale} />
        </Layer>
        <Layer listening={false}>
          {preview ? (
            <KonvaImage
              image={preview.canvas}
              x={placed.x + preview.region.x * previewScale}
              y={placed.y + preview.region.y * previewScale}
              width={preview.region.width * previewScale}
              height={preview.region.height * previewScale}
            />
          ) : null}
          {draft ? (
            <Group x={placed.x} y={placed.y} scaleX={displayScale} scaleY={displayScale}>
              <DraftMark mark={draft} />
            </Group>
          ) : null}
        </Layer>
        <Layer>
          <Rect name="mask-editor-background" width={viewportSize.width} height={viewportSize.height} fill="transparent" />
          <Group x={placed.x} y={placed.y} scaleX={displayScale} scaleY={displayScale} listening={false}>
            <Group ref={cursorRef} visible={false}>
              <Circle radius={brushSize / 2} stroke={BLACK_HEX} strokeWidth={3 / displayScale} />
              <Circle radius={brushSize / 2} stroke={WHITE_HEX} strokeWidth={1 / displayScale} />
              {normalizedHardness < 0.999 ? (
                <Circle
                  radius={(brushSize * normalizedHardness) / 2}
                  stroke={mode === 'paint' ? ANNOTATION_DEFAULT_STROKE_HEX : BLACK_HEX}
                  strokeWidth={1 / displayScale}
                  dash={[4 / displayScale, 3 / displayScale]}
                />
              ) : null}
            </Group>
          </Group>
        </Layer>
      </Stage>
      <UiButton
        variant="media"
        size="sm"
        className="absolute bottom-2 left-2 tabular-nums"
        tooltip={t('viewportZoom.hint')}
        onClick={view.reset}
      >
        {zoomLabel}
      </UiButton>
    </div>
  );
});

/**
 * 正在画的一笔的即时形状（文档坐标）：涂抹用遮罩同色半透明，擦除在遮罩层上直接挖掉。
 * 软边笔刷的边缘以松手后 Worker 算出的结果为准，这里只求跟手。
 */
function DraftMark({ mark }: { mark: MaskMark }): JSX.Element | null {
  const erase = mark.mode === 'erase';
  const paint = erase
    ? { globalCompositeOperation: 'destination-out' as const, opacity: 1 }
    : { opacity: MASK_PREVIEW_OPACITY };
  if (isMaskStroke(mark)) {
    const points = mark.points.length === 1 ? [mark.points[0], mark.points[0]] : mark.points;
    return <Line points={points.flatMap((point) => [point.x, point.y])} stroke={ANNOTATION_DEFAULT_STROKE_HEX} strokeWidth={mark.size} lineCap="round" lineJoin="round" {...paint} />;
  }
  if (mark.kind === 'lasso') {
    return <Line points={mark.points.flatMap((point) => [point.x, point.y])} closed fill={ANNOTATION_DEFAULT_STROKE_HEX} {...paint} />;
  }
  const bounds = resolveMaskShapeBounds(mark.kind, mark.points[0], mark.points[1]);
  return mark.kind === 'circle'
    ? <Ellipse x={bounds.x + bounds.width / 2} y={bounds.y + bounds.height / 2} radiusX={bounds.width / 2} radiusY={bounds.height / 2} fill={ANNOTATION_DEFAULT_STROKE_HEX} {...paint} />
    : <Rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={ANNOTATION_DEFAULT_STROKE_HEX} {...paint} />;
}
