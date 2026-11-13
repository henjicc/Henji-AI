import { describe, expect, it } from 'vitest'

import { falSeedream55Model } from '../../src/catalog/fal/seedream-5.5.model'
import type { JsonObject } from '../../src/types/runtime'
import { expectFalOfficialBody } from './falOfficialInput'

const selector = (falSeedream55Model.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector
const build = (params: JsonObject) => falSeedream55Model.request.builder(params) as JsonObject
const price = (params: JsonObject) => falSeedream55Model.pricing.calculator!(params)
const defaults = Object.fromEntries(falSeedream55Model.params.map((param) => [param.id, param.default])) as JsonObject

async function route(params: JsonObject): Promise<{ endpoint: string; body: JsonObject }> {
  const endpoint = await selector(params)
  const body = build(params)
  expectFalOfficialBody(endpoint, body)
  return { endpoint, body }
}

describe('Fal Seedream 5.5', () => {
  it('默认文生图：智能比例无图按 1:1 换成 2K 具体宽高，背景自动，不发输出格式与水印', async () => {
    const { endpoint, body } = await route({ ...defaults, prompt: '一只猫' })
    expect(endpoint).toBe('bytedance/seedream/v5.5/text-to-image')
    expect(body).toEqual({ prompt: '一只猫', image_size: { width: 2048, height: 2048 }, num_images: 1, background: 'auto' })
    expect(price({ ...defaults })).toBeCloseTo(0.0405)
  })

  it('上传图片自动走编辑，智能比例取首图最接近的比例；价格按每张输出 × 每张输入图另计', async () => {
    const params = {
      ...defaults, prompt: '换成夜景', falSeedream55Resolution: '1.5K', falSeedream55NumImages: 3,
      falSeedream55Background: 'transparent', uploadedFilePaths: ['https://cdn/a.png', 'https://cdn/b.png'], __firstImageRatio: 0.75,
    }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('bytedance/seedream/v5.5/edit')
    expect(body).toMatchObject({ image_urls: ['https://cdn/a.png', 'https://cdn/b.png'], num_images: 3, background: 'transparent' })
    const size = body.image_size as { width: number; height: number }
    expect(size.width / size.height).toBeCloseTo(3 / 4, 1)
    expect(price(params)).toBeCloseTo(3 * (0.03 + 2 * 0.012))
  })

  it('所有比例与档位换算出的尺寸都落在官方总像素范围内，1K/1.5K 落在低价档', () => {
    const ratios = (falSeedream55Model.params.find((param) => param.id === 'falSeedream55AspectRatio') as { options: Array<{ value: string }> }).options
    for (const resolution of ['1K', '1.5K', '2K']) {
      for (const { value } of ratios) {
        const { width, height } = build({ ...defaults, falSeedream55AspectRatio: value, falSeedream55Resolution: resolution }).image_size as { width: number; height: number }
        expect(width * height).toBeGreaterThanOrEqual(921_600)
        expect(width * height).toBeLessThanOrEqual(resolution === '2K' ? 4_624_220 : 2_610_000)
      }
    }
  })

  it('图层拆分走 layerize，只收 1 张图，按结果契约上限请求层数，提交前不估总价', async () => {
    const params = { ...defaults, falSeedream55Mode: 'layer-decomposition', falSeedream55LayerSize: '2K', images: ['https://cdn/poster.png'], prompt: '拆出标题' }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('bytedance/seedream/v5.5/layerize')
    expect(body).toEqual({ prompt: '拆出标题', image_url: 'https://cdn/poster.png', image_size: 'auto_2K', max_images: 17 })
    expect(build({ ...params, falSeedream55LayerSize: 'auto' }).image_size).toBe('auto')
    expect(() => build({ ...params, images: ['a.png', 'b.png'] })).toThrow('必须且只能输入 1 张图片')
    expect(price(params)).toBeNaN()
  })
})
