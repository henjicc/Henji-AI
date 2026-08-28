import { describe, expect, it } from 'vitest'

import {
  FAL_TOPAZ_PRECISION_MODELS,
  falTopazImageUpscaleModel,
} from '../../src/catalog/fal/topaz-image-upscale.model'

describe('Fal Topaz Image Upscale catalog', () => {
  it('固定使用官方端点与单图输入契约', async () => {
    const selector = falTopazImageUpscaleModel.endpoints as { selector: () => Promise<string> }
    expect(await selector.selector()).toBe('fal-ai/topaz/upscale/image')
    expect(falTopazImageUpscaleModel.inputLimits).toEqual({
      images: { min: 1, max: 1 },
      videos: { max: 0 },
    })
  })

  it('只暴露非生成式精度模型、2×/4×与人脸增强', () => {
    expect(falTopazImageUpscaleModel.params.map((param) => param.id)).toEqual([
      'falTopazUpscaleModel',
      'falTopazUpscaleFactor',
      'falTopazFaceEnhancement',
    ])
    expect(falTopazImageUpscaleModel.params[0]).toMatchObject({
      default: 'High Fidelity V2',
      options: FAL_TOPAZ_PRECISION_MODELS.map((value) => ({ value })),
    })
    expect(falTopazImageUpscaleModel.params[1]).toMatchObject({
      default: 2,
      options: [{ value: 2 }, { value: 4 }],
    })
  })

  it('构建忠实放大请求且不发送生成式、裁切或输出格式字段', () => {
    const request = falTopazImageUpscaleModel.request?.builder?.({
      images: ['source.png'],
      falTopazUpscaleModel: 'Text Refine',
      falTopazUpscaleFactor: 4,
      falTopazFaceEnhancement: false,
    })
    expect(request).toEqual({
      image_url: 'source.png',
      model: 'Text Refine',
      upscale_factor: 4,
      crop_to_fill: false,
      subject_detection: 'All',
      face_enhancement: false,
    })
    expect(request).not.toHaveProperty('output_format')
    expect(request).not.toHaveProperty('prompt')
    expect(request).not.toHaveProperty('creativity')
  })

  it('人脸增强固定使用零创造性，非法参数回落到安全默认值', () => {
    expect(falTopazImageUpscaleModel.request?.builder?.({
      uploadedFilePaths: ['source.jpg'],
      falTopazUpscaleModel: 'Wonder 3',
      falTopazUpscaleFactor: 3,
      falTopazFaceEnhancement: true,
    })).toEqual({
      image_url: 'source.jpg',
      model: 'High Fidelity V2',
      upscale_factor: 2,
      crop_to_fill: false,
      subject_detection: 'All',
      face_enhancement: true,
      face_enhancement_creativity: 0,
      face_enhancement_strength: 0.8,
    })
  })

  it('拒绝缺少源图或多张源图', () => {
    expect(() => falTopazImageUpscaleModel.request?.builder?.({}))
      .toThrow(/必须且只能提供 1 张源图/)
    expect(() => falTopazImageUpscaleModel.request?.builder?.({ images: ['a.png', 'b.png'] }))
      .toThrow(/必须且只能提供 1 张源图/)
  })

  it('按官方输出像素阶梯估价，并在尺寸未知时保守使用首版最高档', () => {
    const calculator = falTopazImageUpscaleModel.pricing.calculator
    expect(calculator?.({ __falTopazOutputMegapixels: 24 })).toBe(0.08)
    expect(calculator?.({ __falTopazOutputMegapixels: 24.01 })).toBe(0.16)
    expect(calculator?.({ __falTopazOutputMegapixels: 48 })).toBe(0.16)
    expect(calculator?.({})).toBe(0.16)
    expect(calculator?.({ __falTopazOutputMegapixels: 49 })).toBe(1.36)
  })
})
