import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { officialSchemaProblems, type JsonSchema } from '@/features/developer/officialSchemaTesting'
import { kieSeedream55Model } from '../../src/catalog/kie/seedream-5.5.model'
import type { JsonObject } from '../../src/types/runtime'

const build = (params: JsonObject) => kieSeedream55Model.request.builder(params) as { model: string; input: JsonObject }
const price = (params: JsonObject) => kieSeedream55Model.pricing.calculator!(params)
const defaults = Object.fromEntries(kieSeedream55Model.params.map((param) => [param.id, param.default])) as JsonObject
const visible = (id: string, params: JsonObject) => {
  const condition = kieSeedream55Model.params.find((param) => param.id === id)?.visible?.condition
  return typeof condition === 'function' ? condition(params) : true
}

/** 按 KIE 官方 OpenAPI 快照核对整份请求体。 */
function expectOfficial(body: { model: string; input: JsonObject }): void {
  const file = resolve(__dirname, `../fixtures/kie-openapi/${body.model.replace(/[/:]/g, '__')}.json`)
  const schema = (JSON.parse(readFileSync(file, 'utf8')) as { body: JsonSchema }).body
  expect(officialSchemaProblems(body.model, schema, [{ modelId: 'kie-seedream-5.5', label: body.model, body }], ['input'])).toEqual([])
}

describe('KIE Seedream 5.5', () => {
  it('默认文生图：2K、自动背景，智能比例无图时取 1:1，不发 output_format', () => {
    const body = build({ ...defaults, prompt: '玻璃精华瓶商品图' })
    expectOfficial(body)
    expect(body).toEqual({
      model: 'seedream/5-5-text-to-image',
      input: { prompt: '玻璃精华瓶商品图', aspect_ratio: '1:1', size: '2K', background: 'auto' },
    })
    expect(price({ ...defaults })).toBeCloseTo(0.0315)
    expect(price({ ...defaults, kieSeedream55Resolution: '1.5K' })).toBeCloseTo(0.018)
  })

  it('上传图片自动走图生图：智能比例跟随第一张图，每张输入图另计 1.44 credits', () => {
    const params = { ...defaults, prompt: '把衣服换成透明的水', kieSeedream55Background: 'transparent', kieSeedream55Resolution: '1K', images: ['https://cdn/a.png', 'https://cdn/b.png'], __firstImageRatio: 1.7 }
    const body = build(params)
    expectOfficial(body)
    expect(body.model).toBe('seedream/5-5-image-to-image')
    expect(body.input).toMatchObject({ aspect_ratio: '16:9', size: '1K', background: 'transparent', image_urls: ['https://cdn/a.png', 'https://cdn/b.png'] })
    expect(price(params)).toBeCloseTo(0.018 + 2 * 0.0072)
    expect(price({ ...defaults, uploadedImages: ['a'] })).toBeCloseTo(0.0315 + 0.0072)
  })

  it('图层拆分只发拆分字段，按结果契约上限请求 17 张，提交前不给总价', () => {
    const params = { ...defaults, prompt: '', kieSeedream55Mode: 'layer-decomposition', kieSeedream55LayerSize: '1.5K', uploadedFilePaths: ['https://cdn/poster.png'] }
    const body = build(params)
    expectOfficial(body)
    expect(body).toEqual({
      model: 'seedream/5-5-layer-decomposition',
      input: { prompt: '', image_url: 'https://cdn/poster.png', size: '1.5K', max_images: 17 },
    })
    expect(price(params)).toBeNaN()
    for (const id of ['kieSeedream55AspectRatio', 'kieSeedream55Resolution', 'kieSeedream55Background']) expect(visible(id, params)).toBe(false)
    expect(visible('kieSeedream55LayerSize', params)).toBe(true)
    expect(visible('kieSeedream55LayerSize', defaults)).toBe(false)
    expect(() => build({ ...params, uploadedFilePaths: [] })).toThrow('必须且只能输入 1 张图片')
  })

  it('有参考图但读不到首图比例时交给图生图端点的 auto，不按 1:1 裁掉画面', () => {
    const body = build({ ...defaults, prompt: '换成夜景灯光', uploadedFilePaths: ['https://cdn/a.png'] })
    expectOfficial(body)
    expect(body.input.aspect_ratio).toBe('auto')
  })

  it('生成提示词少于 5 个字符时拒绝提交', () => {
    expect(() => build({ ...defaults, prompt: '猫' })).toThrow('5–5000')
  })
})
