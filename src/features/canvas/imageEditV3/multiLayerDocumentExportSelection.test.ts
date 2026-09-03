import { describe, expect, it } from 'vitest'

import {
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'

import { resolveMultiLayerDocumentExportSelection } from './multiLayerDocumentExportSelection'

function document() {
  const annotation = createImageEditAnnotationLayerV3('annotation', '标注')
  annotation.annotations = [{
    id: 'mark-a', type: 'text', x: 1, y: 2, text: 'A', color: 'red', fontSize: 12,
  }]
  return {
    ...createImageEditDocumentV3({ width: 640, height: 480, documentId: 'export-document' }),
    layers: [
      createImageEditRasterLayerV3('raster', '像素'),
      createImageEditGroupLayerV3('group', '组'),
      annotation,
      createImageEditEffectLayerV3('effect', '效果', 'blur', {}),
      createImageEditAdjustmentLayerV3('adjustment', '调整', 'levels', {}),
    ],
  }
}

describe('多图层文档导出选择映射', () => {
  it.each([
    ['raster', 'image_edit.layer'],
    ['group', 'image_edit.group'],
  ])('%s 映射为稳定引用 %s', (layerId, kind) => {
    expect(resolveMultiLayerDocumentExportSelection({
      document: document(), selectedLayerIds: [layerId],
    })).toMatchObject({ ready: true, targetRef: { kind } })
  })

  it('只有选中具体标注元素时映射 image_mark.annotation', () => {
    expect(resolveMultiLayerDocumentExportSelection({
      document: document(),
      selectedLayerIds: ['annotation'],
    })).toMatchObject({ ready: false, reason: expect.stringContaining('具体元素') })
    expect(resolveMultiLayerDocumentExportSelection({
      document: document(),
      selectedLayerIds: ['annotation'],
      annotationSelection: { layerId: 'annotation', annotationId: 'mark-a' },
    })).toMatchObject({ ready: true, targetRef: { kind: 'image_mark.annotation' } })
  })

  it.each([
    ['effect', '效果层'],
    ['adjustment', '调整层'],
  ])('%s 显式拒绝并说明上下文依赖', (layerId, reason) => {
    expect(resolveMultiLayerDocumentExportSelection({
      document: document(), selectedLayerIds: [layerId],
    })).toMatchObject({ ready: false, reason: expect.stringContaining(reason) })
  })

  it('多选、浮点和 HDR 文档均返回用户可理解的不可用原因', () => {
    expect(resolveMultiLayerDocumentExportSelection({
      document: document(), selectedLayerIds: ['raster', 'group'],
    })).toMatchObject({ ready: false, reason: expect.stringContaining('一次只能') })
    expect(resolveMultiLayerDocumentExportSelection({
      document: { ...document(), color: { ...document().color, bitDepth: 'float16' as const } },
      selectedLayerIds: ['raster'],
    })).toMatchObject({ ready: false, reason: expect.stringContaining('浮点') })
    const base = document()
    expect(resolveMultiLayerDocumentExportSelection({
      document: {
        ...base,
        color: {
          ...base.color,
          hdrMetadata: {
            standard: 'pq', referenceWhiteNits: 203,
            cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: false },
          },
        },
      },
      selectedLayerIds: ['raster'],
    })).toMatchObject({ ready: false, reason: expect.stringContaining('HDR') })
  })
})
