
import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { createImageEditPathLayerV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

import {
  resolveLiveBlurRadiusV3,
  resolveLiveVgpuGlowFeedbackV3,
  splitLiveAnnotationDisplayV3,
} from './liveAnnotationDisplayV3'

function document(layers: ImageEditDocumentV3['layers'], revision = 1): ImageEditDocumentV3 {
  return {
    version: 9,
      namedRegions: [],
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
  it('矢量内容与变换都参与唯一合成及缓存身份',()=>{
    const top=createImageEditPathLayerV3('top','形状')
    const first=splitLiveAnnotationDisplayV3(document([top]))
    expect(first.baseDocument.layers).toEqual([top]);expect(first.liveLayers).toEqual([])
    top.transform=[1,0,0,1,20,30]
    const second=splitLiveAnnotationDisplayV3(document([top],2))
    expect(second.baseIdentity).not.toBe(first.baseIdentity)
  })

  it('只对底图栈最上方的模糊提供即时近似，并兼容旧高斯图层', () => {
    const blur = createImageEditEffectLayerV3('blur', '模糊', 'image.fast-blur-v3', { radius: 36 })
    expect(resolveLiveBlurRadiusV3(document([blur]))).toBe(36)
    expect(resolveLiveBlurRadiusV3(document([
      blur,
      createImageEditPathLayerV3('annotation', '标注'),
    ]))).toBeNull()
    const legacy = createImageEditEffectLayerV3(
      'legacy-blur', '高斯模糊', 'gaussian_blur', { sigma_fraction_height: .012 },
    )
    expect(resolveLiveBlurRadiusV3(document([legacy]))).toBeNull()
  })

  it('只对最上方辉光提供保持画布几何不变的即时反馈参数', () => {
    const glow = createImageEditEffectLayerV3('glow', '辉光 Pro', 'image.vgpu-glow', {
      intensity: 0.7,
      radius: 0.4,
      sourceThreshold: 0.3,
      whiteHeat: 0.6,
    })
    glow.opacity = 0.5
    expect(resolveLiveVgpuGlowFeedbackV3(document([glow]))).toEqual({
      intensity: 0.35,
      radius: 0.4,
      sourceThreshold: 0.3,
      whiteHeat: 0.6,
    })
  })
})
