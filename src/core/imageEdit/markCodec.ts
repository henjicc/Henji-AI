import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
} from '../theme/colorTokens';
import {
  createEmptyMarkDoc,
  createEmptyMarkOrientation,
  type ImageMarkDoc,
  type MarkCropRect,
  type MarkItem,
  type MarkOrientation,
  type MarkRotation,
} from './types';

export function createMarkId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readLabelFields(raw: Record<string, unknown>): {
  label?: string;
  labelFontSize?: number;
  labelDx?: number;
  labelDy?: number;
  labelBackgroundColor?: string;
} {
  const result: {
    label?: string;
    labelFontSize?: number;
    labelDx?: number;
    labelDy?: number;
    labelBackgroundColor?: string;
  } = {};
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
    result.label = raw.label;
    if (isFiniteNumber(raw.labelFontSize)) result.labelFontSize = Math.max(8, raw.labelFontSize);
    if (isFiniteNumber(raw.labelDx) && isFiniteNumber(raw.labelDy)) {
      result.labelDx = raw.labelDx;
      result.labelDy = raw.labelDy;
    }
    if (typeof raw.labelBackgroundColor === 'string' && raw.labelBackgroundColor.length > 0) {
      result.labelBackgroundColor = raw.labelBackgroundColor;
    }
  }
  return result;
}

export function sanitizeMarkItem(item: unknown): MarkItem | null {
  if (!isRecord(item)) return null;
  const id = typeof item.id === 'string' ? item.id : null;
  const type = typeof item.type === 'string' ? item.type : null;
  if (!id || !type) return null;

  if (type === 'rect' || type === 'ellipse') {
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y) || !isFiniteNumber(item.width) || !isFiniteNumber(item.height)) return null;
    return {
      id,
      type,
      x: item.x,
      y: item.y,
      width: Math.max(0, item.width),
      height: Math.max(0, item.height),
      stroke: typeof item.stroke === 'string' ? item.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(item.lineWidth) ? Math.max(1, item.lineWidth) : 3,
      ...readLabelFields(item),
    };
  }

  if (type === 'arrow') {
    if (!Array.isArray(item.points) || item.points.length !== 4 || !item.points.every(isFiniteNumber)) return null;
    const curveControl = Array.isArray(item.curveControl)
      && item.curveControl.length === 2
      && item.curveControl.every(isFiniteNumber)
      ? [item.curveControl[0], item.curveControl[1]] as [number, number]
      : undefined;
    return {
      id,
      type,
      points: [item.points[0], item.points[1], item.points[2], item.points[3]],
      ...(curveControl ? { curveControl } : {}),
      stroke: typeof item.stroke === 'string' ? item.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(item.lineWidth) ? Math.max(1, item.lineWidth) : 3,
      ...readLabelFields(item),
    };
  }

  if (type === 'pen') {
    if (!Array.isArray(item.points) || item.points.length < 4 || !item.points.every(isFiniteNumber)) return null;
    return {
      id,
      type,
      points: item.points,
      stroke: typeof item.stroke === 'string' ? item.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(item.lineWidth) ? Math.max(1, item.lineWidth) : 3,
    };
  }

  if (type === 'text') {
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y) || typeof item.text !== 'string') return null;
    return {
      id,
      type,
      x: item.x,
      y: item.y,
      text: item.text,
      color: typeof item.color === 'string' ? item.color : ANNOTATION_DEFAULT_TEXT_HEX,
      fontSize: isFiniteNumber(item.fontSize) ? Math.max(10, item.fontSize) : 28,
      ...(typeof item.backgroundColor === 'string' && item.backgroundColor.length > 0
        ? { backgroundColor: item.backgroundColor }
        : {}),
    };
  }

  if (type === 'number') {
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return null;
    return {
      id,
      type,
      x: item.x,
      y: item.y,
      color: typeof item.color === 'string' ? item.color : ANNOTATION_DEFAULT_STROKE_HEX,
      fontSize: isFiniteNumber(item.fontSize) ? Math.max(10, item.fontSize) : 28,
    };
  }

  if (type === 'mosaic') {
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y) || !isFiniteNumber(item.width) || !isFiniteNumber(item.height)) return null;
    return {
      id,
      type,
      x: item.x,
      y: item.y,
      width: Math.max(0, item.width),
      height: Math.max(0, item.height),
      ...(isFiniteNumber(item.strengthPercent)
        ? { strengthPercent: Math.max(0.1, item.strengthPercent) }
        : {}),
      ...(item.mode === 'blur' ? { mode: 'blur' as const } : {}),
    };
  }

  return null;
}

export function parseMarkItems(value: unknown): MarkItem[] {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source.map(sanitizeMarkItem).filter((item): item is MarkItem => item !== null);
}

export function stringifyMarkItems(items: MarkItem[]): string {
  return JSON.stringify(items);
}

const VALID_ROTATIONS: MarkRotation[] = [0, 90, 180, 270];

export function sanitizeMarkOrientation(value: unknown): MarkOrientation {
  if (!isRecord(value)) return createEmptyMarkOrientation();
  const rotate = isFiniteNumber(value.rotate) && VALID_ROTATIONS.includes(value.rotate as MarkRotation)
    ? (value.rotate as MarkRotation)
    : 0;
  return { rotate, mirrored: value.mirrored === true };
}

export function sanitizeMarkCrop(value: unknown): MarkCropRect | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height) || value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function parseMarkDoc(value: unknown): ImageMarkDoc {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      return createEmptyMarkDoc();
    }
  }
  if (Array.isArray(source)) return { ...createEmptyMarkDoc(), items: parseMarkItems(source) };
  if (!isRecord(source)) return createEmptyMarkDoc();
  return {
    version: 1,
    items: parseMarkItems(source.items),
    orientation: sanitizeMarkOrientation(source.orientation),
    crop: sanitizeMarkCrop(source.crop),
  };
}

export function stringifyMarkDoc(doc: ImageMarkDoc): string {
  return JSON.stringify(doc);
}
