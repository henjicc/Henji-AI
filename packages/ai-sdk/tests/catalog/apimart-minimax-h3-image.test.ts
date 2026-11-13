import { describe, expect, it } from 'vitest'

import { apimartMiniMaxH3ImageModel } from '../../src/catalog/apimart/minimax-h3-image.model'
import type { JsonObject } from '../../src/types/runtime'

const build = (params: JsonObject) => apimartMiniMaxH3ImageModel.request.builder(params) as JsonObject
const price = (params: JsonObject) => apimartMiniMaxH3ImageModel.pricing.calculator!(params)
const defaults = Object.fromEntries(apimartMiniMaxH3ImageModel.params.map((param) => [param.id, param.default])) as JsonObject
const expansionVisible = (params: JsonObject) => {
  const condition = apimartMiniMaxH3ImageModel.params.find((param) => param.id === 'apimartMiniMaxH3ImagePromptExpansion')?.visible?.condition
  return typeof condition === 'function' ? condition(params) : true
}

describe('APIMart MiniMax H3 Image', () => {
  it('默认标准版文生图：显式发 2K（平台缺省是 4K）、智能比例取 1:1，扩写开启时不发开关', () => {
    expect(build({ ...defaults, prompt: '海边咖啡馆' })).toEqual({ model: 'minimax-h3-image', prompt: '海边咖啡馆', size: '1:1', resolution: '2K', n: 1 })
    expect(apimartMiniMaxH3ImageModel.pricing.billingMode).toBe('estimated')
    expect(price({ ...defaults })).toBeCloseTo(0.0189)
  })

  it('关闭扩写只在文生图发送 prompt_optimizer=false；Highspeed 换模型名并按 2 倍估价', () => {
    const params = { ...defaults, prompt: '红苹果', apimartMiniMaxH3ImagePromptExpansion: false, apimartMiniMaxH3ImageVersion: 'highspeed', apimartMiniMaxH3ImageResolution: '4K', apimartMiniMaxH3ImageCount: 3 }
    expect(build(params)).toEqual({ model: 'minimax-h3-image-highspeed', prompt: '红苹果', size: '1:1', resolution: '4K', n: 3, prompt_optimizer: false })
    expect(price(params)).toBeCloseTo(0.0628 * 2 * 3)
  })

  it('上传图片自动变编辑：发 image_urls，智能比例取最接近第一张图的比例，隐藏且不发扩写开关', () => {
    const params = { ...defaults, prompt: '给人物换上第二张图的外套', apimartMiniMaxH3ImagePromptExpansion: false, uploadedFilePaths: ['https://cdn/p.jpg', 'https://cdn/j.png'], __firstImageRatio: 0.76 }
    const body = build(params)
    expect(body).toEqual({ model: 'minimax-h3-image', prompt: params.prompt, size: '3:4', resolution: '2K', n: 1, image_urls: params.uploadedFilePaths })
    expect(expansionVisible(params)).toBe(false)
    expect(expansionVisible({ ...defaults, images: ['a'] })).toBe(false)
    expect(expansionVisible({ ...defaults, uploadedImages: ['a'] })).toBe(false)
    expect(expansionVisible(defaults)).toBe(true)
  })

  it('编辑时读不到首图比例就发 auto，不按 1:1 裁掉画面', () => {
    expect(build({ ...defaults, prompt: '换背景', uploadedFilePaths: ['https://cdn/a.png'] })).toMatchObject({ size: 'auto' })
  })

  it('提示词为空时拒绝提交', () => {
    expect(() => build({ ...defaults, prompt: ' ' })).toThrow('提示词不能为空')
  })
})
