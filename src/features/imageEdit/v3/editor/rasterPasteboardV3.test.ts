import { describe, expect, it } from 'vitest'

import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  imageEditorRasterPasteboardTransformV3,
  resolveImageEditorRasterPasteboardLayerV3,
} from './rasterPasteboardV3'

describe('ImageEditorRasterPasteboardV3', () => {
  it('只让可精确复现的单一原始栅格图层进入文档外编辑区', () => {
    const document = createImageEditDocumentV3({
      width: 1_600,
      height: 1_000,
      sourceResourceId: 'sha256:source',
    })

    expect(resolveImageEditorRasterPasteboardLayerV3(document)?.id).toBe(document.layers[0].id)

    document.layers.push(createImageEditAnnotationLayerV3('annotation', '标注'))
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()

    document.layers[1].visible = false
    document.layers[0].mask = { resourceId: 'sha256:mask', inverted: false }
    expect(resolveImageEditorRasterPasteboardLayerV3(document)).toBeNull()
  })

  it('将文档像素位移换算成适应窗口后的工作区位移', () => {
    expect(imageEditorRasterPasteboardTransformV3(
      [1, 0, 0, 1, 100, -240],
      800,
      1_600,
    )).toBe('matrix(1, 0, 0, 1, 50, -120)')
  })
})
