import { describe, expect, it } from 'vitest'

import { falBriaCreativeUpscaleModel } from '../../src/catalog/fal/bria-creative-upscale.model'
import { falIdeogramUpscaleModel } from '../../src/catalog/fal/ideogram-upscale.model'
import { falSeedvr2ImageUpscaleModel } from '../../src/catalog/fal/seedvr2-image-upscale.model'
import { falTopazTransparentUpscaleModel } from '../../src/catalog/fal/topaz-transparent-upscale.model'

function endpoint(model: { endpoints: unknown }): () => Promise<string> {
  return (model.endpoints as { selector: () => Promise<string> }).selector
}

describe('Fal 图片放大扩展模型', () => {
  it('Topaz 透明图使用固定 4× 专用端点并按输出像素阶梯计价', async () => {
    await expect(endpoint(falTopazTransparentUpscaleModel)())
      .resolves.toBe('topaz/upscale/image/transparent')
    expect(falTopazTransparentUpscaleModel.params).toEqual([])
    expect(falTopazTransparentUpscaleModel.request?.builder?.({ images: ['alpha.png'] }))
      .toEqual({ image_url: 'alpha.png' })
    expect(falTopazTransparentUpscaleModel.pricing.calculator?.({
      __upscaleOutputMegapixels: 24.01,
    })).toBe(0.16)
  })

  it('SeedVR2 只开放 2×/4×并按预计输出 MP 估价', async () => {
    await expect(endpoint(falSeedvr2ImageUpscaleModel)())
      .resolves.toBe('fal-ai/seedvr/upscale/image')
    expect(falSeedvr2ImageUpscaleModel.request?.builder?.({
      images: ['source.jpg'],
      falSeedvr2UpscaleFactor: 4,
      falSeedvr2NoiseScale: 0,
    })).toEqual({
      image_url: 'source.jpg',
      upscale_mode: 'factor',
      upscale_factor: 4,
      noise_scale: 0,
    })
    expect(falSeedvr2ImageUpscaleModel.pricing.calculator?.({
      __upscaleOutputMegapixels: 12.5,
    })).toBeCloseTo(0.0125)
  })

  it('Bria 固定约 2×且默认保留透明通道', async () => {
    await expect(endpoint(falBriaCreativeUpscaleModel)())
      .resolves.toBe('bria/upscale/creative')
    expect(falBriaCreativeUpscaleModel.request?.builder?.({ images: ['source.png'] }))
      .toEqual({ image_url: 'source.png', preserve_alpha: true })
    expect(falBriaCreativeUpscaleModel.pricing.fixed).toBe(0.04)
  })

  it('Ideogram 下发相似度和细节强度并钳制到官方范围', async () => {
    await expect(endpoint(falIdeogramUpscaleModel)())
      .resolves.toBe('fal-ai/ideogram/upscale')
    expect(falIdeogramUpscaleModel.request?.builder?.({
      images: ['source.jpg'],
      falIdeogramUpscaleResemblance: 150,
      falIdeogramUpscaleDetail: -1,
    })).toEqual({
      image_url: 'source.jpg',
      resemblance: 100,
      detail: 1,
    })
    expect(falIdeogramUpscaleModel.pricing.fixed).toBe(0.06)
  })

  it('所有扩展模型都严格要求一张源图', () => {
    for (const model of [
      falTopazTransparentUpscaleModel,
      falSeedvr2ImageUpscaleModel,
      falBriaCreativeUpscaleModel,
      falIdeogramUpscaleModel,
    ]) {
      expect(() => model.request?.builder?.({ images: [] }))
        .toThrow(/必须且只能提供 1 张源图/)
      expect(model.inputLimits).toEqual({ images: { min: 1, max: 1 }, videos: { max: 0 } })
    }
  })
})
