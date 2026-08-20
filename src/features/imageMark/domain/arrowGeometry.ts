import type { ArrowMark } from './types';

export interface ArrowVisualBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolveArrowControl(item: ArrowMark): [number, number] {
  if (item.curveControl) return item.curveControl;
  const [x1, y1, x2, y2] = item.points;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/**
 * 交互手柄必须落在曲线上，而不是暴露二次贝塞尔的数学控制点。
 * 固定取 t=0.5，直箭头时正好是线段中点。
 */
export function resolveArrowCurveHandle(item: ArrowMark): [number, number] {
  const [x1, y1, x2, y2] = item.points;
  const [cx, cy] = resolveArrowControl(item);
  return [
    0.25 * x1 + 0.5 * cx + 0.25 * x2,
    0.25 * y1 + 0.5 * cy + 0.25 * y2,
  ];
}

/** 根据用户拖动的曲线上中点，反解内部二次贝塞尔控制点。 */
export function arrowCurveHandleToControl(
  item: ArrowMark,
  handle: [number, number]
): [number, number] {
  const [x1, y1, x2, y2] = item.points;
  return [
    2 * handle[0] - 0.5 * (x1 + x2),
    2 * handle[1] - 0.5 * (y1 + y2),
  ];
}

/** Konva 的 bezier Line 使用三次曲线；把文档里的单控制点二次曲线等价转换为两个控制点。 */
export function arrowToKonvaBezierPoints(
  item: ArrowMark,
  control: [number, number] = resolveArrowControl(item)
): number[] {
  const [x1, y1, x2, y2] = item.points;
  const [cx, cy] = control;
  return [
    x1,
    y1,
    x1 + (2 / 3) * (cx - x1),
    y1 + (2 / 3) * (cy - y1),
    x2 + (2 / 3) * (cx - x2),
    y2 + (2 / 3) * (cy - y2),
    x2,
    y2,
  ];
}

export function arrowBoundsPoints(item: ArrowMark): number[] {
  return item.curveControl ? [...item.points, ...item.curveControl] : item.points;
}

export function resolveArrowHeadSize(lineWidth: number): { length: number; width: number } {
  return {
    length: Math.max(10, lineWidth * 4),
    width: Math.max(10, lineWidth * 3),
  };
}

export function resolveArrowHeadPoints(item: ArrowMark): number[] {
  const [startX, startY, endX, endY] = item.points;
  const [tangentX, tangentY] = item.curveControl ?? [startX, startY];
  let directionX = endX - tangentX;
  let directionY = endY - tangentY;
  let directionLength = Math.hypot(directionX, directionY);
  if (directionLength < 0.001) {
    directionX = endX - startX;
    directionY = endY - startY;
    directionLength = Math.hypot(directionX, directionY);
  }
  if (directionLength < 0.001) {
    directionX = 1;
    directionY = 0;
    directionLength = 1;
  }

  const unitX = directionX / directionLength;
  const unitY = directionY / directionLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const head = resolveArrowHeadSize(item.lineWidth);
  const baseX = endX - unitX * head.length;
  const baseY = endY - unitY * head.length;
  const halfWidth = head.width / 2;
  return [
    endX,
    endY,
    baseX + perpendicularX * halfWidth,
    baseY + perpendicularY * halfWidth,
    baseX - perpendicularX * halfWidth,
    baseY - perpendicularY * halfWidth,
  ];
}

function quadraticPoint(
  start: number,
  control: number,
  end: number,
  t: number
): number {
  const remainder = 1 - t;
  return remainder * remainder * start + 2 * remainder * t * control + t * t * end;
}

function addQuadraticExtremum(
  points: number[],
  startX: number,
  startY: number,
  controlX: number,
  controlY: number,
  endX: number,
  endY: number,
  axis: 'x' | 'y'
): void {
  const start = axis === 'x' ? startX : startY;
  const control = axis === 'x' ? controlX : controlY;
  const end = axis === 'x' ? endX : endY;
  const denominator = start - 2 * control + end;
  if (Math.abs(denominator) < 0.000001) return;
  const t = (start - control) / denominator;
  if (t <= 0 || t >= 1) return;
  points.push(
    quadraticPoint(startX, controlX, endX, t),
    quadraticPoint(startY, controlY, endY, t)
  );
}

/** 箭身曲线、固定尺寸箭头头部和线宽共同构成稳定的交互边界。 */
export function resolveArrowVisualBounds(item: ArrowMark): ArrowVisualBounds {
  const [startX, startY, endX, endY] = item.points;
  const visualPoints = [startX, startY, endX, endY, ...resolveArrowHeadPoints(item)];
  if (item.curveControl) {
    const [controlX, controlY] = item.curveControl;
    addQuadraticExtremum(
      visualPoints,
      startX,
      startY,
      controlX,
      controlY,
      endX,
      endY,
      'x'
    );
    addQuadraticExtremum(
      visualPoints,
      startX,
      startY,
      controlX,
      controlY,
      endX,
      endY,
      'y'
    );
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < visualPoints.length; index += 2) {
    minX = Math.min(minX, visualPoints[index]);
    minY = Math.min(minY, visualPoints[index + 1]);
    maxX = Math.max(maxX, visualPoints[index]);
    maxY = Math.max(maxY, visualPoints[index + 1]);
  }
  const padding = Math.max(0.5, item.lineWidth / 2);
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

/** 直箭头的零长度轴只用于命中，不参与缩放，避免把箭头头部厚度误当成可拉伸内容。 */
export function stabilizeStraightArrowBounds<T extends ArrowVisualBounds>(
  item: ArrowMark,
  oldBounds: T,
  nextBounds: T
): T {
  if (item.curveControl) return nextBounds;
  const [startX, startY, endX, endY] = item.points;
  const stabilized = { ...nextBounds };
  if (Math.abs(endX - startX) < 0.001) {
    stabilized.x = oldBounds.x;
    stabilized.width = oldBounds.width;
  }
  if (Math.abs(endY - startY) < 0.001) {
    stabilized.y = oldBounds.y;
    stabilized.height = oldBounds.height;
  }
  return stabilized;
}
