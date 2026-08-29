import { describe, expect, it } from 'vitest'

import {
  FAL_TOPAZ_CREATIVE_MODELS,
  FAL_TOPAZ_GENERATIVE_MODELS,
  FAL_TOPAZ_PRECISION_MODELS,
  falTopazImageUpscaleModel,
} from '../../src/catalog/fal/topaz-image-upscale.model'

describe('Fal Topaz Image Upscale catalog', () => {
  it('按处理模式选择三个官方端点并保持单图输入', async () => {
    const selector = falTopazImageUpscaleModel.endpoints as {
      selector: (params: DynamicValueMap) => Promise<string>
    }
    await expect(selector.selector({ falTopazUpscaleMode: 'precision' }))
      .resolves.toBe('topaz/upscale/image/precision')
    await expect(selector.selector({ falTopazUpscaleMode: 'creative' }))
      .resolves.toBe('topaz/upscale/image/creative')
    await expect(selector.selector({ falTopazUpscaleMode: 'generative' }))
      .resolves.toBe('topaz/upscale/image/generative')
    await expect(selector.selector({ falTopazUpscaleMode: 'unknown' }))
      .resolves.toBe('topaz/upscale/image/precision')
    expect(falTopazImageUpscaleModel.inputLimits).toEqual({
      images: { min: 1, max: 1 },
      videos: { max: 0 },
    })
  })

  it('声明三组官方子模型与受控 2×/4× 倍率', () => {
    expect(falTopazImageUpscaleModel.params.map((param) => param.id)).toEqual([
      'falTopazUpscaleMode',
      'falTopazPrecisionModel',
      'falTopazCreativeModel',
      'falTopazGenerativeModel',
      'falTopazUpscaleFactor',
      'falTopazFaceEnhancement',
      'falTopazCreativeStrength',
      'falTopazColorPreservation',
      'falTopazEnhancementStrength',
    ])
    expect(falTopazImageUpscaleModel.params[1]).toMatchObject({
      default: 'High Fidelity V3',
      options: FAL_TOPAZ_PRECISION_MODELS.map((value) => ({ value })),
    })
    expect(falTopazImageUpscaleModel.params[2]).toMatchObject({
      options: FAL_TOPAZ_CREATIVE_MODELS.map((value) => ({ value })),
    })
    expect(falTopazImageUpscaleModel.params[3]).toMatchObject({
      options: FAL_TOPAZ_GENERATIVE_MODELS.map((value) => ({ value })),
    })
    expect(falTopazImageUpscaleModel.params[4]).toMatchObject({
      default: 2,
      options: [{ value: 2 }, { value: 4 }],
    })
  })

  it('构建精确放大请求并隐藏输出格式', () => {
    const request = falTopazImageUpscaleModel.request?.builder?.({
      images: ['source.png'],
      falTopazUpscaleMode: 'precision',
      falTopazPrecisionModel: 'Text Refine',
      falTopazUpscaleFactor: 4,
      falTopazFaceEnhancement: true,
    })
    expect(request).toEqual({
      image_url: 'source.png',
      model: 'Text Refine',
      upscale_factor: 4,
      crop_to_fill: false,
      face_enhancement: true,
      face_enhancement_creativity: 0,
      face_enhancement_strength: 0.8,
    })
    expect(request).not.toHaveProperty('output_format')
    expect(request).not.toHaveProperty('prompt')
  })

  it('只向 Bloom 2 下发创意强度与色彩保留', () => {
    expect(falTopazImageUpscaleModel.request?.builder?.({
      images: ['source.png'],
      falTopazUpscaleMode: 'creative',
      falTopazCreativeModel: 'Bloom 2',
      falTopazCreativeStrength: 8.6,
      falTopazColorPreservation: false,
      falTopazUpscaleFactor: 2,
    })).toEqual({
      image_url: 'source.png',
      model: 'Bloom 2',
      upscale_factor: 2,
      crop_to_fill: false,
      creativity: 9,
      color_preservation: false,
    })
    expect(falTopazImageUpscaleModel.request?.builder?.({
      images: ['source.png'],
      falTopazUpscaleMode: 'creative',
      falTopazCreativeModel: 'Bloom Realism',
    })).toEqual({
      image_url: 'source.png',
      model: 'Bloom Realism',
      upscale_factor: 2,
      crop_to_fill: false,
    })
  })

  it('向 Wonder 3/3.5 下发重建强度并对非法值回落', () => {
    expect(falTopazImageUpscaleModel.request?.builder?.({
      uploadedFilePaths: ['source.jpg'],
      falTopazUpscaleMode: 'generative',
      falTopazGenerativeModel: 'Wonder 3',
      falTopazEnhancementStrength: 'high',
      falTopazUpscaleFactor: 3,
    })).toEqual({
      image_url: 'source.jpg',
      model: 'Wonder 3',
      upscale_factor: 2,
      crop_to_fill: false,
      face_enhancement: false,
      enhancement_strength: 'high',
    })
  })

  it('按模式和子模型的官方输出像素阶梯估价', () => {
    const calculator = falTopazImageUpscaleModel.pricing.calculator
    expect(calculator?.({
      falTopazUpscaleMode: 'precision',
      __upscaleOutputMegapixels: 24.01,
    })).toBe(0.16)
    expect(calculator?.({
      falTopazUpscaleMode: 'creative',
      __upscaleOutputMegapixels: 4,
    })).toBe(0.16)
    expect(calculator?.({
      falTopazUpscaleMode: 'generative',
      falTopazGenerativeModel: 'Wonder 3.5',
      __upscaleOutputMegapixels: 8.01,
    })).toBe(0.16)
    expect(calculator?.({
      falTopazUpscaleMode: 'generative',
      falTopazGenerativeModel: 'Recovery',
      __upscaleOutputMegapixels: 8,
    })).toBe(0.16)
    expect(calculator?.({})).toBeNaN()
    expect(falTopazImageUpscaleModel.pricing.mediaContext).toEqual([
      {
        targetParam: '__upscaleOutputMegapixels',
        mediaType: 'image',
        metric: 'megapixels',
        multiplier: {
          kind: 'parameter',
          paramId: 'falTopazUpscaleFactor',
          fallback: 2,
          exponent: 2,
        },
      },
    ])
  })

  it('拒绝缺少源图或多张源图', () => {
    expect(() => falTopazImageUpscaleModel.request?.builder?.({}))
      .toThrow(/必须且只能提供 1 张源图/)
    expect(() => falTopazImageUpscaleModel.request?.builder?.({ images: ['a.png', 'b.png'] }))
      .toThrow(/必须且只能提供 1 张源图/)
  })
})
