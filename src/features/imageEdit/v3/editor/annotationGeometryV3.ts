import type {
  ImageEditCropRectV3,
  ImageEditDocumentV3,
  ImageEditOrientationV3,
} from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'

export type AnnotationMatrixV3 = readonly [number, number, number, number, number, number]

export interface AnnotationOutputGeometryV3 {
  width: number
  height: number
  sourceToOutput: AnnotationMatrixV3
}

const IDENTITY: AnnotationMatrixV3 = [1, 0, 0, 1, 0, 0]

/** 返回 `outer(inner(point))`，与 Canvas/SVG 仿射矩阵的参数顺序一致。 */
export function multiplyAnnotationMatricesV3(
  outer: AnnotationMatrixV3,
  inner: AnnotationMatrixV3,
): AnnotationMatrixV3 {
  const [a1, b1, c1, d1, e1, f1] = outer
  const [a2, b2, c2, d2, e2, f2] = inner
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function invertAnnotationMatrixV3(matrix: AnnotationMatrixV3): AnnotationMatrixV3 {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    throw new Error('标注图层变换矩阵不可逆')
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}

export function mapAnnotationPointV3(
  matrix: AnnotationMatrixV3,
  point: readonly [number, number],
): readonly [number, number] {
  const [a, b, c, d, e, f] = matrix
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f]
}

function orientationMatrix(
  width: number,
  height: number,
  orientation: ImageEditOrientationV3,
): AnnotationMatrixV3 {
  const mirror: AnnotationMatrixV3 = orientation.mirrored
    ? [-1, 0, 0, 1, width, 0]
    : IDENTITY
  let rotation: AnnotationMatrixV3
  if (orientation.rotate === 90) rotation = [0, 1, -1, 0, height, 0]
  else if (orientation.rotate === 180) rotation = [-1, 0, 0, -1, width, height]
  else if (orientation.rotate === 270) rotation = [0, -1, 1, 0, 0, width]
  else rotation = IDENTITY
  return multiplyAnnotationMatricesV3(rotation, mirror)
}

function cropMatrix(crop: ImageEditCropRectV3 | null): AnnotationMatrixV3 {
  return crop ? [1, 0, 0, 1, -crop.x, -crop.y] : IDENTITY
}

export function resolveAnnotationOutputGeometryV3(
  document: Pick<ImageEditDocumentV3, 'geometry'>,
): AnnotationOutputGeometryV3 {
  const { width, height, orientation, crop } = document.geometry
  const swapsAxes = orientation.rotate === 90 || orientation.rotate === 270
  return {
    width: crop?.width ?? (swapsAxes ? height : width),
    height: crop?.height ?? (swapsAxes ? width : height),
    sourceToOutput: multiplyAnnotationMatricesV3(
      cropMatrix(crop),
      orientationMatrix(width, height, orientation),
    ),
  }
}

/** 标注尺寸百分比以当前图片输出区域的短边为基准，不受无限画布或窗口缩放影响。 */
export function resolveAnnotationRelativeSizeBaseV3(
  document: Pick<ImageEditDocumentV3, 'geometry'>,
): number {
  const geometry = resolveAnnotationOutputGeometryV3(document)
  return Math.max(1, Math.min(geometry.width, geometry.height))
}

export function resolveAnnotationLayerToOutputMatrixV3(
  document: Pick<ImageEditDocumentV3, 'geometry'>,
  transforms: readonly ImageEditTransformV3[],
): AnnotationMatrixV3 {
  let layerToSource: AnnotationMatrixV3 = IDENTITY
  for (const transform of transforms) {
    layerToSource = multiplyAnnotationMatricesV3(transform, layerToSource)
  }
  return multiplyAnnotationMatricesV3(
    resolveAnnotationOutputGeometryV3(document).sourceToOutput,
    layerToSource,
  )
}

export function annotationMatrixToSvgV3(matrix: AnnotationMatrixV3): string {
  return `matrix(${matrix.join(' ')})`
}
