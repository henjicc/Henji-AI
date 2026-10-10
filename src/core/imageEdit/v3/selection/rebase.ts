import type { RegionGrid } from '../../../imaging/regions';
import { composeAffine, type Affine } from '../../../imaging/transforms';
import type { ImageEditSelectionSessionV3 } from './session';

/** 保持命名区域的像素位置与羽化，不把画布扩展误当成图像缩放。 */
export function rebaseImageEditSelectionGridV3(selection: ImageEditSelectionSessionV3, original: RegionGrid, output: RegionGrid, transform: Affine = [1, 0, 0, 1, 0, 0]): ImageEditSelectionSessionV3 {
  const sx = original.width / output.width * transform[0], sy = original.height / output.height * transform[3];
  const tx = transform[4] / output.width, ty = transform[5] / output.height;
  const radius = Math.min(original.width, original.height) * Math.min(Math.abs(transform[0]), Math.abs(transform[3])) / Math.min(output.width, output.height);
  const point = (p: { x: number; y: number }) => ({ ...p, x: p.x * sx + tx, y: p.y * sy + ty });
  return { ...selection, feather: selection.feather * radius, operations: selection.operations.map(operation => {
    const shape = operation.shape;
    const mapped = shape.type === 'mask' ? { ...shape, matrix: [...composeAffine([sx, 0, 0, sy, tx, ty], shape.matrix)] as typeof shape.matrix }
      : shape.type === 'lasso' ? { ...shape, points: shape.points.map(point) }
      : shape.type === 'brush' ? { ...shape, points: shape.points.map(point), radius: shape.radius * radius }
      : { ...shape, ...point(shape), width: shape.width * sx, height: shape.height * sy };
    return { ...operation, shape: mapped };
  }) };
}
