import { resolvePenTensionPoints } from '../domain/penGeometry';

export interface PenPathContext {
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => void;
  bezierCurveTo: (
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ) => void;
}

/**
 * 与 Konva.Line tension=0.5 相同的开放曲线路径。
 * 标注预览、标注导出与派生遮罩共用，避免屏幕轨迹和最终像素出现偏差。
 */
export function tracePenPath(context: PenPathContext, points: number[]): void {
  if (points.length < 2) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0], points[1]);
  const tensionPoints = resolvePenTensionPoints(points);
  if (points.length > 4 && tensionPoints.length >= 6) {
    context.quadraticCurveTo(
      tensionPoints[0],
      tensionPoints[1],
      tensionPoints[2],
      tensionPoints[3]
    );
    let index = 4;
    while (index < tensionPoints.length - 2) {
      context.bezierCurveTo(
        tensionPoints[index],
        tensionPoints[index + 1],
        tensionPoints[index + 2],
        tensionPoints[index + 3],
        tensionPoints[index + 4],
        tensionPoints[index + 5]
      );
      index += 6;
    }
    context.quadraticCurveTo(
      tensionPoints[tensionPoints.length - 2],
      tensionPoints[tensionPoints.length - 1],
      points[points.length - 2],
      points[points.length - 1]
    );
    return;
  }

  for (let index = 2; index < points.length; index += 2) {
    context.lineTo(points[index], points[index + 1]);
  }
}
