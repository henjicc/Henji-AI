import { describe, expect, it } from 'vitest'

import { bailianQwenAudio31TtsPlusModel } from '../../src/catalog/bailian/qwen-audio-3.1-tts-plus.model'
import { bailianWan30Model } from '../../src/catalog/bailian/wan-3.0.model'
import { volcengineSeedance20FastModel } from '../../src/catalog/volcengine/seedance-2.0-fast.model'
import { volcengineSeedance20MiniModel } from '../../src/catalog/volcengine/seedance-2.0-mini.model'
import { volcengineSeedance20Model } from '../../src/catalog/volcengine/seedance-2.0.model'
import { volcengineSeedance25Model } from '../../src/catalog/volcengine/seedance-2.5.model'
import type { ModelRuntimeDefinition } from '../../src/types/model'
import type { JsonObject } from '../../src/types/runtime'

const build = (model: ModelRuntimeDefinition, params: JsonObject) => model.request!.builder!(params) as JsonObject
const price = (model: ModelRuntimeDefinition, params: JsonObject) => model.pricing!.calculator!(params)

describe('火山方舟 Seedance 请求构建', () => {
  it.each([volcengineSeedance25Model, volcengineSeedance20Model, volcengineSeedance20FastModel, volcengineSeedance20MiniModel])('$meta.id 用默认参数只写提示词也能构建（默认不落在需要素材的参考模式）', (model) => {
    const defaults = Object.fromEntries(model.params.map((param) => [param.id, param.default ?? null])) as JsonObject
    expect(() => build(model, { ...defaults, prompt: '一只猫在跑' })).not.toThrow()
  })

  it('2.5 首尾帧：两张图分别为 first_frame / last_frame，比例强制 adaptive', () => {
    const body = build(volcengineSeedance25Model, {
      prompt: '日出', uploadedFilePaths: ['a.png', 'b.png'],
      volcengineSeedance25Mode: 'text-image-to-video', volcengineSeedance25AspectRatio: '16:9',
      volcengineSeedance25Resolution: '1080p', volcengineSeedance25Duration: 8,
    })
    expect(body).toEqual({
      model: 'doubao-seedance-2-5-260628',
      content: [
        { type: 'text', text: '日出' },
        { type: 'image_url', image_url: { url: 'a.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'b.png' }, role: 'last_frame' },
      ],
      resolution: '1080p', ratio: 'adaptive', duration: 8,
      generate_audio: true, return_last_frame: false, watermark: false,
    })
  })

  it('2.5 参考生视频：参考图与参考音频，显式 reference 任务，自动时长发 -1', () => {
    const body = build(volcengineSeedance25Model, {
      prompt: '图1 在唱歌', uploadedFilePaths: ['a.png'], uploadedAudioFilePaths: ['v.mp3'],
      volcengineSeedance25AspectRatio: 'smart', volcengineSeedance25AutoDuration: true, volcengineSeedance25WebSearch: true,
    })
    expect(body).toMatchObject({
      omni_reference_task_type: 'reference', ratio: 'adaptive', duration: -1, tools: [{ type: 'web_search' }],
      content: [
        { type: 'text', text: '图1 在唱歌' },
        { type: 'image_url', image_url: { url: 'a.png' }, role: 'reference_image' },
        { type: 'audio_url', audio_url: { url: 'v.mp3' }, role: 'reference_audio' },
      ],
    })
  })

  it('2.0 参考音频必须搭配参考图；2.0 不发 2.5 专属的任务类型', () => {
    expect(() => build(volcengineSeedance20Model, { prompt: 'x', uploadedAudioFilePaths: ['v.mp3'] })).toThrow('参考图片')
    const body = build(volcengineSeedance20Model, { prompt: 'x', uploadedFilePaths: ['a.png'], volcengineSeedance20Resolution: '4k' })
    expect(body).not.toHaveProperty('omni_reference_task_type')
    expect(body).toMatchObject({ model: 'doubao-seedance-2-0-260128', resolution: '4k', duration: 5 })
  })

  it('Fast / Mini 只接受 480p、720p，越界值回到 720p', () => {
    for (const [model, prefix, apiModel] of [
      [volcengineSeedance20FastModel, 'volcengineSeedance20Fast', 'doubao-seedance-2-0-fast-260128'],
      [volcengineSeedance20MiniModel, 'volcengineSeedance20Mini', 'doubao-seedance-2-0-mini-260615'],
    ] as const) {
      expect(build(model, { prompt: 'x', [`${prefix}Mode`]: 'text-image-to-video', [`${prefix}Resolution`]: '1080p' }))
        .toMatchObject({ model: apiModel, resolution: '720p', content: [{ type: 'text', text: 'x' }] })
    }
  })

  it('文生视频没有提示词时提交前拒绝', () => {
    expect(() => build(volcengineSeedance25Model, { prompt: '', volcengineSeedance25Mode: 'text-image-to-video' })).toThrow('提示词')
  })

  it('价格与官方 5 秒 16:9 示例一致', () => {
    expect(price(volcengineSeedance25Model, { volcengineSeedance25Resolution: '720p', volcengineSeedance25Duration: 5 })).toBeCloseTo(7.56, 2)
    expect(price(volcengineSeedance25Model, { volcengineSeedance25Resolution: '1080p', volcengineSeedance25Duration: 5 })).toBeCloseTo(18.71, 2)
    expect(price(volcengineSeedance20Model, { volcengineSeedance20Resolution: '480p', volcengineSeedance20Duration: 5 })).toBeCloseTo(2.31, 2)
    expect(price(volcengineSeedance20Model, { volcengineSeedance20Resolution: '4k', volcengineSeedance20Duration: 5 })).toBeCloseTo(25.27, 2)
    expect(price(volcengineSeedance20FastModel, { volcengineSeedance20FastResolution: '720p', volcengineSeedance20FastDuration: 5 })).toBeCloseTo(4.0, 2)
    expect(price(volcengineSeedance20MiniModel, { volcengineSeedance20MiniResolution: '480p', volcengineSeedance20MiniDuration: 5 })).toBeCloseTo(1.16, 2)
    // 自动时长按 2.5 上限 30 秒预估。
    expect(price(volcengineSeedance25Model, { volcengineSeedance25AutoDuration: true })).toBeCloseTo(7.56 * 6, 1)
  })
})

describe('百炼万相 3.0 请求构建', () => {
  it('Prime 首尾帧：media 用 first_frame / last_frame，始终显式发送分辨率', () => {
    expect(build(bailianWan30Model, {
      prompt: '南瓜裂开', uploadedFilePaths: ['a.png', 'b.png'], bailianWan30Variant: 'prime',
    })).toEqual({
      model: 'wan3.0-video-prime',
      input: { prompt: '南瓜裂开', media: [{ type: 'first_frame', url: 'a.png' }, { type: 'last_frame', url: 'b.png' }] },
      parameters: { resolution: '720P', ratio: 'adaptive', duration: 5, audio: true, watermark: false },
    })
  })

  it('参考生视频最多 10 张参考图，可以不写提示词', () => {
    const images = Array.from({ length: 12 }, (_, index) => `${index}.png`)
    const body = build(bailianWan30Model, { uploadedFilePaths: images, bailianWan30Mode: 'reference-to-video', bailianWan30AspectRatio: '21:9' })
    expect(body.input).toEqual({ media: images.slice(0, 10).map(url => ({ type: 'reference_image', url })) })
    expect(body.parameters).toMatchObject({ ratio: '21:9' })
  })

  it('没有提示词也没有图片时拒绝；首尾帧超过 2 张时拒绝', () => {
    expect(() => build(bailianWan30Model, { prompt: '' })).toThrow('提示词')
    expect(() => build(bailianWan30Model, { prompt: 'x', uploadedFilePaths: ['a', 'b', 'c'] })).toThrow('2 张')
  })

  it('按版本与分辨率逐秒计价（标准版按原价）', () => {
    expect(price(bailianWan30Model, { bailianWan30Resolution: '1080P', bailianWan30Duration: 10 })).toBeCloseTo(12)
    expect(price(bailianWan30Model, { bailianWan30Variant: 'prime', bailianWan30Resolution: '480P', bailianWan30Duration: 4 })).toBeCloseTo(1.8)
  })
})

describe('百炼 Qwen Audio 3.1 TTS Plus', () => {
  it('请求 Plus 型号并带演绎指令', () => {
    expect(build(bailianQwenAudio31TtsPlusModel, { prompt: '你好', bailianQwenTtsPlusInstruction: '请讲上海话' })).toEqual({
      model: 'qwen-audio-3.1-tts-plus',
      input: { text: '你好', voice: 'longanlingxin_v3.1', format: 'mp3', rate: 1, instruction: '请讲上海话' },
    })
  })

  it('按百炼字符规则计价：汉字 2 个字符，其余 1 个', () => {
    // 官方示例“中A文123”为 8 个字符。
    expect(price(bailianQwenAudio31TtsPlusModel, { prompt: '中A文123' })).toBeCloseTo(8 * 1.4 / 10_000, 8)
  })
})
