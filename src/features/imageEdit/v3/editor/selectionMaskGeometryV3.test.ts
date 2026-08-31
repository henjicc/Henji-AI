import { describe, expect, it } from 'vitest'

import { mapAnnotationPointV3 } from './annotationGeometryV3'
import {
  imageEditorSelectionOutputToLayerShapeV3,
  isImageEditorSelectionGestureDrawableV3,
} from './selectionMaskGeometryV3'

describe('图片编辑 V3 选区局部几何', () => {
  it('把屏幕轴对齐矩形的四角映射为图层局部套索', () => {
    const inverseMatrix = [0.5, 0.25, -0.5, 1, -5, 3] as const
    const shape = imageEditorSelectionOutputToLayerShapeV3({
      tool: 'select-rect',
      start: { x: 30, y: 20 },
      end: { x: 10, y: 40 },
      inverseMatrix,
    })

    expect(shape.type).toBe('lasso')
    if (shape.type !== 'lasso') return
    expect(shape.points).toEqual([
      { x: -10, y: 25.5 },
      { x: 0, y: 30.5 },
      { x: -10, y: 50.5 },
      { x: -20, y: 45.5 },
    ])
  })

  it('椭圆固定采样 128 点后再做任意 affine 逆映射', () => {
    const inverseMatrix = [1, 0.25, -0.5, 1, 3, 4] as const
    const shape = imageEditorSelectionOutputToLayerShapeV3({
      tool: 'select-ellipse',
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      inverseMatrix,
    })

    expect(shape.type).toBe('lasso')
    if (shape.type !== 'lasso') return
    expect(shape.points).toHaveLength(128)
    const [firstX, firstY] = mapAnnotationPointV3(inverseMatrix, [30, 30])
    expect(shape.points[0]).toEqual({ x: firstX, y: firstY })
    expect(shape.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
  })

  it('套索保留采样点，并过滤不足三个点或过小矩形', () => {
    const points = [{ x: 1, y: 2 }, { x: 8, y: 3 }, { x: 4, y: 9 }]
    const shape = imageEditorSelectionOutputToLayerShapeV3({
      tool: 'select-lasso', start: points[0], end: points[2], lassoPoints: points,
      inverseMatrix: [1, 0, 0, 1, 0, 0],
    })
    expect(shape).toEqual({ type: 'lasso', points })
    expect(isImageEditorSelectionGestureDrawableV3({
      tool: 'select-lasso', start: points[0], end: points[1], lassoPoints: points.slice(0, 2),
    })).toBe(false)
    expect(isImageEditorSelectionGestureDrawableV3({
      tool: 'select-rect', start: { x: 0, y: 0 }, end: { x: 0.4, y: 2 },
    })).toBe(false)
  })
})
