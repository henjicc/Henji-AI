import type {
  ImageMarkDoc,
  MarkCropRect,
  MarkItem,
  MarkOrientation,
  MarkRotation,
} from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMarkRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function getPointsBounds(points: number[]): { minX: number; minY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 2) {
    minX = Math.min(minX, points[index]);
    minY = Math.min(minY, points[index + 1]);
  }
  return { minX, minY };
}

export function updateMarkPosition(item: MarkItem, newX: number, newY: number): MarkItem {
  if (item.type === 'arrow' || item.type === 'pen') {
    const { minX, minY } = getPointsBounds(item.points);
    const dx = newX - minX;
    const dy = newY - minY;
    return {
      ...item,
      points: item.points.map((point, index) => (index % 2 === 0 ? point + dx : point + dy)),
    } as MarkItem;
  }

  return { ...item, x: newX, y: newY };
}

export function updateMarkTransform(
  item: MarkItem,
  newX: number,
  newY: number,
  scaleX: number,
  scaleY: number
): MarkItem {
  if (item.type === 'rect' || item.type === 'ellipse' || item.type === 'mosaic') {
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

  if (item.type === 'number') {
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
    } as MarkItem;
  }

  return item;
}

// ==================== 朝向操作(旋转/翻转) ====================

export type OrientationOp = 'rotate-cw' | 'rotate-ccw' | 'flip-h' | 'flip-v';

const ROTATIONS: MarkRotation[] = [0, 90, 180, 270];

function normalizeRotation(value: number): MarkRotation {
  const normalized = ((value % 360) + 360) % 360;
  return ROTATIONS.includes(normalized as MarkRotation) ? (normalized as MarkRotation) : 0;
}

/**
 * 朝向合成:整体变换 = R(rotate) ∘ MirrorH^mirrored。
 * 在现有朝向上叠加一个新操作,归一化回 {rotate, mirrored}。
 */
export function composeOrientation(orientation: MarkOrientation, op: OrientationOp): MarkOrientation {
  const { rotate, mirrored } = orientation;
  switch (op) {
    case 'rotate-cw':
      return { rotate: normalizeRotation(rotate + 90), mirrored };
    case 'rotate-ccw':
      return { rotate: normalizeRotation(rotate - 90), mirrored };
    case 'flip-h':
      // Fh ∘ R(r) = R(-r) ∘ Fh
      return { rotate: normalizeRotation(-rotate), mirrored: !mirrored };
    case 'flip-v':
      // Fv = R(180) ∘ Fh
      return { rotate: normalizeRotation(180 - rotate), mirrored: !mirrored };
  }
}

export function orientedSizeAfterOp(
  width: number,
  height: number,
  op: OrientationOp
): { width: number; height: number } {
  if (op === 'rotate-cw' || op === 'rotate-ccw') {
    return { width: height, height: width };
  }
  return { width, height };
}

export function orientedSize(
  width: number,
  height: number,
  orientation: MarkOrientation
): { width: number; height: number } {
  if (orientation.rotate === 90 || orientation.rotate === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function remapPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  op: OrientationOp
): { x: number; y: number } {
  switch (op) {
    case 'rotate-cw':
      return { x: height - y, y: x };
    case 'rotate-ccw':
      return { x: y, y: width - x };
    case 'flip-h':
      return { x: width - x, y };
    case 'flip-v':
      return { x, y: height - y };
  }
}

function remapRect(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  op: OrientationOp
): { x: number; y: number; width: number; height: number } {
  const a = remapPoint(rect.x, rect.y, width, height, op);
  const b = remapPoint(rect.x + rect.width, rect.y + rect.height, width, height, op);
  return normalizeMarkRect(a.x, a.y, b.x, b.y);
}

function remapPoints(points: number[], width: number, height: number, op: OrientationOp): number[] {
  const next: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const mapped = remapPoint(points[index], points[index + 1], width, height, op);
    next.push(mapped.x, mapped.y);
  }
  return next;
}

function remapMarkItem(item: MarkItem, width: number, height: number, op: OrientationOp): MarkItem {
  if (item.type === 'rect' || item.type === 'ellipse' || item.type === 'mosaic') {
    return { ...item, ...remapRect(item, width, height, op) };
  }
  if (item.type === 'arrow') {
    const points = remapPoints(item.points, width, height, op);
    return { ...item, points: [points[0], points[1], points[2], points[3]] };
  }
  if (item.type === 'pen') {
    return { ...item, points: remapPoints(item.points, width, height, op) };
  }
  // text 锚点为左上角、number 为圆心:直接映射锚点,尽量保持在原内容附近
  const mapped = remapPoint(item.x, item.y, width, height, op);
  return { ...item, x: mapped.x, y: mapped.y };
}

/**
 * 对整个文档应用一次朝向操作:
 * 合成朝向,并把所有标记与裁剪区域重映射到新坐标系。
 * width/height 为当前朝向下的图片尺寸。
 */
export function applyOrientationOpToDoc(
  doc: ImageMarkDoc,
  width: number,
  height: number,
  op: OrientationOp
): ImageMarkDoc {
  return {
    ...doc,
    orientation: composeOrientation(doc.orientation, op),
    items: doc.items.map((item) => remapMarkItem(item, width, height, op)),
    crop: doc.crop ? remapRect(doc.crop, width, height, op) : null,
  };
}

export function clampCropRect(
  crop: MarkCropRect,
  width: number,
  height: number,
  minSize = 8
): MarkCropRect {
  const w = clamp(crop.width, minSize, width);
  const h = clamp(crop.height, minSize, height);
  return {
    x: clamp(crop.x, 0, Math.max(0, width - w)),
    y: clamp(crop.y, 0, Math.max(0, height - h)),
    width: w,
    height: h,
  };
}
