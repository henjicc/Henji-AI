import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { grsaiGptImage26Model } from '../../src/catalog/grsai/gpt-image-2.6.model'
import { grsaiWan30Model } from '../../src/catalog/grsai/wan-3.0.model'
import { kieFlux3KleinModel } from '../../src/catalog/kie/flux-3-klein.model'
import { kieGemini38FlashLiteTtsModel } from '../../src/catalog/kie/gemini-3.8-flash-lite-tts.model'
import { kieGemini38FlashTtsModel } from '../../src/catalog/kie/gemini-3.8-flash-tts.model'
import { kieGptImage26Model } from '../../src/catalog/kie/gpt-image-2.6.model'
import { kieGrokImagineVideo15Model } from '../../src/catalog/kie/grok-imagine-video-1.5.model'
import { kieKling40FlashModel } from '../../src/catalog/kie/kling-4.0-flash.model'
import { kieKling40Model } from '../../src/catalog/kie/kling-4.0.model'
import { kieWan30PrimeModel } from '../../src/catalog/kie/wan-3.0-prime.model'
import { kieWan30Model } from '../../src/catalog/kie/wan-3.0.model'
import type { ModelRuntimeDefinition } from '../../src/types/model'
import type { JsonObject, JsonValue } from '../../src/types/runtime'

interface Schema { type?: string; enum?: JsonValue[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; minimum?: number; maximum?: number; maxItems?: number; maxLength?: number }

const img = (n: number) => Array.from({ length: n }, (_, i) => `https://example.invalid/${i}.png`)
const vid = (n: number) => Array.from({ length: n }, (_, i) => `https://example.invalid/${i}.mp4`)
const aud = (n: number) => Array.from({ length: n }, (_, i) => `https://example.invalid/${i}.mp3`)
const build = async (model: ModelRuntimeDefinition, params: JsonObject) => await model.request!.builder!({ prompt: 'A cat on a sunny windowsill', ...params }) as JsonObject

function schemaOf(name: string): Schema {
  return JSON.parse(readFileSync(resolve(__dirname, '../fixtures/model-requests-2026-11', `${name}.json`), 'utf8')).requestSchema
}

/** 按官方请求 schema 检查字段名、枚举、范围、数量与必填，发现 builder 发出文档未定义或越界的值。 */
function violations(schema: Schema, value: JsonValue, path = '$'): string[] {
  const problems: string[] = []
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path} 不在枚举内：${JSON.stringify(value)}`)
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} 小于下限`)
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} 大于上限`)
    if (schema.type === 'string') problems.push(`${path} 应为字符串`)
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${path} 超长`)
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path} 超过 ${schema.maxItems} 项`)
    value.forEach((item, index) => { if (schema.items) problems.push(...violations(schema.items, item, `${path}[${index}]`)) })
  } else if (value && typeof value === 'object' && schema.properties) {
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties[key]
      if (!childSchema) problems.push(`${path}.${key} 不是官方字段`)
      else problems.push(...violations(childSchema, child as JsonValue, `${path}.${key}`))
    }
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key} 缺少必填`)
  }
  return problems
}

// 每个场景：模型、参数、应命中的官方端点 fixture。
const scenarios: Array<[string, ModelRuntimeDefinition, JsonObject, string]> = [
  ['GPT 2.6 Flare 文生图', kieGptImage26Model, { kieGpt26AspectRatio: '3:1', kieGpt26Resolution: '4K', kieGpt26Quality: 'max' }, 'kie-gpt-image-2.6-flare-t2i'],
  ['GPT 2.6 Sunburst 局部重绘', kieGptImage26Model, { kieGpt26Variant: 'sunburst', images: img(2), kieGpt26Mask: ['https://example.invalid/mask.png'] }, 'kie-gpt-image-2.6-sunburst-i2i'],
  ['GPT 2.6 Economy 文生图', kieGptImage26Model, { kieGpt26Variant: 'economy', kieGpt26AspectRatio: '21:9', kieGpt26Mask: ['https://example.invalid/mask.png'] }, 'kie-gpt-image-2.6-economy-t2i'],
  ['GPT 2.6 Economy 编辑', kieGptImage26Model, { kieGpt26Variant: 'economy', images: img(3) }, 'kie-gpt-image-2.6-economy-i2i'],
  ['Kling 4.0 文生视频', kieKling40Model, { kieKling40Duration: '30', kieKling40Resolution: '1080p' }, 'kie-kling-4.0-keyframe'],
  ['Kling 4.0 多关键帧', kieKling40Model, { images: img(4), kieKling40Duration: '5' }, 'kie-kling-4.0-keyframe'],
  ['Kling 4.0 参考生视频', kieKling40Model, { kieKling40Mode: 'reference-to-video', images: img(10), videos: vid(5), kieKling40KeepOriginalSound: true }, 'kie-kling-4.0-reference'],
  ['Kling 4.0 Flash 首帧', kieKling40FlashModel, { images: img(1), kieKling40FlashDuration: '20' }, 'kie-kling-4.0-flash-keyframe'],
  ['Kling 4.0 Flash 参考', kieKling40FlashModel, { kieKling40FlashMode: 'reference-to-video', videos: vid(1) }, 'kie-kling-4.0-flash-reference'],
  ['Wan 3.0 首尾帧', kieWan30Model, { images: img(2), kieWan30Resolution: '1080p', kieWan30Duration: '30' }, 'kie-wan-3.0'],
  ['Wan 3.0 Prime 参考', kieWan30PrimeModel, { kieWan30PrimeMode: 'reference-to-video', images: img(10), videos: vid(5), audios: aud(5), kieWan30PrimeAudio: false }, 'kie-wan-3.0-prime'],
  ['Grok Video 1.5', kieGrokImagineVideo15Model, { images: img(1), kieGrokVideo15Resolution: '720p', kieGrokVideo15Duration: 15 }, 'kie-grok-imagine-video-1.5'],
  ['FLUX 3 Klein 文生图', kieFlux3KleinModel, { kieFlux3KleinAspectRatio: '9:21', kieFlux3KleinResolution: '4K', kieFlux3KleinCount: 4 }, 'kie-flux-3-klein-t2i'],
  ['FLUX 3 Klein 编辑', kieFlux3KleinModel, { images: img(10), kieFlux3KleinEnhancePrompt: false }, 'kie-flux-3-klein-edit'],
  ['Gemini 3.8 Flash TTS', kieGemini38FlashTtsModel, { kieGemini38TtsVoice: 'Zuri', kieGemini38TtsStyle: 'calm and slow' }, 'kie-gemini-3.8-flash-tts'],
  ['Gemini 3.8 Flash-Lite TTS', kieGemini38FlashLiteTtsModel, {}, 'kie-gemini-3.8-flash-lite-tts'],
  ['Grsai GPT 2.6', grsaiGptImage26Model, { images: img(2) }, 'grsai-gpt-image'],
  ['Grsai Wan 3.0 首尾帧', grsaiWan30Model, { images: img(2), grsaiWan30Duration: '30' }, 'grsai-wan-video'],
  ['Grsai Wan 3.0 参考', grsaiWan30Model, { grsaiWan30Mode: 'reference-to-video', images: img(10), audios: aud(5) }, 'grsai-wan-video'],
]

describe('2026-11 KIE / Grsai 新模型请求契约', () => {
  it.each(scenarios)('%s 只发送官方定义的字段与取值', async (_name, model, params, fixture) => {
    const body = await build(model, params)
    // Grsai 的 replyType 由 provider 在发送边界统一补成 async。
    expect(violations(schemaOf(fixture), model.meta.provider === 'grsai' ? { ...body, replyType: 'async' } : body)).toEqual([])
  })

  it('GPT 2.6 Economy 不发送 Token 档专属字段，局部重绘只在有参考图时生效', async () => {
    const economy = (await build(kieGptImage26Model, { kieGpt26Variant: 'economy', images: img(1), kieGpt26Mask: ['https://example.invalid/m.png'] })).input as JsonObject
    expect(economy).not.toHaveProperty('resolution')
    expect(economy).not.toHaveProperty('mask_url')
    await expect(build(kieGptImage26Model, { kieGpt26Mask: ['https://example.invalid/m.png'] })).rejects.toThrow('参考图')
  })

  it('Kling 4.0 按首帧、中间帧、尾帧顺序映射，并按时长限制总帧数', async () => {
    const input = (await build(kieKling40Model, { images: img(4) })).input as JsonObject
    expect(input).toMatchObject({ first_frame_url: img(4)[0], keyframe_urls: img(4).slice(1, 3), last_frame_url: img(4)[3] })
    expect(input).not.toHaveProperty('aspect_ratio')
    await expect(build(kieKling40Model, { images: img(5), kieKling40Duration: '3' })).rejects.toThrow('关键帧')
    await expect(build(kieKling40FlashModel, { images: img(2) })).rejects.toThrow('关键帧')
    // 比例不发送时界面也不显示，参考模式照常显示。
    const ratioVisible = (params: JsonObject) => {
      const visible = kieKling40Model.params.find(param => param.id === 'kieKling40AspectRatio')?.visible
      return typeof visible?.condition === 'function' ? visible.condition(params) : true
    }
    expect(ratioVisible({ images: img(1) })).toBe(false)
    expect(ratioVisible({})).toBe(true)
    expect(ratioVisible({ kieKling40Mode: 'reference-to-video', images: img(1) })).toBe(true)
  })

  it('Wan 3.0 首尾帧与参考素材按模式互斥发送', async () => {
    const frames = (await build(kieWan30Model, { images: img(2), audios: aud(1) })).input as JsonObject
    expect(frames).not.toHaveProperty('reference_audio_urls')
    const grsai = await build(grsaiWan30Model, { grsaiWan30Mode: 'reference-to-video', images: img(1) })
    expect(grsai).not.toHaveProperty('firstFrame')
    expect(grsai.images).toEqual(img(1))
    // Grsai 接口拒绝 2 秒（文档写 2–30），不能按文档改回 2。
    expect((await build(grsaiWan30Model, { grsaiWan30Duration: '2' })).duration).toBe(3)
  })

  it('价格按官方计费维度计算', () => {
    const price = (model: ModelRuntimeDefinition, params: JsonObject) => model.pricing.calculator!(params)
    expect(price(kieKling40Model, { kieKling40Resolution: '1080p', kieKling40Duration: '10' })).toBeCloseTo(2.125)
    // 带视频输入时按输入加输出计费，至少为输出的 2 倍（视频时长未知按 5 秒估）。
    expect(price(kieKling40Model, { kieKling40Mode: 'reference-to-video', videos: vid(1), kieKling40Duration: '10' })).toBeCloseTo(1.7)
    expect(price(kieWan30PrimeModel, { kieWan30PrimeResolution: '480p', kieWan30PrimeDuration: '10' })).toBeCloseTo(0.612)
    expect(price(grsaiWan30Model, { grsaiWan30Resolution: '1080p', grsaiWan30Duration: '10' })).toBeCloseTo(13.2)
    expect(price(kieFlux3KleinModel, { kieFlux3KleinResolution: '2K', kieFlux3KleinCount: 2 })).toBeCloseTo(0.025)
    expect(price(kieGptImage26Model, { kieGpt26Variant: 'economy' })).toBeCloseTo(0.025)
    // Gemini 3.8 TTS 按原价（Google 2027 年起价格的七折）估上限：输入 8192、输出 16384 Token。
    expect(price(kieGemini38FlashTtsModel, {})).toBeCloseTo((8192 * 0.7 + 16384 * 12.6) / 1_000_000, 6)
    expect(price(kieGemini38FlashLiteTtsModel, {})).toBeCloseTo((8192 * 0.7 + 16384 * 8.4) / 1_000_000, 6)
  })
})
