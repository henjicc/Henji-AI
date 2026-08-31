import { describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  composeImageEditTransformV3,
  decomposeImageEditTransformV3,
  isImageEditLayerTransformableV3,
  mapImageEditOutputPointToLayerParentV3,
} from './layerTransformV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

describe('图片编辑 V3 图层变换交互坐标', () => {
  it('嵌套组和文档方向只用于输出坐标换算，不写入图层矩阵', () => {
    const child = createImageEditRasterLayerV3('child', '子图层')
    const group = createImageEditGroupLayerV3('group', '组')
    group.transform = [2, 0, 0, 2, 10, 5]
    group.children = [child]
    const document = createImageEditDocumentV3({ width: 100, height: 50, documentId: 'nested' })
    document.geometry.orientation = { rotate: 90, mirrored: false }
    document.layers = [group]
    const location = findImageEditLayerLocationV3(document.layers, child.id)
    if (!location) throw new Error('测试图层不存在')

    expect(mapImageEditOutputPointToLayerParentV3(document, location, [37, 16]))
      .toEqual([3, 4])
    expect(document.geometry.orientation).toEqual({ rotate: 90, mirrored: false })
  })

  it('隐藏、锁定、隐藏祖先和锁定祖先都不能进入 move 手势', () => {
    const child = createImageEditRasterLayerV3('child', '子图层')
    const group = createImageEditGroupLayerV3('group', '组')
    group.children = [child]
    const document = createImageEditDocumentV3({ width: 10, height: 10, documentId: 'locks' })
    document.layers = [group]
    const allowed = () => isImageEditLayerTransformableV3(
      findImageEditLayerLocationV3(document.layers, child.id),
    )
    expect(allowed()).toBe(true)
    child.visible = false
    expect(allowed()).toBe(false)
    child.visible = true
    child.locked = true
    expect(allowed()).toBe(false)
    child.locked = false
    group.visible = false
    expect(allowed()).toBe(false)
    group.visible = true
    group.locked = true
    expect(allowed()).toBe(false)
  })

  it('数值字段往返保留未暴露的 shear，并拒绝零缩放', () => {
    const fields = decomposeImageEditTransformV3([1, 0, 0.25, 2, 3, 4])
    expect(composeImageEditTransformV3(fields)).toEqual([1, 0, 0.25, 2, 3, 4])
    expect(composeImageEditTransformV3({ ...fields, scaleXPercent: 0 })).toBeNull()
  })
})
