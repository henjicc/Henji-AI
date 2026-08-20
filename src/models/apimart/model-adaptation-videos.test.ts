import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core', async () => {
  const [{ defineModel }, modelText] = await Promise.all([
    import('@/core/defineModel'),
    import('@/core/i18n/modelText'),
  ])
  return { defineModel, ...modelText }
})

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { evalFunction } from '../../../electron/main/services/ai-runtime/js-runtime'
import type { JsonObject } from '../../../electron/main/services/ai-runtime/types'
import modelManifest from '../../../resources/model-manifest.json'
import { apimartGeminiOmniFlashModel } from './gemini-omni-flash.model'
import { apimartKling30Model } from './kling-3.0.model'
import { apimartKling30OmniModel } from './kling-3.0-omni.model'
import { apimartKling30TurboModel } from './kling-3.0-turbo.model'
import { apimartMiniMaxH3Model } from './minimax-h3.model'
import { apimartSeedance20Model } from './seedance-2.0.model'
import { apimartSeedance20FastModel } from './seedance-2.0-fast.model'
import { apimartSeedance20MiniModel } from './seedance-2.0-mini.model'
import { apimartSeedance25Model } from './seedance-2.5.model'

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation APIMart 视频模型', () => {
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
  ])('%s 的 manifest builder 可在独立 VM 执行', (modelId) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test' })).toMatchObject({ prompt: 'test' })
  })

  it('Gemini Omni Flash 保留图片、视频和延续任务上下文', () => {
    expect(apimartGeminiOmniFlashModel.request?.builder?.({
      prompt: 'continue', uploadedFilePaths: ['a.png'], uploadedVideoFilePaths: ['v.mp4'],
      apimartGeminiOmniFlashExtendTaskId: ' task-1 '
    })).toMatchObject({
      model: 'gemini-omni-flash-preview', image_urls: ['a.png'], video_urls: ['v.mp4'],
      extend_from_task_id: 'task-1', resolution: '720p'
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

  it.each(models)('$meta.id 不发送项目隐藏字段', (model) => {
    const request = model.request?.builder?.({ prompt: 'test' })
    expect(request).not.toHaveProperty('seed')
    expect(request).not.toHaveProperty('negative_prompt')
    expect(request).not.toHaveProperty('output_format')
  })
})
