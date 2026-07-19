import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
} from '@/core/theme/colorTokens';
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

function isFiniteNumber(value: DynamicValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readLabelFields(raw: DynamicValueMap): { label?: string; labelFontSize?: number } {
  const result: { label?: string; labelFontSize?: number } = {};
  if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
    result.label = raw.label;
    if (isFiniteNumber(raw.labelFontSize)) {
      result.labelFontSize = Math.max(8, raw.labelFontSize);
    }
  }
  return result;
}

export function sanitizeMarkItem(item: DynamicValue): MarkItem | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const raw = item as DynamicValueMap;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const type = typeof raw.type === 'string' ? raw.type : null;
  if (!id || !type) {
    return null;
  }

  if (type === 'rect' || type === 'ellipse') {
    if (
      !isFiniteNumber(raw.x) ||
      !isFiniteNumber(raw.y) ||
      !isFiniteNumber(raw.width) ||
      !isFiniteNumber(raw.height)
    ) {
      return null;
    }

    return {
      id,
      type,
      x: raw.x,
      y: raw.y,
      width: Math.max(0, raw.width),
      height: Math.max(0, raw.height),
      stroke: typeof raw.stroke === 'string' ? raw.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(raw.lineWidth) ? Math.max(1, raw.lineWidth) : 3,
      ...readLabelFields(raw),
    };
  }

  if (type === 'arrow') {
    if (!Array.isArray(raw.points) || raw.points.length !== 4 || !raw.points.every(isFiniteNumber)) {
      return null;
    }

    return {
      id,
      type,
      points: [raw.points[0], raw.points[1], raw.points[2], raw.points[3]],
      stroke: typeof raw.stroke === 'string' ? raw.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(raw.lineWidth) ? Math.max(1, raw.lineWidth) : 3,
      ...readLabelFields(raw),
    };
  }

  if (type === 'pen') {
    if (!Array.isArray(raw.points) || raw.points.length < 4 || !raw.points.every(isFiniteNumber)) {
      return null;
    }

    return {
      id,
      type,
      points: raw.points,
      stroke: typeof raw.stroke === 'string' ? raw.stroke : ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: isFiniteNumber(raw.lineWidth) ? Math.max(1, raw.lineWidth) : 3,
    };
  }

  if (type === 'text') {
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || typeof raw.text !== 'string') {
      return null;
    }

    return {
      id,
      type,
      x: raw.x,
      y: raw.y,
      text: raw.text,
      color: typeof raw.color === 'string' ? raw.color : ANNOTATION_DEFAULT_TEXT_HEX,
      fontSize: isFiniteNumber(raw.fontSize) ? Math.max(10, raw.fontSize) : 28,
    };
  }

  if (type === 'number') {
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
      return null;
    }

    return {
      id,
      type,
      x: raw.x,
      y: raw.y,
      color: typeof raw.color === 'string' ? raw.color : ANNOTATION_DEFAULT_STROKE_HEX,
      fontSize: isFiniteNumber(raw.fontSize) ? Math.max(10, raw.fontSize) : 28,
    };
  }

  if (type === 'mosaic') {
    if (
      !isFiniteNumber(raw.x) ||
      !isFiniteNumber(raw.y) ||
      !isFiniteNumber(raw.width) ||
      !isFiniteNumber(raw.height)
    ) {
      return null;
    }

    return {
      id,
      type,
      x: raw.x,
      y: raw.y,
      width: Math.max(0, raw.width),
      height: Math.max(0, raw.height),
    };
  }

  return null;
}

export function parseMarkItems(value: DynamicValue): MarkItem[] {
  let source: DynamicValue = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item) => sanitizeMarkItem(item))
    .filter((item): item is MarkItem => item !== null);
}

export function stringifyMarkItems(items: MarkItem[]): string {
  return JSON.stringify(items);
}

const VALID_ROTATIONS: MarkRotation[] = [0, 90, 180, 270];

function sanitizeOrientation(value: DynamicValue): MarkOrientation {
  if (!value || typeof value !== 'object') {
    return createEmptyMarkOrientation();
  }
  const raw = value as DynamicValueMap;
  const rotate = isFiniteNumber(raw.rotate) && VALID_ROTATIONS.includes(raw.rotate as MarkRotation)
    ? (raw.rotate as MarkRotation)
    : 0;
  return { rotate, mirrored: raw.mirrored === true };
}

function sanitizeCrop(value: DynamicValue): MarkCropRect | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as DynamicValueMap;
  if (
    !isFiniteNumber(raw.x) ||
    !isFiniteNumber(raw.y) ||
    !isFiniteNumber(raw.width) ||
    !isFiniteNumber(raw.height) ||
    raw.width <= 0 ||
    raw.height <= 0
  ) {
    return null;
  }
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
}

/**
 * 解析标记文档;兼容两种旧输入:
 * - 纯标注数组(旧画布 annotate 工具的 options.annotations)
 * - JSON 字符串形式的上述任一格式
 */
export function parseMarkDoc(value: DynamicValue): ImageMarkDoc {
  let source: DynamicValue = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return createEmptyMarkDoc();
    }
  }

  if (Array.isArray(source)) {
    return { ...createEmptyMarkDoc(), items: parseMarkItems(source) };
  }

  if (!source || typeof source !== 'object') {
    return createEmptyMarkDoc();
  }

  const raw = source as DynamicValueMap;
  return {
    version: 1,
    items: parseMarkItems(raw.items),
    orientation: sanitizeOrientation(raw.orientation),
    crop: sanitizeCrop(raw.crop),
  };
}

export function stringifyMarkDoc(doc: ImageMarkDoc): string {
  return JSON.stringify(doc);
}
