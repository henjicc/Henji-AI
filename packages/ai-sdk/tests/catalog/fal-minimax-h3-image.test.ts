import { describe, expect, it } from 'vitest'

import { falMiniMaxH3ImageModel } from '../../src/catalog/fal/minimax-h3-image.model'
import type { JsonObject } from '../../src/types/runtime'
import { expectFalOfficialBody } from './falOfficialInput'

const selector = (falMiniMaxH3ImageModel.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector
const build = (params: JsonObject) => falMiniMaxH3ImageModel.request.builder(params) as JsonObject
const price = (params: JsonObject) => falMiniMaxH3ImageModel.pricing.calculator!(params)
const defaults = Object.fromEntries(falMiniMaxH3ImageModel.params.map((param) => [param.id, param.default])) as JsonObject

async function route(params: JsonObject): Promise<{ endpoint: string; body: JsonObject }> {
  const endpoint = await selector(params)
  const body = build(params)
  expectFalOfficialBody(endpoint, body)
  return { endpoint, body }
}

describe('Fal MiniMax H3 Image', () => {
  it('默认标准版文生图：2K 方图、发扩写开关，按输出 token 与扩写文本估价', async () => {
    const { endpoint, body } = await route({ ...defaults, prompt: '海边小屋' })
    expect(endpoint).toBe('minimax/h3-image/text-to-image')
    expect(body).toEqual({ prompt: '海边小屋', image_size: { width: 2048, height: 2048 }, num_images: 1, enable_prompt_expansion: true })
    expect(price({ ...defaults })).toBeCloseTo((4096 * 3.8 + 4000 * 2.3) / 1e6)
    const plain = { ...defaults, prompt: '海边小屋', falMiniMaxH3ImagePromptExpansion: false }
    expect(build(plain).enable_prompt_expansion).toBe(false)
    expect(price(plain)).toBeLessThan(price({ ...defaults }))
  })

  it('上传图片自动走编辑，不发扩写开关；Highspeed 只换端点并按翻倍单价估', async () => {
    const params = { ...defaults, prompt: '给 Image 1 戴上围巾', falMiniMaxH3ImageVersion: 'highspeed', falMiniMaxH3ImageAspectRatio: '16:9', falMiniMaxH3ImageNumImages: 2, images: ['https://cdn/dog.png'] }
    const { endpoint, body } = await route(params)
    expect(endpoint).toBe('minimax/h3-image/highspeed/edit')
    expect(body).not.toHaveProperty('enable_prompt_expansion')
    expect(body).toMatchObject({ image_urls: ['https://cdn/dog.png'], num_images: 2 })
    await expect(selector({ ...params, falMiniMaxH3ImageVersion: 'standard' })).resolves.toBe('minimax/h3-image/edit')
    await expect(selector({ ...defaults, falMiniMaxH3ImageVersion: 'highspeed' })).resolves.toBe('minimax/h3-image/highspeed/text-to-image')
    const standard = price({ ...params, falMiniMaxH3ImageVersion: 'standard' })
    expect(price(params)).toBeGreaterThan(standard)
  })

  it('所有比例与档位的尺寸都在官方面积、比例与单边范围内', () => {
    const ratios = (falMiniMaxH3ImageModel.params.find((param) => param.id === 'falMiniMaxH3ImageAspectRatio') as { options: Array<{ value: string }> }).options
    for (const resolution of ['1K', '2K', '4K']) {
      for (const { value } of ratios) {
        const { width, height } = build({ ...defaults, prompt: 'x', falMiniMaxH3ImageAspectRatio: value, falMiniMaxH3ImageResolution: resolution }).image_size as { width: number; height: number }
        expect(width * height).toBeGreaterThanOrEqual(655_360)
        expect(width * height).toBeLessThanOrEqual(20_000_000)
        expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3)
        expect(Math.min(width, height)).toBeGreaterThanOrEqual(468)
        expect(Math.max(width, height)).toBeLessThanOrEqual(7745)
      }
    }
  })

  it('提示词为空时拒绝提交', () => {
    expect(() => build({ ...defaults, prompt: '  ' })).toThrow('提示词不能为空')
  })
})
