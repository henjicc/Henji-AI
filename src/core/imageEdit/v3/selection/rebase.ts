import type { RegionGrid } from '../../../imaging/regions';
import type { ImageEditSelectionSessionV3 } from './session';

/** 保持命名区域的像素位置与羽化，不把画布扩展误当成图像缩放。 */
export function rebaseImageEditSelectionGridV3(selection: ImageEditSelectionSessionV3, original: RegionGrid, output: RegionGrid): ImageEditSelectionSessionV3 {
  const sx = original.width / output.width, sy = original.height / output.height;
  const radius = Math.min(original.width, original.height) / Math.min(output.width, output.height);
  const point = (p: { x: number; y: number }) => ({ ...p, x: p.x * sx, y: p.y * sy });
  return { ...selection, feather: selection.feather * radius, operations: selection.operations.map(operation => {
    const shape = operation.shape;
    const mapped = shape.type === 'mask' ? { ...shape, matrix: [shape.matrix[0] * sx, shape.matrix[1] * sy, shape.matrix[2] * sx, shape.matrix[3] * sy, shape.matrix[4] * sx, shape.matrix[5] * sy] as typeof shape.matrix }
      : shape.type === 'lasso' ? { ...shape, points: shape.points.map(point) }
      : shape.type === 'brush' ? { ...shape, points: shape.points.map(point), radius: shape.radius * radius }
      : { ...shape, x: shape.x * sx, y: shape.y * sy, width: shape.width * sx, height: shape.height * sy };
    return { ...operation, shape: mapped };
  }) };
}
