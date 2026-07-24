import { createImageEditDocumentFromMarkDoc, imageEditDocumentToMarkDoc } from './document';
import { parseImageEditDocument } from './documentCodec';
import { parseMarkDoc, sanitizeMarkItem } from './markCodec';
import {
  createEmptyMarkDoc,
  type ImageEditSession,
  type ImageMarkDoc,
  type ImageMarkSession,
  type MarkItem,
  type MarkOrientation,
  type MarkRotation,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function offsetPoints(points: number[], dx: number, dy: number): number[] {
  return points.map((point, index) => (index % 2 === 0 ? point + dx : point + dy));
}

function convertLegacyAnnotation(value: unknown): MarkItem | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  const x = isFiniteNumber(value.x) ? value.x : 0;
  const y = isFiniteNumber(value.y) ? value.y : 0;
  const stroke = typeof value.stroke === 'string' ? value.stroke : undefined;
  const strokeWidth = isFiniteNumber(value.strokeWidth) ? value.strokeWidth : undefined;

  if (type === 'circle') {
    const radiusX = isFiniteNumber(value.radiusX) ? value.radiusX : 0;
    const radiusY = isFiniteNumber(value.radiusY) ? value.radiusY : 0;
    return sanitizeMarkItem({ ...value, type: 'ellipse', x: x - radiusX, y: y - radiusY, width: radiusX * 2, height: radiusY * 2, stroke, lineWidth: strokeWidth });
  }
  if (type === 'brush') {
    const points = Array.isArray(value.points) && value.points.every(isFiniteNumber) ? value.points : [];
    return sanitizeMarkItem({ ...value, type: 'pen', points: offsetPoints(points, x, y), stroke, lineWidth: strokeWidth });
  }
  if (type === 'arrow') {
    const points = Array.isArray(value.points) && value.points.every(isFiniteNumber) ? value.points : [];
    return sanitizeMarkItem({ ...value, type: 'arrow', points: offsetPoints(points.slice(0, 4), x, y), stroke, lineWidth: strokeWidth });
  }
  if (type === 'text') return sanitizeMarkItem({ ...value, type: 'text', color: typeof value.fill === 'string' ? value.fill : undefined });
  if (type === 'rect' || type === 'mosaic') return sanitizeMarkItem({ ...value, lineWidth: strokeWidth });
  return null;
}

function convertLegacyOrientation(raw: Record<string, unknown>): MarkOrientation {
  const rotation = isFiniteNumber(raw.rotation) ? ((raw.rotation % 360) + 360) % 360 : 0;
  const flipH = raw.flipH === true;
  const flipV = raw.flipV === true;
  const extra = flipV ? 180 : 0;
  const mirrored = flipH !== flipV;
  const rotate = ((rotation + extra) % 360) as MarkRotation;
  return { rotate: [0, 90, 180, 270].includes(rotate) ? rotate : 0, mirrored };
}

function isLegacyEditState(raw: Record<string, unknown>): boolean {
  return isRecord(raw.canvas) && Array.isArray(raw.canvas.annotations);
}

function convertLegacyEditState(raw: Record<string, unknown>): ImageMarkDoc {
  const canvas = raw.canvas as Record<string, unknown>;
  const annotations = Array.isArray(canvas.annotations) ? canvas.annotations : [];
  const items = annotations.map(convertLegacyAnnotation).filter((item): item is MarkItem => item !== null);
  const cropRaw = canvas.cropRect;
  let crop: ImageMarkDoc['crop'] = null;
  if (isRecord(cropRaw) && isFiniteNumber(cropRaw.x) && isFiniteNumber(cropRaw.y) && isFiniteNumber(cropRaw.width) && isFiniteNumber(cropRaw.height) && cropRaw.width > 0 && cropRaw.height > 0) {
    crop = { x: cropRaw.x, y: cropRaw.y, width: cropRaw.width, height: cropRaw.height };
  }
  return { version: 1, items, orientation: convertLegacyOrientation(canvas), crop };
}

export function coerceImageEditSession(value: unknown, fallbackSourceUrl: string): ImageEditSession {
  if (!isRecord(value)) {
    return { sourceUrl: fallbackSourceUrl, document: createImageEditDocumentFromMarkDoc(createEmptyMarkDoc()) };
  }
  if (isLegacyEditState(value)) {
    const sourceUrl = typeof value.originalSrc === 'string' && value.originalSrc ? value.originalSrc : fallbackSourceUrl;
    return { sourceUrl, document: createImageEditDocumentFromMarkDoc(convertLegacyEditState(value)) };
  }
  const sourceUrl = typeof value.sourceUrl === 'string' && value.sourceUrl ? value.sourceUrl : fallbackSourceUrl;
  if (value.document !== undefined) return { sourceUrl, document: parseImageEditDocument(value.document) };
  if (value.doc !== undefined) return { sourceUrl, document: parseImageEditDocument(value.doc) };
  return { sourceUrl, document: parseImageEditDocument(value) };
}

export function toImageMarkSession(session: ImageEditSession): ImageMarkSession {
  return { sourceUrl: session.sourceUrl, doc: imageEditDocumentToMarkDoc(session.document) };
}

export function coerceMarkSession(value: unknown, fallbackSourceUrl: string): ImageMarkSession {
  return toImageMarkSession(coerceImageEditSession(value, fallbackSourceUrl));
}
