import { describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { mergeModelAliasParamDefaults } from '@/core/params/modelAliasDefaults'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'
import { bailianQwenImage21Model as runtime } from '../../src/catalog/bailian/qwen-image-2.1.model'

const model = composeModelDefinition(runtime, modelPresentations[runtime.meta.id])
const build = (params: Record<string, unknown>) => model.request!.builder!(params as never) as {
  model: string
  input: { messages: { role: string, content: { image?: string, text?: string }[] }[] }
  parameters: Record<string, unknown>
}

describe('百炼 Qwen Image 2.1', () => {
  it('走同步多模态端点，版本是主选择器，画布按比例与分辨率两个标量参数渲染', () => {
    expect(model.endpoints).toBe('/api/v1/services/aigc/multimodal-generation/generation')
    expect(model.params.find((param) => param.id === 'bailianQwenImage21Variant')?.role).toBe('mode')
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBe('bailianQwenImage21AspectRatio')
    expect(spec?.resolutionParam?.id).toBe('bailianQwenImage21Resolution')
  })

  it('默认 Pro，发出智能比例换算后的 1K 方图单张请求，不发官方不支持或项目不暴露的字段', () => {
    const request = build({ prompt: 'cat' })
    expect(request).toMatchObject({
      model: 'qwen-image-2.1-pro',
      input: { messages: [{ role: 'user', content: [{ text: 'cat' }] }] },
      parameters: {
        n: 1, size: '1024*1024', prompt_extend: true, prompt_extend_mode: 'direct',
        enable_thinking: false, watermark: false,
      },
    })
    for (const field of ['negative_prompt', 'seed', 'output_format', 'background']) {
      expect(request.parameters).not.toHaveProperty(field)
    }
  })

  it('Turbo 只换 model 字段，其余请求结构与 Pro 相同', () => {
    const params = { prompt: 'p', uploadedFilePaths: ['a.png'], bailianQwenImage21Resolution: '2K', bailianQwenImage21Count: 2 }
    const pro = build(params)
    const turbo = build({ ...params, bailianQwenImage21Variant: 'turbo' })
    expect(turbo.model).toBe('qwen-image-2.1-turbo')
    expect({ ...turbo, model: pro.model }).toEqual(pro)
  })

  it('图像编辑最多带 10 张参考图，文本放在最后，数量限制在 1–6', () => {
    const files = Array.from({ length: 12 }, (_, index) => `${index}.png`)
    const request = build({
      prompt: 'edit', uploadedFilePaths: files,
      bailianQwenImage21AspectRatio: '16:9', bailianQwenImage21Resolution: '2K', bailianQwenImage21Count: 9,
    })
    const content = request.input.messages[0].content
    expect(content).toHaveLength(11)
    expect(content[0]).toEqual({ image: '0.png' })
    expect(content[10]).toEqual({ text: 'edit' })
    expect(request.parameters).toMatchObject({ n: 6, size: '2728*1536' })
    expect(build({ prompt: 'x', bailianQwenImage21Count: 0 }).parameters.n).toBe(1)
  })

  it('画布节点读取 images、面板读取 uploadedImages，智能比例跟随首图比例', () => {
    const request = build({ prompt: 'x', uploadedFilePaths: [], images: ['a.png', ''], __firstImageRatio: 9 / 16 })
    expect(request.input.messages[0].content).toEqual([{ image: 'a.png' }, { text: 'x' }])
    expect(request.parameters.size).toBe('768*1360')
    expect(build({ prompt: 'p', uploadedImages: ['https://cdn/a.png'] }).input.messages[0].content[0]).toEqual({ image: 'https://cdn/a.png' })
  })

  it('2K 各比例总像素都不超过官方上限 2048²', () => {
    for (const ratio of ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']) {
      const [width, height] = String(build({ prompt: 'p', bailianQwenImage21AspectRatio: ratio, bailianQwenImage21Resolution: '2K' }).parameters.size).split('*').map(Number)
      expect(width * height).toBeLessThanOrEqual(2048 * 2048)
    }
  })

  it('按版本与生成张数计价，1K/2K 同价且输入图不计费', () => {
    expect(model.pricing.calculator?.({})).toBeCloseTo(0.25)
    expect(model.pricing.calculator?.({
      bailianQwenImage21Count: 3, bailianQwenImage21Resolution: '2K', uploadedFilePaths: ['a.png', 'b.png'],
    })).toBeCloseTo(0.75)
    expect(model.pricing.calculator?.({ bailianQwenImage21Variant: 'turbo', bailianQwenImage21Count: 3, images: ['a.png'] })).toBeCloseTo(0.3)
  })

  it('旧入口 bailian-qwen-image-2.1-pro 解析为 Pro，并把旧参数 ID 迁到当前参数', () => {
    expect(runtime.meta.aliases).toContain('bailian-qwen-image-2.1-pro')
    const params = mergeModelAliasParamDefaults('bailian-qwen-image-2.1-pro', model, {
      prompt: 'p', bailianQwenImage21ProAspectRatio: '3:4', bailianQwenImage21ProResolution: '2K', bailianQwenImage21ProCount: 2,
    })
    expect(params).toMatchObject({
      bailianQwenImage21Variant: 'pro', bailianQwenImage21AspectRatio: '3:4',
      bailianQwenImage21Resolution: '2K', bailianQwenImage21Count: 2,
    })
    const request = build(params)
    expect(request.model).toBe('qwen-image-2.1-pro')
    expect(request.parameters).toMatchObject({ n: 2, size: '1768*2360' })
  })
})
