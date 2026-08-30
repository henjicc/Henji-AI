import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  BLACK_HEX,
  WHITE_HEX,
} from '@/core/theme/colorTokens';
import { PEN_TENSION } from '@/features/imageMark/domain/penGeometry';
import { createMaskBrushRenderLayers, normalizeMaskBrushHardness } from './brushHardness';
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
  MaskShape,
  MaskStroke,
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

function createMarkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mask-mark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function flatPoints(points: MaskPoint[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function MaskStrokePreview({ stroke }: { stroke: MaskStroke }): JSX.Element | null {
  const isErase = stroke.mode === 'erase';
  const layers = createMaskBrushRenderLayers(
    stroke.size,
    stroke.hardness,
    isErase ? 1 : 0.55
  );
  if (stroke.points.length === 0) return null;
  return (
    <>
      {layers.map((layer, index) => {
        const shared = {
          opacity: layer.opacity,
          globalCompositeOperation: isErase ? 'destination-out' as const : 'source-over' as const,
          listening: false,
        };
        if (stroke.points.length === 1) {
          return (
            <Circle
              key={`${stroke.id}-layer-${index}`}
              x={stroke.points[0].x}
              y={stroke.points[0].y}
              radius={layer.size / 2}
              fill={ANNOTATION_DEFAULT_STROKE_HEX}
              {...shared}
            />
          );
        }
        return (
          <Line
            key={`${stroke.id}-layer-${index}`}
            points={flatPoints(stroke.points)}
            stroke={ANNOTATION_DEFAULT_STROKE_HEX}
            strokeWidth={layer.size}
            lineCap="round"
            lineJoin="round"
            tension={PEN_TENSION}
            {...shared}
          />
        );
      })}
    </>
  );
}

function MaskShapePreview({ shape }: { shape: MaskShape }): JSX.Element | null {
  const shared = {
    fill: ANNOTATION_DEFAULT_STROKE_HEX,
    opacity: shape.mode === 'erase' ? 1 : 0.55,
    globalCompositeOperation: shape.mode === 'erase' ? 'destination-out' as const : 'source-over' as const,
    listening: false,
  };
  if (shape.kind === 'lasso') {
    if (shape.points.length < 2) return null;
    return <Line points={flatPoints(shape.points)} closed {...shared} />;
  }
  const [start, end] = shape.points;
  if (!start || !end) return null;
  const { x, y, width, height } = resolveMaskShapeBounds(shape.kind, start, end);
  if (shape.kind === 'rectangle') {
    return <Rect x={x} y={y} width={width} height={height} {...shared} />;
  }
  return (
    <Ellipse
      x={x + width / 2}
      y={y + height / 2}
      radiusX={width / 2}
      radiusY={height / 2}
      {...shared}
    />
  );
}

function MaskMarkPreview({ mark }: { mark: MaskMark }): JSX.Element | null {
  return isMaskStroke(mark)
    ? <MaskStrokePreview stroke={mark} />
    : <MaskShapePreview shape={mark} />;
}

const MaskDocumentPreview = memo(function MaskDocumentPreview({
  marks,
}: {
  marks: readonly MaskMark[];
}): JSX.Element {
  return (
    <>
      {marks.map((mark) => <MaskMarkPreview key={mark.id} mark={mark} />)}
    </>
  );
});

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

export function MaskEditorCanvas({
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
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-bg-dark/85 p-3"
      data-application-observation-region="mask_editor.canvas"
    >
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
            <MaskDocumentPreview marks={document.strokes} />
            {draft ? <MaskMarkPreview mark={draft} /> : null}
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
}
