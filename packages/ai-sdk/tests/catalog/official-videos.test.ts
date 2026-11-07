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
      volcengineSeedance25AspectRatio: 'smart', volcengineSeedance25TaskType: 'reference', volcengineSeedance25AutoDuration: true, volcengineSeedance25WebSearch: true,
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

  it('2.0 参考音频必须搭配参考图或参考视频；2.0 不发 2.5 专属的任务类型', () => {
    expect(() => build(volcengineSeedance20Model, { prompt: 'x', uploadedAudioFilePaths: ['v.mp3'] })).toThrow('参考图或参考视频')
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

describe('参考视频（火山方舟 Seedance、百炼万相 3.0）', () => {
  it('Seedance 2.0 参考模式按 reference_video 发送视频，最多 3 段', () => {
    const body = build(volcengineSeedance20Model, {
      prompt: '视频1 的人换成卡通风', volcengineSeedance20Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['https://h/1.mp4', 'https://h/2.mp4', 'https://h/3.mp4', 'https://h/4.mp4'],
    })
    const videos = (body.content as JsonObject[]).filter((item) => item.type === 'video_url')
    expect(videos).toEqual(['1', '2', '3'].map((n) => ({ type: 'video_url', video_url: { url: `https://h/${n}.mp4` }, role: 'reference_video' })))
    expect(body).not.toHaveProperty('omni_reference_task_type')
  })

  it('Seedance 2.5 视频编辑强制自适应比例与 -1 时长，缺视频时提交前拒绝', () => {
    const edit = { prompt: '把天空改成黄昏', volcengineSeedance25Mode: 'reference-to-video', volcengineSeedance25TaskType: 'edit', volcengineSeedance25AspectRatio: '16:9', volcengineSeedance25Duration: 8 }
    expect(build(volcengineSeedance25Model, { ...edit, uploadedVideoFilePaths: ['https://h/a.mp4'] }))
      .toMatchObject({ omni_reference_task_type: 'edit', ratio: 'adaptive', duration: -1 })
    expect(build(volcengineSeedance25Model, { ...edit, volcengineSeedance25TaskType: 'extend', uploadedVideoFilePaths: ['https://h/a.mp4'] }))
      .toMatchObject({ omni_reference_task_type: 'extend', ratio: 'adaptive', duration: 8 })
    expect(() => build(volcengineSeedance25Model, { ...edit, uploadedFilePaths: ['a.png'] })).toThrow('至少需要一段参考视频')
  })

  it('Seedance 带参考视频按“输入含视频”单价计费，输入视频时长计入', () => {
    // 2.0、720p、16:9：输入 10 秒 + 输出 5 秒 = 15 秒，单价 ¥28/百万 token。
    const tokens = 15 * 1280 * 720 * 24 / 1024
    expect(price(volcengineSeedance20Model, {
      volcengineSeedance20Mode: 'reference-to-video', volcengineSeedance20Resolution: '720p', volcengineSeedance20AspectRatio: '16:9',
      volcengineSeedance20Duration: 5, uploadedVideoFilePaths: ['https://h/a.mp4'], __videoDurationSeconds: [10],
    })).toBeCloseTo(tokens * 28 / 1_000_000, 6)
  })

  it('万相 3.0 参考模式发参考视频与参考音频，输入视频时长与输出同价计入', () => {
    const params = {
      prompt: '视频1 接着往下拍', bailianWan30Mode: 'reference-to-video', bailianWan30Resolution: '720P', bailianWan30Duration: 5,
      uploadedFilePaths: ['data:image/png;base64,AA=='], uploadedVideoFilePaths: ['oss://dir/v.mp4'], uploadedAudioFilePaths: ['oss://dir/a.mp3'], __videoDurationSeconds: [6],
    }
    expect((build(bailianWan30Model, params).input as JsonObject).media).toEqual([
      { type: 'reference_image', url: 'data:image/png;base64,AA==' },
      { type: 'reference_video', url: 'oss://dir/v.mp4' },
      { type: 'reference_audio', url: 'oss://dir/a.mp3' },
    ])
    expect(price(bailianWan30Model, params)).toBeCloseTo(0.6 * (5 + 6), 6)
  })
})

it('万相 3.0 有视频输入时输出时长收进“输入 + 输出 ≤ 30 秒”', () => {
  const body = build(bailianWan30Model, {
    prompt: '视频1 继续', bailianWan30Mode: 'reference-to-video', bailianWan30Duration: 30,
    uploadedVideoFilePaths: ['oss://dir/v.mp4'], __videoDurationSeconds: [12.4],
  })
  expect((body.parameters as JsonObject).duration).toBe(17)
})
