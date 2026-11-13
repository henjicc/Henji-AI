import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { officialSchemaProblems, type JsonSchema } from '@/features/developer/officialSchemaTesting'
import { kieMiniMaxH3ImageModel } from '../../src/catalog/kie/minimax-h3-image.model'
import type { JsonObject } from '../../src/types/runtime'

const build = (params: JsonObject) => kieMiniMaxH3ImageModel.request.builder(params) as { model: string; input: JsonObject }
const price = (params: JsonObject) => kieMiniMaxH3ImageModel.pricing.calculator!(params)
const defaults = Object.fromEntries(kieMiniMaxH3ImageModel.params.map((param) => [param.id, param.default])) as JsonObject

/** 按 KIE 官方 OpenAPI 快照核对整份请求体。 */
function expectOfficial(body: { model: string; input: JsonObject }): void {
  const file = resolve(__dirname, `../fixtures/kie-openapi/${body.model.replace(/[/:]/g, '__')}.json`)
  const schema = (JSON.parse(readFileSync(file, 'utf8')) as { body: JsonSchema }).body
  expect(officialSchemaProblems(body.model, schema, [{ modelId: 'kie-minimax-h3-image', label: body.model, body }], ['input'])).toEqual([])
}

describe('KIE MiniMax H3 Image', () => {
  it('默认文生图：2K、开扩写，智能比例取 1:1，按 1.8 credits 计价', () => {
    const body = build({ ...defaults, prompt: '海边小屋' })
    expectOfficial(body)
    expect(body).toEqual({
      model: 'minimax-h3/text-to-image',
      input: { prompt: '海边小屋', aspect_ratio: '1:1', resolution: '2K', expand_prompt: true },
    })
    expect(price({ ...defaults })).toBeCloseTo(0.009)
    expect(price({ ...defaults, kieMiniMaxH3ImageResolution: '4K' })).toBeCloseTo(0.0275)
  })

  it('上传图片自动走编辑：智能比例交给官方 auto 跟随第一张图，每张参考图另计 0.5 credit', () => {
    const params = { ...defaults, prompt: '把 <Picture 1> 的产品放到大理石台面上', kieMiniMaxH3ImagePromptExpansion: false, images: ['https://cdn/a.png', 'https://cdn/b.png', 'https://cdn/c.png'] }
    const body = build(params)
    expectOfficial(body)
    expect(body).toEqual({
      model: 'minimax-h3/image-edit',
      input: { prompt: params.prompt, aspect_ratio: 'auto', resolution: '2K', expand_prompt: false, image_urls: params.images },
    })
    expect(build({ ...params, kieMiniMaxH3ImageAspectRatio: '16:9' }).input.aspect_ratio).toBe('16:9')
    expect(price(params)).toBeCloseTo(0.009 + 3 * 0.0025)
    expect(price({ ...defaults, uploadedImages: ['a'] })).toBeCloseTo(0.009 + 0.0025)
  })

  it('提示词为空或超过 5000 字符时拒绝提交', () => {
    expect(() => build({ ...defaults, prompt: '  ' })).toThrow('提示词不能为空')
    expect(() => build({ ...defaults, prompt: 'a'.repeat(5001) })).toThrow('5000')
  })
})
