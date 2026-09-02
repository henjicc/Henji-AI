import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import {
  createImageEditAnnotationLayerV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { resolveLiveGaussianBlurRadiusV3, splitLiveAnnotationDisplayV3 } from './liveAnnotationDisplayV3'

function document(layers: ImageEditDocumentV3['layers'], revision = 1): ImageEditDocumentV3 {
  return {
    version: 3,
    id: 'document',
    revision,
    geometry: {
      width: 1_600,
      height: 1_000,
      orientation: { rotate: 0, mirrored: false },
      crop: null,
    },
    color: createDefaultImageEditColorModeV3(),
    layers,
  }
}

describe('图片编辑 V3 即时标注显示分层', () => {
  it('只剥离位于效果上方的连续标注层', () => {
    const raster = createImageEditRasterLayerV3('raster', '原图', `sha256:${'a'.repeat(64)}`)
    const below = createImageEditAnnotationLayerV3('below', '效果下标注')
    const blur = createImageEditEffectLayerV3('blur', '高斯模糊', 'image.gaussian-blur-v2', { radius: 20 })
    const top = createImageEditAnnotationLayerV3('top', '即时标注')
    const result = splitLiveAnnotationDisplayV3(document([raster, below, blur, top]))

    expect(result.baseDocument.layers.map(({ id }) => id)).toEqual(['raster', 'below', 'blur'])
    expect(result.liveLayers.map(({ id }) => id)).toEqual(['top'])
  })

  it('仅修改即时标注不会改变底图缓存身份', () => {
    const raster = createImageEditRasterLayerV3('raster', '原图', `sha256:${'b'.repeat(64)}`)
    const top = createImageEditAnnotationLayerV3('top', '即时标注')
    top.annotations = [{
      id: 'arrow', type: 'arrow', points: [10, 10, 90, 80], stroke: WHITE_HEX, lineWidth: 4,
    }]
    const first = splitLiveAnnotationDisplayV3(document([raster, top], 2))
    const arrow = top.annotations[0]
    if (arrow.type !== 'arrow') throw new Error('测试标注必须是箭头')
    top.annotations = [{ ...arrow, lineWidth: 18 }]
    const second = splitLiveAnnotationDisplayV3(document([raster, top], 3))

    expect(second.baseIdentity).toBe(first.baseIdentity)
  })

  it('移动过的顶层标注仍保持前台矢量编辑，不会退回慢速像素合成', () => {
    const raster = createImageEditRasterLayerV3('raster', '原图', `sha256:${'c'.repeat(64)}`)
    const top = createImageEditAnnotationLayerV3('top', '已移动标注')
    top.transform = [1, 0, 0, 1, 120, -45]

    const result = splitLiveAnnotationDisplayV3(document([raster, top]))

    expect(result.baseDocument.layers.map(({ id }) => id)).toEqual(['raster'])
    expect(result.liveLayers.map(({ id }) => id)).toEqual(['top'])
  })

  it('只对底图栈最上方的高斯模糊提供即时近似', () => {
    const blur = createImageEditEffectLayerV3('blur', '高斯模糊', 'image.gaussian-blur-v2', { radius: 36 })
    expect(resolveLiveGaussianBlurRadiusV3(document([blur]))).toBe(36)
    expect(resolveLiveGaussianBlurRadiusV3(document([
      blur,
      createImageEditAnnotationLayerV3('annotation', '标注'),
    ]))).toBeNull()
  })
})
