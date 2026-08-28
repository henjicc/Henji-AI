import type {
  MaskEditorDocument,
  MaskMark,
  MaskPoint,
  MaskShape,
  MaskShapeKind,
  MaskStroke,
} from './types';

export const MASK_HISTORY_LIMIT = 40;
export const MASK_POINT_MIN_DISTANCE = 0.75;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 持久化边界的窄解析器：无效或旧形状返回 null，由调用方按源图创建空文档。 */
export function parseMaskEditorDocument(value: unknown): MaskEditorDocument | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.sourceRef !== 'string') {
    return null;
  }
  const width = readFiniteNumber(value.width);
  const height = readFiniteNumber(value.height);
  if (!width || !height || width < 1 || height < 1 || !Array.isArray(value.strokes)) {
    return null;
  }

  const strokes: MaskMark[] = [];
  for (const rawStroke of value.strokes) {
    if (
      !isRecord(rawStroke)
      || typeof rawStroke.id !== 'string'
      || !Array.isArray(rawStroke.points)
    ) {
      return null;
    }
    const points: MaskPoint[] = [];
    for (const rawPoint of rawStroke.points) {
      if (!isRecord(rawPoint)) return null;
      const x = readFiniteNumber(rawPoint.x);
      const y = readFiniteNumber(rawPoint.y);
      if (x === null || y === null) return null;
      points.push({ x, y });
    }
    const kind = rawStroke.kind;
    if (kind === undefined || kind === 'stroke') {
      if (rawStroke.mode !== 'paint' && rawStroke.mode !== 'erase') return null;
      const size = readFiniteNumber(rawStroke.size);
      if (!size || size <= 0 || points.length === 0) return null;
      strokes.push({
        id: rawStroke.id,
        ...(kind === 'stroke' ? { kind } : {}),
        mode: rawStroke.mode,
        size,
        points,
      });
      continue;
    }
    if (!isMaskShapeKind(kind) || rawStroke.mode !== 'paint' || !isValidShapePoints(kind, points)) {
      return null;
    }
    strokes.push({ id: rawStroke.id, kind, mode: 'paint', points });
  }

  return {
    version: 1,
    sourceRef: value.sourceRef,
    width: Math.round(width),
    height: Math.round(height),
    strokes,
  };
}

function isMaskShapeKind(value: unknown): value is MaskShapeKind {
  return value === 'rectangle' || value === 'circle' || value === 'lasso';
}

function isValidShapePoints(kind: MaskShapeKind, points: MaskPoint[]): boolean {
  if (kind === 'lasso') return points.length >= 3;
  if (points.length !== 2) return false;
  const deltaX = Math.abs(points[1].x - points[0].x);
  const deltaY = Math.abs(points[1].y - points[0].y);
  return kind === 'circle' ? Math.max(deltaX, deltaY) > 0 : deltaX > 0 && deltaY > 0;
}

export function isMaskStroke(mark: MaskMark): mark is MaskStroke {
  return mark.kind === undefined || mark.kind === 'stroke';
}

export function isMaskShape(mark: MaskMark): mark is MaskShape {
  return !isMaskStroke(mark);
}

export interface MaskShapeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolveMaskShapeBounds(
  kind: 'rectangle' | 'circle',
  start: MaskPoint,
  end: MaskPoint
): MaskShapeBounds {
  if (kind === 'rectangle') {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }
  const diameter = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return {
    x: end.x >= start.x ? start.x : start.x - diameter,
    y: end.y >= start.y ? start.y : start.y - diameter,
    width: diameter,
    height: diameter,
  };
}

export function cloneMaskDocument(document: MaskEditorDocument): MaskEditorDocument {
  return {
    ...document,
    strokes: document.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

export function createEmptyMaskDocument(
  sourceRef: string,
  width: number,
  height: number
): MaskEditorDocument {
  return {
    version: 1,
    sourceRef,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    strokes: [],
  };
}

export interface ResolvedMaskDocument {
  document: MaskEditorDocument;
  reused: boolean;
  invalidationReason?: 'source-changed' | 'size-changed' | 'unsupported-version';
}

/** 源图或尺寸变化时必须失效，不能把旧坐标悄悄套在新图上。 */
export function resolveMaskDocument(
  initialDocument: MaskEditorDocument | null | undefined,
  sourceRef: string,
  width: number,
  height: number
): ResolvedMaskDocument {
  const empty = createEmptyMaskDocument(sourceRef, width, height);
  if (!initialDocument) {
    return { document: empty, reused: false };
  }
  if (initialDocument.version !== 1) {
    return { document: empty, reused: false, invalidationReason: 'unsupported-version' };
  }
  if (initialDocument.sourceRef !== sourceRef) {
    return { document: empty, reused: false, invalidationReason: 'source-changed' };
  }
  if (initialDocument.width !== empty.width || initialDocument.height !== empty.height) {
    return { document: empty, reused: false, invalidationReason: 'size-changed' };
  }
  return { document: cloneMaskDocument(initialDocument), reused: true };
}

export function clampMaskPoint(point: MaskPoint, width: number, height: number): MaskPoint {
  return {
    x: Math.min(Math.max(point.x, 0), Math.max(0, width)),
    y: Math.min(Math.max(point.y, 0), Math.max(0, height)),
  };
}

export function appendMaskPoint(
  points: MaskPoint[],
  point: MaskPoint,
  minimumDistance = MASK_POINT_MIN_DISTANCE
): MaskPoint[] {
  const previous = points[points.length - 1];
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minimumDistance) {
    return points;
  }
  return [...points, point];
}

export function hasPaintedMask(document: MaskEditorDocument): boolean {
  return document.strokes.some((stroke) => stroke.mode === 'paint' && stroke.points.length > 0);
}

export interface MaskHistoryState {
  document: MaskEditorDocument;
  undoStack: MaskEditorDocument[];
  redoStack: MaskEditorDocument[];
}

export type MaskHistoryAction =
  | { type: 'reset'; document: MaskEditorDocument }
  | { type: 'commit'; document: MaskEditorDocument }
  | { type: 'undo' }
  | { type: 'redo' };

export function createMaskHistoryState(document: MaskEditorDocument): MaskHistoryState {
  return { document: cloneMaskDocument(document), undoStack: [], redoStack: [] };
}

export function reduceMaskHistory(
  state: MaskHistoryState,
  action: MaskHistoryAction
): MaskHistoryState {
  if (action.type === 'reset') {
    return createMaskHistoryState(action.document);
  }
  if (action.type === 'commit') {
    return {
      document: cloneMaskDocument(action.document),
      undoStack: [...state.undoStack, cloneMaskDocument(state.document)].slice(-MASK_HISTORY_LIMIT),
      redoStack: [],
    };
  }
  if (action.type === 'undo') {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return state;
    return {
      document: cloneMaskDocument(previous),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, cloneMaskDocument(state.document)].slice(-MASK_HISTORY_LIMIT),
    };
  }
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) return state;
  return {
    document: cloneMaskDocument(next),
    undoStack: [...state.undoStack, cloneMaskDocument(state.document)].slice(-MASK_HISTORY_LIMIT),
    redoStack: state.redoStack.slice(0, -1),
  };
}

export function appendMaskStroke(
  document: MaskEditorDocument,
  stroke: MaskMark
): MaskEditorDocument {
  return {
    ...document,
    strokes: [
      ...document.strokes,
      { ...stroke, points: stroke.points.map((point) => ({ ...point })) },
    ],
  };
}

export interface MaskStageFit {
  width: number;
  height: number;
  scale: number;
}

export function fitMaskStage(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  padding = 24
): MaskStageFit {
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.max(0.0001, Math.min(availableWidth / imageWidth, availableHeight / imageHeight));
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
    scale,
  };
}
