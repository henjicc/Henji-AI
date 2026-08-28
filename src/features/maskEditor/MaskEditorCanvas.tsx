import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import { PEN_TENSION } from '@/features/imageMark/domain/penGeometry';
import {
  appendMaskPoint,
  clampMaskPoint,
  fitMaskStage,
} from './maskDocument';
import type { MaskEditorDocument, MaskPoint, MaskStroke, MaskStrokeMode } from './types';

interface MaskEditorCanvasProps {
  image: HTMLImageElement;
  document: MaskEditorDocument;
  mode: MaskStrokeMode;
  brushSize: number;
  onStrokeComplete: (stroke: MaskStroke) => void;
}

function createStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mask-stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function strokePoints(stroke: MaskStroke): number[] {
  return stroke.points.flatMap((point) => [point.x, point.y]);
}

function MaskStrokePreview({ stroke }: { stroke: MaskStroke }): JSX.Element | null {
  const isErase = stroke.mode === 'erase';
  const shared = {
    fill: ANNOTATION_DEFAULT_STROKE_HEX,
    opacity: 0.55,
    globalCompositeOperation: isErase ? 'destination-out' as const : 'source-over' as const,
    listening: false,
  };
  if (stroke.points.length === 1) {
    return (
      <Circle
        x={stroke.points[0].x}
        y={stroke.points[0].y}
        radius={stroke.size / 2}
        {...shared}
      />
    );
  }
  if (stroke.points.length < 2) return null;
  return (
    <Line
      points={strokePoints(stroke)}
      stroke={ANNOTATION_DEFAULT_STROKE_HEX}
      strokeWidth={stroke.size}
      lineCap="round"
      lineJoin="round"
      tension={PEN_TENSION}
      {...shared}
    />
  );
}

export function MaskEditorCanvas({
  image,
  document,
  mode,
  brushSize,
  onStrokeComplete,
}: MaskEditorCanvasProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<MaskStroke | null>(null);
  const [draft, setDraft] = useState<MaskStroke | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      setViewportSize({
        width: Math.max(1, viewport.clientWidth),
        height: Math.max(1, viewport.clientHeight),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draftRef.current = null;
    setDraft(null);
  }, [document.sourceRef]);

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

  const updateDraft = useCallback((next: MaskStroke | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const handlePointerDown = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.evt.preventDefault();
    const point = resolvePoint(event);
    if (!point) return;
    updateDraft({
      id: createStrokeId(),
      mode,
      size: brushSize,
      points: [point],
    });
  }, [brushSize, mode, resolvePoint, updateDraft]);

  const handlePointerMove = useCallback((event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const current = draftRef.current;
    if (!current) return;
    event.evt.preventDefault();
    const point = resolvePoint(event);
    if (!point) return;
    const points = appendMaskPoint(current.points, point);
    if (points === current.points) return;
    updateDraft({ ...current, points });
  }, [resolvePoint, updateDraft]);

  const handlePointerUp = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    updateDraft(null);
    onStrokeComplete(current);
  }, [onStrokeComplete, updateDraft]);

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
        onMouseLeave={handlePointerUp}
        className="cursor-crosshair"
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
            {document.strokes.map((stroke) => (
              <MaskStrokePreview key={stroke.id} stroke={stroke} />
            ))}
            {draft ? <MaskStrokePreview stroke={draft} /> : null}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
