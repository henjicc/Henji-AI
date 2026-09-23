import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import happyhorse from '../../src/catalog/kie/happyhorse-1.1.model'
import flash from '../../src/catalog/volcengine/seedream-5.0-flash.model'
import { catalogIndex } from '../../src/catalog'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import type { JsonObject } from '../../src/types/runtime'

describe('2026-09 新增图片与视频模型官方契约', () => {
  it.each(['t2v', 'i2v', 'r2v'])('HappyHorse %s 请求与官方字面样本一致', mode => {
    const fixture = JSON.parse(readFileSync(new URL(`../fixtures/kie/happyhorse-1.1-${mode}.json`, import.meta.url), 'utf8')) as { examples: Array<{ path: string; value: { model: string; input: JsonObject } }> }
    const expected = fixture.examples.find(item => item.path === 'operation.requestBody.content.application/json.example')!.value
    expect(happyhorse.request!.builder!({
      prompt: expected.input.prompt,
      images: expected.input.image_urls ?? expected.input.reference_image ?? [],
      kieHappyHorse11Mode: mode === 'r2v' ? 'reference-to-video' : 'text-image-to-video',
    })).toEqual(expected)
  })

  it('图片模式限制、字段互斥和秒级价格覆盖端点差异', () => {
    const build = happyhorse.request!.builder!
    expect(build({ images: ['https://media.invalid/1.png'] })).toEqual({ model: 'happyhorse-1-1/image-to-video', input: { image_urls: ['https://media.invalid/1.png'], duration: 5, resolution: '1080p' } })
    expect(() => build({ prompt: 'x', images: ['a', 'b'] })).toThrow('1 张')
    expect(() => build({ prompt: 'x', kieHappyHorse11Mode: 'reference-to-video' })).toThrow('1–9')
    expect(() => build({ prompt: 'x', kieHappyHorse11Mode: 'reference-to-video', images: Array(10).fill('a') })).toThrow('1–9')
    for (const value of [2, 16, 3.5, Number.NaN]) expect(() => build({ prompt: 'x', kieHappyHorse11Duration: value })).toThrow('整数')
    expect(() => build({ prompt: 'x'.repeat(5000) })).toThrow('长度')
    expect(happyhorse.pricing!.calculator!({ kieHappyHorse11Duration: 15, kieHappyHorse11Resolution: '720p' })).toBeCloseTo(1.6875)
    expect(happyhorse.pricing!.calculator!({})).toBeCloseTo(0.725)
  })

  it('Flash 路由、拆分单图和不可预知层数的价格不混入 Pro', () => {
    const build = flash.request!.builder!
    expect(build({ prompt: 'test' })).toMatchObject({ model: 'doubao-seedream-5-0-flash-260915', size: '2048x2048' })
    const params = { volcengineSeedream50FlashMode: 'layer-decomposition', images: ['https://media.invalid/image.png'] }
    expect(build(params)).toEqual({ model: 'doubao-seedream-5-0-flash-260915', prompt: '', image: params.images[0], layer_decomposition: true, size: 'auto', response_format: 'url', watermark: false })
    expect(() => build({ ...params, images: [] })).toThrow('1 张')
    expect(() => build({ images: Array(11).fill('image') })).toThrow('10 张')
    expect(flash.pricing!.calculator!({ images: Array(10).fill('image') })).toBe(0.12)
    expect(flash.pricing!.calculator!(params)).toBeNaN()
  })

  it.each([flash, happyhorse])('$meta.id 从正式目录组合界面参数与助手可发现 schema', model => {
    expect(catalogIndex.get(model.meta.id)).toBe(model)
    const composed = composeModelDefinition(model, modelPresentations[model.meta.id])
    expect(composed.params.every(param => Boolean(param.name))).toBe(true)
    expect(analyzeRatioResolutionParams(composed.params, [])?.aspectParam?.id).toBeTruthy()
  })
})
