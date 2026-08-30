import type { BufferedImageEditBrushPointV3 } from './contracts';

function projection(
  point: BufferedImageEditBrushPointV3,
  start: BufferedImageEditBrushPointV3,
  end: BufferedImageEditBrushPointV3,
): number {
  const dx = end.screenX - start.screenX;
  const dy = end.screenY - start.screenY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  return Math.max(0, Math.min(1, (
    (point.screenX - start.screenX) * dx
    + (point.screenY - start.screenY) * dy
  ) / lengthSquared));
}

function simplificationScore(
  point: BufferedImageEditBrushPointV3,
  start: BufferedImageEditBrushPointV3,
  end: BufferedImageEditBrushPointV3,
  screenTolerance: number,
  pressureTolerance: number,
): number {
  const amount = projection(point, start, end);
  const expectedX = start.screenX + (end.screenX - start.screenX) * amount;
  const expectedY = start.screenY + (end.screenY - start.screenY) * amount;
  const dx = point.screenX - expectedX;
  const dy = point.screenY - expectedY;
  const spatial = screenTolerance === 0
    ? (dx === 0 && dy === 0 ? 0 : Number.POSITIVE_INFINITY)
    : (dx * dx + dy * dy) / (screenTolerance * screenTolerance);
  const expectedPressure = start.pressure + (end.pressure - start.pressure) * amount;
  const pressureError = Math.abs(point.pressure - expectedPressure);
  const pressure = pressureTolerance === 0
    ? (pressureError === 0 ? 0 : Number.POSITIVE_INFINITY)
    : (pressureError / pressureTolerance) ** 2;
  return Math.max(spatial, pressure);
}

/** 迭代式 Douglas-Peucker；保留明显压力变化，且不在递归中复制子数组。 */
export function simplifyImageEditBrushPointsV3(
  points: readonly BufferedImageEditBrushPointV3[],
  screenTolerance = 0.35,
  pressureTolerance = 0.02,
): BufferedImageEditBrushPointV3[] {
  if (!Number.isFinite(screenTolerance) || screenTolerance < 0) {
    throw new Error('画笔路径简化容差不能为负数');
  }
  if (!Number.isFinite(pressureTolerance) || pressureTolerance < 0 || pressureTolerance > 1) {
    throw new Error('画笔压力简化容差必须位于 0～1');
  }
  if (points.length <= 2) return points.map((point) => ({ ...point }));

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: number[] = [0, points.length - 1];
  while (stack.length > 0) {
    const endIndex = stack.pop();
    const startIndex = stack.pop();
    if (startIndex === undefined || endIndex === undefined || endIndex - startIndex <= 1) continue;
    let furthestIndex = -1;
    let furthestScore = 1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const score = simplificationScore(
        points[index],
        points[startIndex],
        points[endIndex],
        screenTolerance,
        pressureTolerance,
      );
      if (score > furthestScore) {
        furthestScore = score;
        furthestIndex = index;
      }
    }
    if (furthestIndex < 0) continue;
    keep[furthestIndex] = 1;
    stack.push(startIndex, furthestIndex, furthestIndex, endIndex);
  }

  const simplified: BufferedImageEditBrushPointV3[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) simplified.push({ ...points[index] });
  }
  return simplified;
}
