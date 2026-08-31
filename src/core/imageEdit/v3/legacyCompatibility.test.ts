import { describe, expect, it } from 'vitest'

import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from './documentFactory'
import { isImageEditDocumentLegacyExpressibleV3 } from './legacyCompatibility'

describe('isImageEditDocumentLegacyExpressibleV3', () => {
  it('仅允许旧版可以无损表达的固定顺序子集', () => {
    const document = createImageEditDocumentV3({ width: 100, height: 100 })
    document.layers = [
      createImageEditRasterLayerV3('base', 'base', 'sha256:base'),
      createImageEditEffectLayerV3('blur', 'blur', 'image.blur', { radiusPixels: 3 }),
      createImageEditAnnotationLayerV3('marks', 'marks'),
    ]
    expect(isImageEditDocumentLegacyExpressibleV3(document)).toBe(true)

    document.layers.splice(1, 0, createImageEditEffectLayerV3(
      'blur-2',
      'blur-2',
      'image.blur',
      { radiusPixels: 8 },
    ))
    expect(isImageEditDocumentLegacyExpressibleV3(document)).toBe(false)
  })

  it('拒绝组和蒙版，避免旧版打开时静默丢编辑', () => {
    const document = createImageEditDocumentV3({ width: 100, height: 100 })
    document.layers = [
      createImageEditRasterLayerV3('base', 'base', 'sha256:base'),
      createImageEditGroupLayerV3('group', 'group'),
    ]
    expect(isImageEditDocumentLegacyExpressibleV3(document)).toBe(false)
    document.layers = [createImageEditRasterLayerV3('base', 'base', 'sha256:base')]
    document.layers[0].mask = { resourceId: 'sha256:mask', inverted: false }
    expect(isImageEditDocumentLegacyExpressibleV3(document)).toBe(false)
  })
})
