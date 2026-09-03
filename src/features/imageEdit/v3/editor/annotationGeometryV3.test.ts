import { describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  invertAnnotationMatrixV3,
  mapAnnotationPointV3,
  resolveAnnotationLayerToOutputMatrixV3,
  resolveAnnotationOutputGeometryV3,
  resolveAnnotationRelativeSizeBaseV3,
} from './annotationGeometryV3'
import { simplifyAnnotationPenPointsV3 } from './annotationModelV3'

describe('V3 标注输出坐标', () => {
  it('按镜像、90 度方向和裁剪顺序映射并可逆', () => {
    const document = createImageEditDocumentV3({ width: 400, height: 300 })
    document.geometry.orientation = { rotate: 90, mirrored: true }
    document.geometry.crop = { x: 20, y: 30, width: 180, height: 240 }
    const geometry = resolveAnnotationOutputGeometryV3(document)

    expect(geometry).toMatchObject({ width: 180, height: 240 })
    expect(mapAnnotationPointV3(geometry.sourceToOutput, [50, 80])).toEqual([200, 320])
    expect(mapAnnotationPointV3(
      invertAnnotationMatrixV3(geometry.sourceToOutput),
      [200, 320],
    )).toEqual([50, 80])
    expect(resolveAnnotationRelativeSizeBaseV3(document)).toBe(180)
  })

  it('把图层与祖先变换先于输出几何执行', () => {
    const document = createImageEditDocumentV3({ width: 200, height: 100 })
    document.geometry.crop = { x: 10, y: 5, width: 100, height: 80 }
    const matrix = resolveAnnotationLayerToOutputMatrixV3(document, [
      [1, 0, 0, 1, 5, 7],
      [2, 0, 0, 2, 0, 0],
    ])

    expect(mapAnnotationPointV3(matrix, [10, 10])).toEqual([20, 29])
  })

  it('在笔画结束时移除屏幕容差内的冗余共线点', () => {
    expect(simplifyAnnotationPenPointsV3([
      0, 0, 1, 0.05, 2, -0.04, 3, 0,
    ], 0.1)).toEqual([0, 0, 3, 0])
  })
})
