import { describe, expect, it } from 'vitest'

import { falIcLightV2Model } from '../../src/catalog/fal/ic-light-v2.model'

describe('Fal IC-Light v2 catalog', () => {
  it('固定使用官方端点与单图输入契约', async () => {
    const selector = falIcLightV2Model.endpoints as { selector: () => Promise<string> }
    expect(await selector.selector()).toBe('fal-ai/iclight-v2')
    expect(falIcLightV2Model.inputLimits).toEqual({
      images: { min: 1, max: 1 },
      videos: { max: 0 },
    })
  })

  it('发送首版冻结字段且不暴露未采用的高级参数', () => {
    expect(falIcLightV2Model.request?.builder?.({
      prompt: 'soft warm key light',
      images: ['source.png'],
      __firstImageRatio: 16 / 9,
      falIcLightV2InitialLatent: 'Left',
    })).toEqual({
      prompt: 'soft warm key light',
      image_url: 'source.png',
      initial_latent: 'Left',
      image_size: { width: 1376, height: 768 },
      num_images: 1,
      num_inference_steps: 28,
      cfg_scale: 1,
      guidance_scale: 5,
      lowres_denoise: 0.98,
      highres_denoise: 0.95,
      highres_scale: 0.5,
      enable_hr_fix: false,
      enable_safety_checker: true,
    })
    expect(falIcLightV2Model.params.map((param) => param.id)).toEqual([
      'falIcLightV2InitialLatent',
    ])
  })

  it('拒绝缺少源图或多张源图，并把非法方向降为 None', () => {
    expect(() => falIcLightV2Model.request?.builder?.({ prompt: 'test' }))
      .toThrow(/必须且只能提供 1 张源图/)
    expect(() => falIcLightV2Model.request?.builder?.({
      prompt: 'test',
      images: ['a.png', 'b.png'],
    })).toThrow(/必须且只能提供 1 张源图/)
    expect(falIcLightV2Model.request?.builder?.({
      prompt: 'test',
      images: ['a.png'],
      falIcLightV2InitialLatent: '45deg',
    })).toMatchObject({ initial_latent: 'None' })
  })

  it('按 Fal 官方百万像素单价保守估算首版费用', () => {
    expect(falIcLightV2Model.pricing.calculator?.({})).toBe(0.1)
    expect(falIcLightV2Model.pricing.description).toContain('$0.10/百万像素')
  })
})
