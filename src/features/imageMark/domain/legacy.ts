import { parseMarkDoc, sanitizeMarkItem } from './codec';
import {
  createEmptyMarkDoc,
  type ImageMarkDoc,
  type ImageMarkSession,
  type MarkItem,
  type MarkOrientation,
  type MarkRotation,
} from './types';

/**
 * 旧版编辑状态兼容层:把已退役的 components/ImageEditor 的 ImageEditState
 * (对话模式任务回放文件中可能仍存有)转换为统一 ImageMarkDoc。
 * 转换是尽力而为:忽略旧标注上罕见的 rotation/scale 变换。
 */

function isFiniteNumber(value: DynamicValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function offsetPoints(points: number[], dx: number, dy: number): number[] {
  return points.map((point, index) => (index % 2 === 0 ? point + dx : point + dy));
}

function convertLegacyAnnotation(value: DynamicValue): MarkItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as DynamicValueMap;
  const type = typeof raw.type === 'string' ? raw.type : '';
  const x = isFiniteNumber(raw.x) ? raw.x : 0;
  const y = isFiniteNumber(raw.y) ? raw.y : 0;
  const stroke = typeof raw.stroke === 'string' ? raw.stroke : undefined;
  const strokeWidth = isFiniteNumber(raw.strokeWidth) ? raw.strokeWidth : undefined;

  if (type === 'circle') {
    // 旧 circle 的 x/y 为圆心,radiusX/radiusY 为半径
    const radiusX = isFiniteNumber(raw.radiusX) ? raw.radiusX : 0;
    const radiusY = isFiniteNumber(raw.radiusY) ? raw.radiusY : 0;
    return sanitizeMarkItem({
      ...raw,
      type: 'ellipse',
      x: x - radiusX,
      y: y - radiusY,
      width: radiusX * 2,
      height: radiusY * 2,
      stroke,
      lineWidth: strokeWidth,
    });
  }

  if (type === 'brush') {
    const points = Array.isArray(raw.points) && raw.points.every(isFiniteNumber) ? raw.points : [];
    return sanitizeMarkItem({
      ...raw,
      type: 'pen',
      points: offsetPoints(points, x, y),
      stroke,
      lineWidth: strokeWidth,
    });
  }

  if (type === 'arrow') {
    const points = Array.isArray(raw.points) && raw.points.every(isFiniteNumber) ? raw.points : [];
    return sanitizeMarkItem({
      ...raw,
      type: 'arrow',
      points: offsetPoints(points.slice(0, 4), x, y),
      stroke,
      lineWidth: strokeWidth,
    });
  }

  if (type === 'text') {
    return sanitizeMarkItem({
      ...raw,
      type: 'text',
      color: typeof raw.fill === 'string' ? raw.fill : undefined,
    });
  }

  if (type === 'rect' || type === 'mosaic') {
    return sanitizeMarkItem({
      ...raw,
      lineWidth: strokeWidth,
    });
  }

  return null;
}

function convertLegacyOrientation(raw: DynamicValueMap): MarkOrientation {
  const rotation = isFiniteNumber(raw.rotation) ? ((raw.rotation % 360) + 360) % 360 : 0;
  const flipH = raw.flipH === true;
  const flipV = raw.flipV === true;
  // Fh^fh · Fv^fv 归一化: (1,1)=R(180); (0,1)=R(180)·Fh
  const extra = flipV ? 180 : 0;
  const mirrored = flipH !== flipV;
  const rotate = ((rotation + extra) % 360) as MarkRotation;
  return { rotate: [0, 90, 180, 270].includes(rotate) ? rotate : 0, mirrored };
}

function isLegacyEditState(raw: DynamicValueMap): boolean {
  const canvas = raw.canvas;
  return Boolean(
    canvas &&
    typeof canvas === 'object' &&
    Array.isArray((canvas as DynamicValueMap).annotations)
  );
}

function convertLegacyEditState(raw: DynamicValueMap): ImageMarkDoc {
  const canvas = raw.canvas as DynamicValueMap;
  const annotations = Array.isArray(canvas.annotations) ? canvas.annotations : [];
  const items = annotations
    .map((item) => convertLegacyAnnotation(item))
    .filter((item): item is MarkItem => item !== null);

  const cropRaw = canvas.cropRect;
  let crop: ImageMarkDoc['crop'] = null;
  if (cropRaw && typeof cropRaw === 'object') {
    const rect = cropRaw as DynamicValueMap;
    if (
      isFiniteNumber(rect.x) &&
      isFiniteNumber(rect.y) &&
      isFiniteNumber(rect.width) &&
      isFiniteNumber(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
    ) {
      crop = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
  }

  return {
    version: 1,
    items,
    orientation: convertLegacyOrientation(canvas),
    crop,
  };
}

/**
 * 把任意历史格式(新 session / 新 doc / 旧 ImageEditState)统一为编辑会话。
 * 解析失败时返回空文档。
 */
export function coerceMarkSession(value: DynamicValue, fallbackSourceUrl: string): ImageMarkSession {
  if (!value || typeof value !== 'object') {
    return { sourceUrl: fallbackSourceUrl, doc: createEmptyMarkDoc() };
  }

  const raw = value as DynamicValueMap;

  if (isLegacyEditState(raw)) {
    const sourceUrl = typeof raw.originalSrc === 'string' && raw.originalSrc
      ? raw.originalSrc
      : fallbackSourceUrl;
    return { sourceUrl, doc: convertLegacyEditState(raw) };
  }

  if (raw.doc && typeof raw.doc === 'object') {
    const sourceUrl = typeof raw.sourceUrl === 'string' && raw.sourceUrl
      ? raw.sourceUrl
      : fallbackSourceUrl;
    return { sourceUrl, doc: parseMarkDoc(raw.doc) };
  }

  return { sourceUrl: fallbackSourceUrl, doc: parseMarkDoc(value) };
}
