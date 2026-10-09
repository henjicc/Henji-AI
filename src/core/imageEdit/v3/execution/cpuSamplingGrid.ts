import type { ImageEditMaskReferenceV3, ImageEditTransformV3 } from '../layerTypes'
import type { ImageEditRenderPlanNode } from '../renderPlan'
import type { ImageEditRect, ImageEditSize } from '../tileGeometry'
import {
  isImageEditTransformInvertibleV3,
  multiplyImageEditTransformsV3,
  resolveImageEditInverseSourceRectV3,
} from './affineTransform'

export interface ImageEditCpuSamplingGridV3 {
  /** 当前载入器返回像素的实际网格边界，不是文档或输出瓦片尺寸。 */
  size: ImageEditSize
  /** 采样网格到图层变换前求值坐标的映射。输出 mip 与源 mip 相同为恒等矩阵。 */
  toEvaluation: ImageEditTransformV3
}

export type ImageEditCpuSamplingTargetV3 =
  | { kind: 'content'; node: ImageEditRenderPlanNode }
  | { kind: 'mask'; ownerNode: ImageEditRenderPlanNode; reference: ImageEditMaskReferenceV3 }

export interface ImageEditCpuSamplingContextV3 {
  size: ImageEditSize
  resolveSamplingGrid?(target: ImageEditCpuSamplingTargetV3): ImageEditCpuSamplingGridV3 | undefined
}

export function resolveImageEditCpuSamplingGridV3(
  context: ImageEditCpuSamplingContextV3,
  target: ImageEditCpuSamplingTargetV3,
): ImageEditCpuSamplingGridV3 {
  const grid: ImageEditCpuSamplingGridV3 = context.resolveSamplingGrid?.(target)
    ?? { size: context.size, toEvaluation: [1, 0, 0, 1, 0, 0] }
  if (!Number.isSafeInteger(grid.size.width) || grid.size.width < 1
    || !Number.isSafeInteger(grid.size.height) || grid.size.height < 1
    || !isImageEditTransformInvertibleV3(grid.toEvaluation)) {
    throw new Error('图片采样网格必须具有有效尺寸与可逆坐标映射')
  }
  return grid
}

/** 内容与蒙版分别逆算自己的实际网格；权威图层变换只与网格比例合并一次。 */
export function resolveImageEditCpuSamplingRegionV3(
  context: ImageEditCpuSamplingContextV3,
  target: ImageEditCpuSamplingTargetV3,
  outputRegion: ImageEditRect,
  layerTransform: readonly number[] = [1, 0, 0, 1, 0, 0],
): { transform: ImageEditTransformV3; region: ImageEditRect } {
  const grid = resolveImageEditCpuSamplingGridV3(context, target)
  const transform = multiplyImageEditTransformsV3(layerTransform, grid.toEvaluation)
  // 整数恒等采样没有双线性邻域；扩大一像素会让一个 512 输出块读取四个源块。
  if (transform.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])) {
    const x = Math.min(grid.size.width, Math.max(0, outputRegion.x))
    const y = Math.min(grid.size.height, Math.max(0, outputRegion.y))
    return { transform, region: { x, y,
      width: Math.max(0, Math.min(grid.size.width, outputRegion.x + outputRegion.width) - x),
      height: Math.max(0, Math.min(grid.size.height, outputRegion.y + outputRegion.height) - y),
    } }
  }
  return { transform, region: resolveImageEditInverseSourceRectV3(outputRegion, transform, grid.size) }
}
