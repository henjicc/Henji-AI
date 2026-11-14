import { MaskRegionRasterizer } from './regionWorkerClient';
import { UiButton, UiError } from '@/components/ui';
import { createLogger } from '@/core/logging';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewportPan } from '@/core/viewport/zoomPan';
import { useZoomPanViewport, type RetainedZoomPan } from '@/hooks/useZoomPanViewport';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
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
} from './maskDocument';
import { MaskLiveRaster } from './maskLiveRaster';
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
  /** 所在界面会被卸载再挂上（画布节点正文）时传入，缩放平移跨卸载保留。 */
  retainedView?: MutableRefObject<RetainedZoomPan | null>;
}

const logger = createLogger('features.maskEditor.preview');

/** 相对“适合”最多放大 8 倍，不缩得比“适合”更小（再小没有用处）。 */
const ZOOM_LIMITS = { min: 1, max: 8 };

/** 遮罩叠在画面上的颜色与不透明度。 */
const MASK_PREVIEW_OPACITY = 0.55;
const MASK_COLOR = [0, 2, 4].map(offset => Number.parseInt(ANNOTATION_DEFAULT_STROKE_HEX.slice(1 + offset, 3 + offset), 16)) as [number, number, number];

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
  retainedView,
}: MaskEditorCanvasProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<MaskMark | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const cursorRef = useRef<Konva.Group>(null);
  const maskImageRef = useRef<Konva.Image>(null);
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
    rasterRef.current?.cancel();
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
  const view = useZoomPanViewport(viewportRef, { limits: ZOOM_LIMITS, clampPan, resetKey: document.sourceRef, retained: retainedView });
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
  // 整张遮罩的显示栅格：缩放、平移只是换尺度显示它，不重算；正在画的一笔直接合进它（见 MaskLiveRaster）
  const raster = useMemo(() => new MaskLiveRaster(document.width, document.height, MASK_COLOR, MASK_PREVIEW_OPACITY),
    // sourceRef 换了就是另一张图的遮罩
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document.sourceRef, document.width, document.height]);
  const rasterRef = useRef(raster);
  rasterRef.current = raster;
  const redrawMask = useCallback(() => { maskImageRef.current?.getLayer()?.batchDraw(); }, []);

  const rasterizerRef = useRef<MaskRegionRasterizer | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    const rasterizer = new MaskRegionRasterizer({ version: 1, sourceRef: document.sourceRef,
      width: document.width, height: document.height, strokes: [] });
    rasterizerRef.current = rasterizer;
    return () => { rasterizer.dispose(); rasterizerRef.current = null; };
  }, [document.sourceRef, document.width, document.height, previewAttempt]);

  // 文档变了（提交一笔、撤销、重做、清空）才由 Worker 按文档求整张遮罩；缩放平移不求值。
  // 正在画下一笔时到达的结果不覆盖（它不含这一笔），这一笔提交后会再求一次。
  useEffect(() => {
    const rasterizer = rasterizerRef.current;
    if (!rasterizer) return;
    let cancelled = false;
    setPreviewFailed(false);
    logger.debug('遮罩求值开始', { event: 'mask_editor.preview.start' });
    void rasterizer.readLatest(document, { x: 0, y: 0, ...raster.grid }, raster.grid)
      .then(coverage => {
        if (cancelled || raster.drawing) return;
        raster.setCoverage(coverage);
        redrawMask();
        logger.debug('遮罩求值完成', { event: 'mask_editor.preview.completed' });
      }).catch((error: unknown) => {
        if (cancelled) return;
        setPreviewFailed(true);
        logger.error('遮罩求值失败', error, { event: 'mask_editor.preview.failed' });
      });
    return () => { cancelled = true; };
  }, [document, raster, redrawMask, previewAttempt]);

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

  // 一帧合并一次：指针事件比刷新快时只按最后一个点算这一帧扫过的那块
  const scheduleDraftRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      const current = draftRef.current;
      if (!current) return;
      rasterRef.current.update(current);
      redrawMask();
    });
  }, [redrawMask]);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.evt.preventDefault();
    if (view.panReady) return;
    const point = rawPoint(event);
    if (!point || !insideImage(point)) return;
    const mark = createDraft(tool, mode, point, brushSize, brushHardness);
    draftRef.current = mark;
    rasterRef.current.begin(mark);
    redrawMask();
  }, [brushHardness, brushSize, insideImage, mode, rawPoint, redrawMask, tool, view.panReady]);

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
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }
    const raster = rasterRef.current;
    // 提交的这一笔已经画在遮罩上：留着它，直到 Worker 按新文档求出的结果替换进来
    if (isMeaningfulMark(current)) {
      raster.update(current);
      raster.end();
      onMarkComplete(current);
    } else {
      raster.cancel();
    }
    redrawMask();
  }, [onMarkComplete, redrawMask]);

  const handleMouseLeave = useCallback((event: KonvaEventObject<MouseEvent>) => {
    handlePointerUp();
    moveCursor(null, event.target.getStage());
  }, [handlePointerUp, moveCursor]);

  const cursorClass = view.panning ? 'cursor-grabbing' : view.panReady ? 'cursor-grab' : '';
  const zoomLabel = view.zoom === 1 ? t('viewportZoom.fit') : `${Math.round(view.zoom * 100)}%`;
  const normalizedHardness = normalizeMaskBrushHardness(brushHardness);

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
          <KonvaImage ref={maskImageRef} image={raster.canvas} x={placed.x} y={placed.y} width={document.width * displayScale} height={document.height * displayScale} />
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
