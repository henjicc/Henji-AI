import { beforeAll, describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { catalog, catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { apimartGeminiOmniFlashModel as apimartGeminiOmniFlashRuntime } from '../../src/catalog/apimart/gemini-omni-flash.model'
import { requestBuilder } from '@/core/request/RequestBuilder'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { apimartPresentation } from '@/models/presentation/apimart'
import { apimartKling30Model as apimartKling30Runtime } from '../../src/catalog/apimart/kling-3.0.model'
import { apimartKling30OmniModel as apimartKling30OmniRuntime } from '../../src/catalog/apimart/kling-3.0-omni.model'
import { apimartKling30TurboModel as apimartKling30TurboRuntime } from '../../src/catalog/apimart/kling-3.0-turbo.model'
import { apimartMiniMaxH3Model as apimartMiniMaxH3Runtime } from '../../src/catalog/apimart/minimax-h3.model'
import { apimartSeedance20Model as apimartSeedance20Runtime } from '../../src/catalog/apimart/seedance-2.0.model'
import { apimartSeedance20FastModel as apimartSeedance20FastRuntime } from '../../src/catalog/apimart/seedance-2.0-fast.model'
import { apimartSeedance20MiniModel as apimartSeedance20MiniRuntime } from '../../src/catalog/apimart/seedance-2.0-mini.model'
import { apimartSeedance25Model as apimartSeedance25Runtime } from '../../src/catalog/apimart/seedance-2.5.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, apimartPresentation[runtime.meta.id])

const apimartGeminiOmniFlashModel = compose(apimartGeminiOmniFlashRuntime)
const apimartKling30Model = compose(apimartKling30Runtime)
const apimartKling30OmniModel = compose(apimartKling30OmniRuntime)
const apimartKling30TurboModel = compose(apimartKling30TurboRuntime)
const apimartMiniMaxH3Model = compose(apimartMiniMaxH3Runtime)
const apimartSeedance20Model = compose(apimartSeedance20Runtime)
const apimartSeedance20FastModel = compose(apimartSeedance20FastRuntime)
const apimartSeedance20MiniModel = compose(apimartSeedance20MiniRuntime)
const apimartSeedance25Model = compose(apimartSeedance25Runtime)

beforeAll(() => {
  registry.clear()
  ;[
    apimartGeminiOmniFlashModel,
    apimartKling30Model,
    apimartKling30OmniModel,
    apimartKling30TurboModel,
    apimartMiniMaxH3Model,
    apimartSeedance20Model,
    apimartSeedance20FastModel,
    apimartSeedance20MiniModel,
    apimartSeedance25Model,
  ].forEach((model) => registry.register(model))
})

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation APIMart 视频模型', () => {
  const models = [
    apimartGeminiOmniFlashModel,
    apimartKling30Model,
    apimartKling30OmniModel,
    apimartKling30TurboModel,
    apimartMiniMaxH3Model,
    apimartSeedance20Model,
    apimartSeedance20FastModel,
    apimartSeedance20MiniModel,
    apimartSeedance25Model,
  ]

  it.each(models)('$meta.id 在画布按比例与分辨率两个标量参数渲染', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each(models)('$meta.id 使用 APIMart 视频提交端点', (model) => {
    expect(model.endpoints).toBe('/v1/videos/generations')
    expect(model.meta.provider).toBe('apimart')
  })

  it.each([
    'apimart-gemini-omni-flash',
    'apimart-kling-3.0',
    'apimart-kling-3.0-omni',
    'apimart-kling-3.0-turbo',
    'apimart-minimax-h3',
    'apimart-seedance-2.0',
    'apimart-seedance-2.0-fast',
    'apimart-seedance-2.0-mini',
    'apimart-seedance-2.5',
  ])('%s 的 catalog builder 可直接执行', (modelId) => {
    expect(evaluateCatalogBuilder(modelId, { prompt: 'test' })).toMatchObject({ prompt: 'test' })
  })

  it('Gemini Omni Flash 分别保留图片/视频与延续任务上下文', () => {
    expect(apimartGeminiOmniFlashModel.request?.builder?.({
      prompt: 'edit', uploadedFilePaths: ['a.png'], uploadedVideoFilePaths: ['v.mp4']
    })).toMatchObject({
      model: 'gemini-omni-flash-preview', image_urls: ['a.png'], video_urls: ['v.mp4'],
      resolution: '720p'
    })
    expect(apimartGeminiOmniFlashModel.request?.builder?.({
      prompt: 'continue', apimartGeminiOmniFlashExtendTaskId: ' task-1 '
    })).toMatchObject({
      model: 'gemini-omni-flash-preview', extend_from_task_id: 'task-1', resolution: '720p'
    })
  })

  it('Gemini Omni Flash 官方渠道最多支持 4 图并拦截视频与延续任务冲突', () => {
    // 官方模型页原文："最多 4 张参考图"（apimart.ai/zh/model/gemini-omni-flash-preview）
    const images = Array.from({ length: 16 }, (_, index) => `${index}.png`)
    expect(apimartGeminiOmniFlashModel.request?.builder?.({ prompt: 'group', images })).toMatchObject({ image_urls: images.slice(0, 4) })
    expect(() => apimartGeminiOmniFlashModel.request?.builder?.({
      prompt: 'conflict', videos: ['source.mp4'], apimartGeminiOmniFlashExtendTaskId: 'task-1'
    })).toThrow(/video|task|\u89c6频|\u4efb务/u)
  })

  it('Gemini Omni Flash 在统一模型中切换普通渠道的离散时长、图片约束和价格', async () => {
    expect(apimartGeminiOmniFlashModel.params[0]).toMatchObject({
      id: 'apimartGeminiOmniFlashChannel', order: 1, default: 'official',
      name: { key: 'params.fields.apiChannel' },
      options: [
        { value: 'official', label: { key: 'params.options.official' } },
        { value: 'ext', label: { key: 'params.options.regular' } }
      ]
    })
    expect(apimartGeminiOmniFlashModel.request?.builder?.({
      apimartGeminiOmniFlashChannel: 'ext',
      prompt: 'reference',
      images: ['a.png', 'b.png', 'c.png'],
      videos: ['motion.mp4'],
      apimartGeminiOmniFlashResolution: '4k',
      apimartGeminiOmniFlashExtDuration: '10'
    })).toMatchObject({
      model: 'Omni-Flash-Ext',
      generation_type: 'reference',
      image_urls: ['a.png', 'b.png', 'c.png'],
      video_urls: ['motion.mp4'],
      resolution: '4k'
    })
    expect(apimartGeminiOmniFlashModel.request?.builder?.({
      apimartGeminiOmniFlashChannel: 'ext', prompt: 'reference', videos: ['motion.mp4']
    })).not.toHaveProperty('duration')
    expect(() => apimartGeminiOmniFlashModel.request?.builder?.({
      apimartGeminiOmniFlashChannel: 'ext', prompt: 'invalid', images: ['a.png', 'b.png']
    })).toThrow(/0|1|3/)
    expect(apimartGeminiOmniFlashModel.pricing.calculator?.({
      apimartGeminiOmniFlashChannel: 'ext', videos: ['motion.mp4'], apimartGeminiOmniFlashResolution: '4k'
    })).toBe(0.24)
    expect(catalog.some((model) => model.meta.id === 'apimart-gemini-omni-flash-ext')).toBe(false)
    await expect(requestBuilder.build('apimart-gemini-omni-flash-ext', {
      prompt: 'legacy ext',
      apimartGeminiOmniFlashExtGenerationType: 'frame',
      apimartGeminiOmniFlashExtAspectRatio: '9:16',
      apimartGeminiOmniFlashExtResolution: '4k',
      apimartGeminiOmniFlashExtDuration: '10',
      images: ['frame.png'],
    })).resolves.toMatchObject({
      body: {
        model: 'Omni-Flash-Ext', generation_type: 'frame', aspect_ratio: '9:16',
        resolution: '4k', duration: 10, image_urls: ['frame.png'],
      },
    })
  })

  it('MiniMax H3 在首尾帧与多模态参考模式之间切换', () => {
    expect(apimartMiniMaxH3Model.request?.builder?.({
      prompt: 'transition', uploadedFilePaths: ['first.png', 'last.png'],
      apimartMiniMaxH3Mode: 'text-image-to-video'
    })).toMatchObject({ first_frame_image: 'first.png', last_frame_image: 'last.png' })

    expect(apimartMiniMaxH3Model.request?.builder?.({
      prompt: 'reference', uploadedFilePaths: ['a.png'], uploadedVideoFilePaths: ['v.mp4'], uploadedAudioFilePaths: ['a.mp3'],
      apimartMiniMaxH3Mode: 'reference-to-video'
    })).toMatchObject({ image_urls: ['a.png'], video_urls: ['v.mp4'], audio_urls: ['a.mp3'] })
    expect(apimartMiniMaxH3Model.request?.builder?.({ prompt: 'text' })).toMatchObject({
      resolution: '2K', aspect_ratio: '16:9'
    })
    expect(apimartMiniMaxH3Model.pricing.calculator?.({
      apimartMiniMaxH3Mode: 'reference-to-video',
      videos: ['v.mp4'],
      __firstVideoDurationSeconds: 8,
      apimartMiniMaxH3Duration: 5,
      apimartMiniMaxH3Resolution: '2K'
    })).toBeCloseTo(1.18872)
  })

  it('Kling 标准版把显示分辨率映射为平台 mode 并保留首尾帧', () => {
    expect(apimartKling30Model.request?.builder?.({
      prompt: 'transition', uploadedFilePaths: ['first.png', 'last.png'],
      apimartKling30Resolution: '4K', apimartKling30Audio: true
    })).toMatchObject({ model: 'kling-v3', mode: '4k', image_urls: ['first.png', 'last.png'], audio: true })
    expect(apimartKling30Model.pricing.calculator?.({
      apimartKling30Duration: 10, apimartKling30Resolution: '1080p', apimartKling30Audio: true
    })).toBeCloseTo(1.344)
  })

  it('Kling Turbo 图生视频只发送 first_frame_image', () => {
    const request = apimartKling30TurboModel.request?.builder?.({
      prompt: 'move', uploadedFilePaths: ['first.png'], apimartKling30TurboAspectRatio: '9:16'
    })
    expect(request).toMatchObject({ model: 'kling-3.0-turbo', first_frame_image: 'first.png' })
    expect(request).not.toHaveProperty('image_urls')
    expect(request).not.toHaveProperty('aspect_ratio')
  })

  it('Kling Omni 视频编辑构造 video_list 且不发送互斥的图片和音频', () => {
    const request = apimartKling30OmniModel.request?.builder?.({
      prompt: 'edit', uploadedFilePaths: ['reference.png'], uploadedVideoFilePaths: ['source.mp4'],
      apimartKling30OmniAudio: true, apimartKling30OmniKeepOriginalSound: true
    })
    expect(request).toMatchObject({
      model: 'kling-v3-omni',
      video_list: [{ video_url: 'source.mp4', refer_type: 'base', keep_original_sound: 'yes' }]
    })
    expect(request).not.toHaveProperty('image_urls')
    expect(request).not.toHaveProperty('audio')
  })

  it('Kling Omni 区分首尾帧、参考图与特征视频', () => {
    expect(apimartKling30OmniModel.request?.builder?.({
      prompt: 'frames', images: ['first.png', 'last.png']
    })).toMatchObject({
      image_with_roles: [
        { url: 'first.png', role: 'first_frame' },
        { url: 'last.png', role: 'last_frame' }
      ]
    })
    expect(apimartKling30OmniModel.request?.builder?.({
      prompt: 'references',
      apimartKling30OmniMode: 'reference-to-video',
      images: ['a.png', 'b.png', 'c.png']
    })).toMatchObject({ image_urls: ['a.png', 'b.png', 'c.png'] })
    expect(apimartKling30OmniModel.request?.builder?.({
      prompt: 'feature',
      apimartKling30OmniVideoReferenceType: 'feature',
      videos: ['source.mp4'],
      images: ['first.png']
    })).toMatchObject({
      video_list: [{ video_url: 'source.mp4', refer_type: 'feature', keep_original_sound: 'no' }],
      image_urls: ['first.png']
    })
    expect(apimartKling30OmniModel.pricing.calculator?.({
      videos: ['source.mp4'],
      __firstVideoDurationSeconds: 8,
      apimartKling30OmniResolution: '720p'
    })).toBeCloseTo(0.8064)
  })

  it.each([
    [apimartSeedance20Model, 'apimartSeedance20Mode'],
    [apimartSeedance20FastModel, 'apimartSeedance20FastMode'],
    [apimartSeedance20MiniModel, 'apimartSeedance20MiniMode'],
    [apimartSeedance25Model, 'apimartSeedance25Mode'],
  ] as const)('$meta.id 使用 image_with_roles 表达首尾帧', (model, modeParam) => {
    const request = model.request?.builder?.({
      prompt: 'transition', uploadedFilePaths: ['first.png', 'last.png'], [modeParam]: 'text-image-to-video'
    })
    expect(request?.image_with_roles).toEqual([
      { url: 'first.png', role: 'first_frame' },
      { url: 'last.png', role: 'last_frame' },
    ])
    expect(request).not.toHaveProperty('image_urls')
  })

  it('Seedance 2.0 与 2.5 使用各自完整的分辨率价格档', () => {
    expect(apimartSeedance20Model.pricing.calculator?.({
      apimartSeedance20Duration: 5, apimartSeedance20Resolution: '4K'
    })).toBeCloseTo(3.61)
    expect(apimartSeedance25Model.pricing.calculator?.({
      apimartSeedance25Duration: 5, apimartSeedance25Resolution: '1080p'
    })).toBeCloseTo(1.9244)
  })

  it('Seedance 2.0 传递联网搜索、自适应比例和小写 4k', () => {
    expect(apimartSeedance20Model.request?.builder?.({
      prompt: 'x'.repeat(5000),
      uploadedFilePaths: ['first.png'],
      apimartSeedance20WebSearch: true,
      apimartSeedance20Resolution: '4K'
    })).toMatchObject({
      prompt: 'x'.repeat(4000),
      size: 'adaptive',
      resolution: '4k',
      tools: [{ type: 'web_search' }]
    })
    expect(() => apimartSeedance20Model.request?.builder?.({
      prompt: 'audio only',
      apimartSeedance20Mode: 'reference-to-video',
      uploadedAudioFilePaths: ['voice.mp3']
    })).toThrow(/must|reference|\u5fc5须|\u53c2考/u)
  })

  it('Seedance 2.5 在编辑任务中强制自适应比例与自动时长', () => {
    expect(() => apimartSeedance25Model.request?.builder?.({
      prompt: 'edit',
      apimartSeedance25Mode: 'reference-to-video',
      apimartSeedance25TaskType: 'edit'
    })).toThrow(/video|\u89c6频/u)
    expect(apimartSeedance25Model.request?.builder?.({
      prompt: 'edit',
      apimartSeedance25Mode: 'reference-to-video',
      apimartSeedance25TaskType: 'edit',
      uploadedVideoFilePaths: ['source.mp4'],
      apimartSeedance25WebSearch: true
    })).toMatchObject({
      duration: -1,
      size: 'adaptive',
      omni_reference_task_type: 'edit',
      video_urls: ['source.mp4'],
      tools: [{ type: 'web_search' }]
    })
  })

  it('Seedance 有参考视频时按输入与输出总时长计价', () => {
    expect(apimartSeedance20Model.pricing.calculator?.({
      apimartSeedance20Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['source.mp4'],
      __firstVideoDurationSeconds: 10,
      apimartSeedance20Duration: 5,
      apimartSeedance20Resolution: '720p'
    })).toBeCloseTo(1.2876)
    expect(apimartSeedance25Model.pricing.calculator?.({
      apimartSeedance25Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['source.mp4'],
      __firstVideoDurationSeconds: 10,
      apimartSeedance25Duration: 5,
      apimartSeedance25Resolution: '1080p'
    })).toBeCloseTo(3.4488)
  })

  it.each([
    [apimartMiniMaxH3Model, 'apimartMiniMaxH3Mode', 'apimartMiniMaxH3Duration', 'apimartMiniMaxH3Resolution', '2K', 0.09144],
    [apimartSeedance20Model, 'apimartSeedance20Mode', 'apimartSeedance20Duration', 'apimartSeedance20Resolution', '720p', 0.08584],
    [apimartSeedance20FastModel, 'apimartSeedance20FastMode', 'apimartSeedance20FastDuration', 'apimartSeedance20FastResolution', '720p', 0.05128],
    [apimartSeedance20MiniModel, 'apimartSeedance20MiniMode', 'apimartSeedance20MiniDuration', 'apimartSeedance20MiniResolution', '720p', 0.01384],
    [apimartSeedance25Model, 'apimartSeedance25Mode', 'apimartSeedance25Duration', 'apimartSeedance25Resolution', '1080p', 0.22992],
  ] as const)('$meta.id 按所有参考视频真实总时长计价并让空数组回退到 uploadedVideos', (
    model, modeParam, durationParam, resolutionParam, resolution, rate
  ) => {
    expect(model.pricing.calculator?.({
      [modeParam]: 'reference-to-video',
      [durationParam]: 5,
      [resolutionParam]: resolution,
      uploadedVideoFilePaths: [],
      videos: [],
      uploadedVideos: ['first.mp4', 'second.mp4'],
      __videoDurationSeconds: [3, 7],
    })).toBeCloseTo(15 * rate)
  })

  it('参考视频逐段时长不完整时使用总时长，并保留旧首段时长兼容', () => {
    const base = {
      apimartMiniMaxH3Mode: 'reference-to-video',
      apimartMiniMaxH3Duration: 5,
      apimartMiniMaxH3Resolution: '2K',
      uploadedVideoFilePaths: ['first.mp4', 'second.mp4'],
    }
    expect(apimartMiniMaxH3Model.pricing.calculator?.({
      ...base,
      __videoDurationSeconds: [3],
      __totalVideoDurationSeconds: 10,
      __firstVideoDurationSeconds: 99,
    })).toBeCloseTo(15 * 0.09144)
    expect(apimartMiniMaxH3Model.pricing.calculator?.({
      ...base,
      __firstVideoDurationSeconds: 4,
    })).toBeCloseTo(13 * 0.09144)
  })

  it.each(models)('$meta.id 不发送项目隐藏字段', (model) => {
    const request = model.request?.builder?.({ prompt: 'test' })
    expect(request).not.toHaveProperty('seed')
    expect(request).not.toHaveProperty('negative_prompt')
    expect(request).not.toHaveProperty('output_format')
  })
})
