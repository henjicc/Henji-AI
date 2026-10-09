import { MaskRegionRasterizer } from './regionWorkerClient';
import { UiError } from '@/components/ui';
import { createLogger } from '@/core/logging';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
} from 'react-konva';
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
  const cursorPointRef = useRef<MaskPoint | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<MaskMark | null>(null);
  const [cursorPoint, setCursorPoint] = useState<MaskPoint | null>(null);
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
    cursorPointRef.current = null;
    setDraft(null);
    setCursorPoint(null);
  }, [document.sourceRef, mode, tool]);

  useEffect(() => () => {
    if (renderFrameRef.current !== null) window.cancelAnimationFrame(renderFrameRef.current);
  }, []);

  const fit = fitMaskStage(
    viewportSize.width,
    viewportSize.height,
    document.width,
    document.height
  );

  const rasterizerRef = useRef<MaskRegionRasterizer | null>(null);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    const rasterizer = new MaskRegionRasterizer({ version: 1, sourceRef: document.sourceRef,
      width: document.width, height: document.height, strokes: [] });
    rasterizerRef.current = rasterizer;
    return () => { rasterizer.dispose(); rasterizerRef.current = null; };
  }, [document.sourceRef, document.width, document.height, previewAttempt]);

  // Pixel evaluation stays in the worker; only viewport-sized presentation is written on the UI thread.
  useEffect(() => {
    const rasterizer = rasterizerRef.current;
    if (!rasterizer) return;
    let cancelled = false;
    setPreviewFailed(false);
    logger.debug('遮罩预览求值开始', { event: 'mask_editor.preview.start' });
    void rasterizer.readLatest(draft ? { ...document, strokes: [...document.strokes, draft] } : document,
      { x: 0, y: 0, width: fit.width, height: fit.height }, { width: fit.width, height: fit.height })
      .then(coverage => {
        if (cancelled) return;
        const canvas = window.document.createElement('canvas');
        canvas.width = fit.width; canvas.height = fit.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法初始化遮罩预览');
        const pixels = context.createImageData(fit.width, fit.height);
        const color = ANNOTATION_DEFAULT_STROKE_HEX.slice(1);
        const channels = [0, 2, 4].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
        for (let i = 0; i < coverage.length; i++) {
          for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = channels[c];
          pixels.data[i * 4 + 3] = Math.round(coverage[i] * 0.55 * 255);
        }
        context.putImageData(pixels, 0, 0);
        setPreview(canvas);
        logger.debug('遮罩预览求值完成', { event: 'mask_editor.preview.completed' });
      }).catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null); setPreviewFailed(true);
        logger.error('遮罩预览求值失败', error, { event: 'mask_editor.preview.failed' });
      });
    return () => { cancelled = true; };
  }, [document, draft, fit.width, fit.height, previewAttempt]);

  const resolvePoint = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>): MaskPoint | null => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return null;
    return clampMaskPoint(
      { x: pointer.x / fit.scale, y: pointer.y / fit.scale },
      document.width,
      document.height
    );
  }, [document.height, document.width, fit.scale]);

  const scheduleInteractiveRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      setDraft(draftRef.current);
      setCursorPoint(cursorPointRef.current);
    });
  }, []);

  const updateDraft = useCallback((next: MaskMark | null) => {
    draftRef.current = next;
    scheduleInteractiveRender();
  }, [scheduleInteractiveRender]);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.evt.preventDefault();
    const point = resolvePoint(event);
    if (!point) return;
    if (event.evt instanceof MouseEvent) cursorPointRef.current = point;
    updateDraft(createDraft(tool, mode, point, brushSize, brushHardness));
  }, [brushHardness, brushSize, mode, resolvePoint, tool, updateDraft]);

  const handlePointerMove = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const point = resolvePoint(event);
    if (!point) return;
    if (event.evt instanceof MouseEvent) {
      cursorPointRef.current = point;
      scheduleInteractiveRender();
    }
    const current = draftRef.current;
    if (!current) return;
    event.evt.preventDefault();
    const next = updateDraftPoint(current, point);
    if (next !== current) updateDraft(next);
  }, [resolvePoint, scheduleInteractiveRender, updateDraft]);

  const handlePointerUp = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    if (isMeaningfulMark(current)) onMarkComplete(current);
  }, [onMarkComplete]);

  const handleMouseLeave = useCallback(() => {
    handlePointerUp();
    cursorPointRef.current = null;
    setCursorPoint(null);
  }, [handlePointerUp]);

  const showBrushCursor = cursorPoint && tool === 'brush';
  const normalizedHardness = normalizeMaskBrushHardness(brushHardness);

  return (
    <div
      ref={viewportRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gap/85 p-3"
      data-application-observation-region="mask_editor.canvas"
    >
      {previewFailed ? <div className="absolute inset-0 z-raised bg-gap/85"><UiError className="h-full" title="遮罩预览失败" message="请重试，或关闭后重新打开参考图。" onRetry={() => setPreviewAttempt(value => value + 1)} /></div> : null}
      <Stage
        width={fit.width}
        height={fit.height}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchEnd={handlePointerUp}
        onMouseLeave={handleMouseLeave}
        className={tool === 'brush' ? 'cursor-none' : 'cursor-crosshair'}
      >
        <Layer listening={false}>
          <KonvaImage image={image} width={fit.width} height={fit.height} />
        </Layer>
        <Layer>
          <Group scaleX={fit.scale} scaleY={fit.scale}>
            <Rect
              name="mask-editor-background"
              width={document.width}
              height={document.height}
              fill="transparent"
            />
            {preview ? <KonvaImage image={preview} width={document.width} height={document.height} listening={false} /> : null}
            {showBrushCursor ? (
              <>
                <Circle
                  x={cursorPoint.x}
                  y={cursorPoint.y}
                  radius={brushSize / 2}
                  stroke={BLACK_HEX}
                  strokeWidth={3 / fit.scale}
                  listening={false}
                />
                <Circle
                  x={cursorPoint.x}
                  y={cursorPoint.y}
                  radius={brushSize / 2}
                  stroke={WHITE_HEX}
                  strokeWidth={1 / fit.scale}
                  listening={false}
                />
                {normalizedHardness < 0.999 ? (
                  <Circle
                    x={cursorPoint.x}
                    y={cursorPoint.y}
                    radius={(brushSize * normalizedHardness) / 2}
                    stroke={mode === 'paint' ? ANNOTATION_DEFAULT_STROKE_HEX : BLACK_HEX}
                    strokeWidth={1 / fit.scale}
                    dash={[4 / fit.scale, 3 / fit.scale]}
                    listening={false}
                  />
                ) : null}
              </>
            ) : null}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
});
