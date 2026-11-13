import { describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { evaluateCondition } from '@/core/validation/conditionEvaluator'
import { modelPresentations } from '@/models/presentation'
import { volcengineSeedream55Model as runtime } from '../../src/catalog/volcengine/seedream-5.5.model'

const model = composeModelDefinition(runtime, modelPresentations[runtime.meta.id])
const build = (params: Record<string, unknown>) => model.request!.builder!(params as never) as Record<string, unknown>
const price = (params: Record<string, unknown>) => model.pricing.calculator!(params as never) as number
const visible = (id: string, params: Record<string, unknown>) =>
  evaluateCondition(model.params.find((param) => param.id === id)?.visible?.condition, params as never)

describe('火山方舟 Seedream 5.5', () => {
  it('默认生成模式发 2K 方图、背景 auto，不发水印与项目不暴露的字段', () => {
    const request = build({ prompt: 'cat' })
    expect(request).toEqual({
      model: 'doubao-seedream-5-5-261028',
      prompt: 'cat',
      size: '2048x2048',
      background: 'auto',
      response_format: 'url',
      watermark: false,
    })
    expect(model.params.find((param) => param.id === 'volcengineSeedream55Mode')?.role).toBe('mode')
  })

  it('文生图可直接选透明背景；参考图从三种上传字段读取，最多 10 张', () => {
    expect(build({ prompt: 'logo', volcengineSeedream55Background: 'transparent', volcengineSeedream55Resolution: '1K' }))
      .toMatchObject({ size: '1024x1024', background: 'transparent' })
    expect(build({ prompt: 'p', uploadedFilePaths: ['a.png'] }).image).toEqual(['a.png'])
    expect(build({ prompt: 'p', images: ['b.png'] }).image).toEqual(['b.png'])
    expect(build({ prompt: 'p', uploadedImages: ['c.png'], __firstImageRatio: 16 / 9 }))
      .toMatchObject({ image: ['c.png'], size: '2736x1536' })
    expect(() => build({ prompt: 'p', uploadedFilePaths: Array.from({ length: 11 }, (_, index) => `${index}.png`) }))
      .toThrow('最多接受 10 张图片')
  })

  it('图层拆分只发拆分字段，把层数限制在图层结果契约能接收的底图加 16 层', () => {
    const params = { prompt: 'split', uploadedFilePaths: ['source.png'], volcengineSeedream55Mode: 'layer-decomposition' }
    expect(build(params)).toEqual({
      model: 'doubao-seedream-5-5-261028',
      prompt: 'split',
      image: 'source.png',
      layer_decomposition: true,
      size: 'auto',
      layer_decomposition_options: { max_images: 17 },
      response_format: 'url',
      watermark: false,
    })
    expect(() => build({ ...params, uploadedFilePaths: ['a.png', 'b.png'] })).toThrow('必须且只能输入 1 张图片')
    expect(visible('volcengineSeedream55Background', params)).toBe(false)
    expect(visible('volcengineSeedream55LayerSize', params)).toBe(true)
    expect(visible('volcengineSeedream55LayerSize', {})).toBe(false)
  })

  it('按单张输出像素分档计价，输入图每张 ¥0.05 无首张免费；图层拆分提交前不估价', () => {
    expect(price({})).toBeCloseTo(0.23)
    expect(price({ volcengineSeedream55Resolution: '1K' })).toBeCloseTo(0.13)
    expect(price({ volcengineSeedream55Resolution: '1.5K', volcengineSeedream55AspectRatio: '21:9' })).toBeCloseTo(0.13)
    expect(price({ volcengineSeedream55Resolution: '2K', uploadedImages: ['a.png', 'b.png'] })).toBeCloseTo(0.33)
    expect(price({ volcengineSeedream55Resolution: '1K', images: ['a.png'] })).toBeCloseTo(0.18)
    expect(Number.isNaN(price({ volcengineSeedream55Mode: 'layer-decomposition', uploadedFilePaths: ['a.png'] }))).toBe(true)
  })
})
