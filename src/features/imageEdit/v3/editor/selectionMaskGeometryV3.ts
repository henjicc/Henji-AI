import type {
  ImageEditSelectionPointV3,
  ImageEditSelectionShapeV3,
} from '@/core/imageEdit/v3/selection'
import { mapAnnotationPointV3, type AnnotationMatrixV3 } from './annotationGeometryV3'

export type ImageEditorSelectionToolV3 = 'select-rect' | 'select-ellipse' | 'select-lasso'

const ELLIPSE_SEGMENTS = 128

function mapPoint(
  inverseMatrix: AnnotationMatrixV3,
  point: ImageEditSelectionPointV3,
): ImageEditSelectionPointV3 {
  const [x, y] = mapAnnotationPointV3(inverseMatrix, [point.x, point.y])
  return { x, y }
}

function rectanglePoints(
  start: ImageEditSelectionPointV3,
  end: ImageEditSelectionPointV3,
): ImageEditSelectionPointV3[] {
  const left = Math.min(start.x, end.x)
  const right = Math.max(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const bottom = Math.max(start.y, end.y)
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

function ellipsePoints(
  start: ImageEditSelectionPointV3,
  end: ImageEditSelectionPointV3,
): ImageEditSelectionPointV3[] {
  const centerX = (start.x + end.x) / 2
  const centerY = (start.y + end.y) / 2
  const radiusX = Math.abs(end.x - start.x) / 2
  const radiusY = Math.abs(end.y - start.y) / 2
  return Array.from({ length: ELLIPSE_SEGMENTS }, (_, index) => {
    const angle = index / ELLIPSE_SEGMENTS * Math.PI * 2
    return {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    }
  })
}

/**
 * 屏幕对齐的矩形/椭圆经过任意图层仿射逆变换后不再是轴对齐形状，
 * 因此统一转为局部套索。椭圆使用固定 128 段，保证不同宿主结果确定。
 */
export function imageEditorSelectionOutputToLayerShapeV3(input: {
  tool: ImageEditorSelectionToolV3
  start: ImageEditSelectionPointV3
  end: ImageEditSelectionPointV3
  lassoPoints?: readonly ImageEditSelectionPointV3[]
  inverseMatrix: AnnotationMatrixV3
}): ImageEditSelectionShapeV3 {
  const outputPoints = input.tool === 'select-rect'
    ? rectanglePoints(input.start, input.end)
    : input.tool === 'select-ellipse'
      ? ellipsePoints(input.start, input.end)
      : [...(input.lassoPoints ?? [])]
  if (outputPoints.length < 3) throw new Error('选区至少需要三个有效点')
  return {
    type: 'lasso',
    points: outputPoints.map((point) => mapPoint(input.inverseMatrix, point)),
  }
}

export function isImageEditorSelectionGestureDrawableV3(input: {
  tool: ImageEditorSelectionToolV3
  start: ImageEditSelectionPointV3
  end: ImageEditSelectionPointV3
  lassoPoints?: readonly ImageEditSelectionPointV3[]
}): boolean {
  if (input.tool === 'select-lasso') return (input.lassoPoints?.length ?? 0) >= 3
  return Math.abs(input.end.x - input.start.x) >= 0.5
    && Math.abs(input.end.y - input.start.y) >= 0.5
}
