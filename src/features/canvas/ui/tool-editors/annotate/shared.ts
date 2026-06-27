import { ArrowRight, Brush, Circle, Square, Type } from 'lucide-react';
import type { ToolOptions } from '@/features/canvas/tools';
import { normalizeAnnotationRect, type AnnotationItem, type AnnotationToolType } from '@/features/canvas/tools/annotation';

export const VIEWPORT_PADDING_PX = 16;
export const VIEWPORT_MIN_WIDTH_PX = 220;
export const VIEWPORT_MIN_HEIGHT_PX = 180;
export const DEFAULT_TEXT_SIZE_PERCENT = 10;
export const MIN_TEXT_SIZE_PERCENT = 1;
export const MAX_TEXT_SIZE_PERCENT = 30;
export const DEFAULT_LINE_WIDTH_PERCENT = 0.4;
export const MIN_LINE_WIDTH_PERCENT = 0.1;
export const MAX_LINE_WIDTH_PERCENT = 3;

export type DraftState = {
  tool: Exclude<AnnotationToolType, 'text'>;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points?: number[];
};

export interface TextEditorState {
  annotationId: string | null;
  x: number;
  y: number;
  value: string;
}

type ToolButton = { type: AnnotationToolType; label: string; icon: typeof Square };

export const TOOL_BUTTONS: ToolButton[] = [
  { type: 'rect', label: '矩形', icon: Square },
  { type: 'ellipse', label: '圆形', icon: Circle },
  { type: 'arrow', label: '箭头', icon: ArrowRight },
  { type: 'pen', label: '画笔', icon: Brush },
  { type: 'text', label: '文本', icon: Type },
];

export function toNumber(value: DynamicValue, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function toText(value: DynamicValue, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function createAnnotationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveTextBaseSize(image: HTMLImageElement | null): number {
  if (!image) {
    return 1000;
  }
  return Math.max(320, Math.min(image.naturalWidth, image.naturalHeight));
}

export function percentToFontSize(percent: number, baseSize: number): number {
  return Math.max(10, Math.round(baseSize * (percent / 100)));
}

export function fontSizeToPercent(fontSize: number, baseSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return DEFAULT_TEXT_SIZE_PERCENT;
  }
  return (fontSize / Math.max(1, baseSize)) * 100;
}

export function percentToLineWidth(percent: number, baseSize: number): number {
  return Math.max(1, Math.round(baseSize * (percent / 100)));
}

export function lineWidthToPercent(lineWidth: number, baseSize: number): number {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
    return DEFAULT_LINE_WIDTH_PERCENT;
  }
  return (lineWidth / Math.max(1, baseSize)) * 100;
}

export function getPointsBounds(points: number[]): { minX: number; minY: number } {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
  };
}

export function updateAnnotationPosition(item: AnnotationItem, newX: number, newY: number): AnnotationItem {
  if (item.type === 'arrow' || item.type === 'pen') {
    const { minX, minY } = getPointsBounds(item.points);
    const dx = newX - minX;
    const dy = newY - minY;
    return {
      ...item,
      points: item.points.map((point, index) => (index % 2 === 0 ? point + dx : point + dy)),
    } as AnnotationItem;
  }

  if (item.type === 'rect' || item.type === 'ellipse' || item.type === 'text') {
    return { ...item, x: newX, y: newY };
  }

  return item;
}

export function updateAnnotationTransform(
  item: AnnotationItem,
  newX: number,
  newY: number,
  scaleX: number,
  scaleY: number
): AnnotationItem {
  if (item.type === 'rect' || item.type === 'ellipse') {
    return {
      ...item,
      x: newX,
      y: newY,
      width: Math.max(5, item.width * scaleX),
      height: Math.max(5, item.height * scaleY),
    };
  }

  if (item.type === 'text') {
    return {
      ...item,
      x: newX,
      y: newY,
      fontSize: Math.max(8, Math.round(item.fontSize * Math.max(scaleX, scaleY))),
    };
  }

  if (item.type === 'arrow' || item.type === 'pen') {
    const { minX, minY } = getPointsBounds(item.points);
    return {
      ...item,
      points: item.points.map((point, index) => {
        if (index % 2 === 0) {
          return newX + (point - minX) * scaleX;
        }
        return newY + (point - minY) * scaleY;
      }),
    } as AnnotationItem;
  }

  return item;
}

export function canSelectByTool(tool: AnnotationToolType, item: AnnotationItem): boolean {
  return tool === item.type;
}

export function canTransformAnnotation(item: AnnotationItem): boolean {
  return Boolean(item);
}

export function pruneUndefinedToolOptionsPatch(patch: Partial<ToolOptions>): Partial<ToolOptions> {
  const next: Partial<ToolOptions> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function buildDraftAnnotation(
  draft: DraftState | null,
  currentX: number,
  currentY: number,
  color: string,
  lineWidth: number
): AnnotationItem | null {
  if (!draft) {
    return null;
  }

  if (draft.tool === 'pen') {
    const points = [...(draft.points ?? [draft.startX, draft.startY]), currentX, currentY];
    return {
      id: 'draft-pen',
      type: 'pen',
      points,
      stroke: color,
      lineWidth,
    };
  }

  if (draft.tool === 'arrow') {
    return {
      id: 'draft-arrow',
      type: 'arrow',
      points: [draft.startX, draft.startY, currentX, currentY],
      stroke: color,
      lineWidth,
    };
  }

  const rect = normalizeAnnotationRect(draft.startX, draft.startY, currentX, currentY);
  if (draft.tool === 'rect') {
    return {
      id: 'draft-rect',
      type: 'rect',
      ...rect,
      stroke: color,
      lineWidth,
    };
  }

  return {
    id: 'draft-ellipse',
    type: 'ellipse',
    ...rect,
    stroke: color,
    lineWidth,
  };
}
