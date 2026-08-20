export const PEN_TENSION = 0.5;

function resolveControlPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tension: number
): [number, number, number, number] | null {
  const distanceToPrevious = Math.hypot(x1 - x0, y1 - y0);
  const distanceToNext = Math.hypot(x2 - x1, y2 - y1);
  const totalDistance = distanceToPrevious + distanceToNext;
  if (totalDistance === 0) return null;

  const previousWeight = (tension * distanceToPrevious) / totalDistance;
  const nextWeight = (tension * distanceToNext) / totalDistance;
  return [
    x1 - previousWeight * (x2 - x0),
    y1 - previousWeight * (y2 - y0),
    x1 + nextWeight * (x2 - x0),
    y1 + nextWeight * (y2 - y0),
  ];
}

/** 与 Konva.Line tension 相同的开放曲线控制点，用于保证预览和导出一致。 */
export function resolvePenTensionPoints(
  points: number[],
  tension = PEN_TENSION
): number[] {
  const tensionPoints: number[] = [];
  for (let index = 2; index < points.length - 2; index += 2) {
    const controls = resolveControlPoints(
      points[index - 2],
      points[index - 1],
      points[index],
      points[index + 1],
      points[index + 2],
      points[index + 3],
      tension
    );
    if (!controls) continue;
    tensionPoints.push(
      controls[0],
      controls[1],
      points[index],
      points[index + 1],
      controls[2],
      controls[3]
    );
  }
  return tensionPoints;
}

/** Konva 会把张力控制点纳入节点边界，领域侧也使用同一组点保持移动和缩放稳定。 */
export function penBoundsPoints(points: number[]): number[] {
  if (points.length <= 4) return points;
  return [
    points[0],
    points[1],
    ...resolvePenTensionPoints(points),
    points[points.length - 2],
    points[points.length - 1],
  ];
}
