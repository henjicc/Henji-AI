import { describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  resolveImageEditorBlurPreviewMipV3,
  resolveImageEditorWideAreaEffectPreviewMipV3,
} from './previewEffectScalingV3'

function blurDocument(radius: number) {
  const document = createImageEditDocumentV3({ width: 6_000, height: 4_000 })
  document.layers.push(createImageEditEffectLayerV3(
    'blur',
    '模糊',
    'image.fast-blur-v3',
    { radius },
  ))
  return document
}

describe('resolveImageEditorBlurPreviewMipV3', () => {
  it('大半径模糊在适应窗口预览时降采样，但限制单像素放大倍率', () => {
    expect(resolveImageEditorBlurPreviewMipV3(
      blurDocument(64),
      { zoom: 0.5, devicePixelRatio: 1 },
    )).toBe(2)
  })

  it('用户放大检查细节时自动回到 mip 0', () => {
    expect(resolveImageEditorBlurPreviewMipV3(
      blurDocument(64),
      { zoom: 2, devicePixelRatio: 1.25 },
    )).toBe(0)
  })

  it('没有可见模糊时不干预普通图片的视口 mip 选择', () => {
    const document = blurDocument(32)
    document.layers[document.layers.length - 1].visible = false
    expect(resolveImageEditorBlurPreviewMipV3(
      document,
      { zoom: 0.5, devicePixelRatio: 1 },
    )).toBeUndefined()
  })
})

describe('resolveImageEditorWideAreaEffectPreviewMipV3', () => {
  it('辉光在 Retina 视口按 CSS 清晰度选择层级，避免四倍无感超采样', () => {
    const document = createImageEditDocumentV3({ width: 5_802, height: 3_655 })
    document.layers.push(createImageEditEffectLayerV3(
      'glow', '辉光 Pro', 'image.vgpu-glow', {},
    ))

    expect(resolveImageEditorWideAreaEffectPreviewMipV3(
      document,
      { zoom: 0.24 },
    )).toBe(2)
    expect(resolveImageEditorWideAreaEffectPreviewMipV3(
      document,
      { zoom: 0.36 },
    )).toBe(1)
  })
})
