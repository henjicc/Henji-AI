import { describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { mapAnnotationPointV3 } from './annotationGeometryV3'
import {
  imageEditorSelectionAllowedCombineModesV3,
  resolveImageEditorSelectionMaskTargetV3,
} from './selectionMaskLayerV3'

const RESOURCE_ID = `sha256:${'a'.repeat(64)}`

describe('图片编辑 V3 选区蒙版目标', () => {
  it('只有 defaultValue=0 的稀疏蒙版允许全组合模式', () => {
    const layer = createImageEditRasterLayerV3('layer', '图层')
    expect(imageEditorSelectionAllowedCombineModesV3(layer)).toEqual(['replace'])
    layer.mask = { resourceId: RESOURCE_ID, inverted: false }
    expect(imageEditorSelectionAllowedCombineModesV3(layer)).toEqual(['replace'])
    layer.mask = createImageEditSparseMaskReferenceV3('default-one')
    expect(imageEditorSelectionAllowedCombineModesV3(layer)).toEqual(['replace'])
    layer.mask = createImageEditSparseMaskReferenceV3('default-zero', false, 0)
    expect(imageEditorSelectionAllowedCombineModesV3(layer)).toEqual([
      'replace', 'add', 'subtract', 'intersect',
    ])
  })

  it('把 owner 与祖先变换映射到输出坐标并提供精确逆矩阵', () => {
    const document = createImageEditDocumentV3({ width: 200, height: 100 })
    const layer = createImageEditRasterLayerV3('layer', '图层')
    layer.transform = [1, 0, 0, 1, 5, 7]
    const group = createImageEditGroupLayerV3('group', '图层组')
    group.transform = [2, 0, 0, 2, 0, 0]
    group.children = [layer]
    document.layers = [group]

    const resolved = resolveImageEditorSelectionMaskTargetV3({
      document,
      selectedLayerIds: [layer.id],
      combineMode: 'replace',
      resourceByteSizes: new Map(),
    })

    expect(resolved.ready).toBe(true)
    if (!resolved.ready) return
    expect(mapAnnotationPointV3(resolved.target.matrix, [10, 10])).toEqual([30, 34])
    expect(mapAnnotationPointV3(resolved.target.inverseMatrix, [30, 34])).toEqual([10, 10])
  })

  it('旧蒙版或资源大小不完整时只允许安全替换并明确阻止提交', () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64 })
    const layer = createImageEditRasterLayerV3('layer', '图层')
    layer.mask = { resourceId: RESOURCE_ID, inverted: false }
    document.layers = [layer]

    expect(resolveImageEditorSelectionMaskTargetV3({
      document,
      selectedLayerIds: [layer.id],
      combineMode: 'add',
      resourceByteSizes: new Map([[RESOURCE_ID, 32]]),
    })).toEqual({ ready: false, reason: 'unsupported-combine' })
    expect(resolveImageEditorSelectionMaskTargetV3({
      document,
      selectedLayerIds: [layer.id],
      combineMode: 'replace',
      resourceByteSizes: new Map([[RESOURCE_ID, 0]]),
    })).toEqual({ ready: false, reason: 'missing-resource-size' })
    expect(resolveImageEditorSelectionMaskTargetV3({
      document,
      selectedLayerIds: [layer.id],
      combineMode: 'replace',
      resourceByteSizes: new Map([[RESOURCE_ID, 32]]),
    })).toMatchObject({ ready: true })
  })
})
