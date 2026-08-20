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
import { kieGeminiOmniVideoModel } from './gemini-omni-video.model'
import { kieKling30Model } from './kling-3.0.model'
import { kieKling30OmniModel } from './kling-3.0-omni.model'
import { kieKling30TurboModel } from './kling-3.0-turbo.model'
import { kieMiniMaxH3Model } from './minimax-h3.model'
import { kieSeedance20Model } from './seedance-2.0.model'
import { kieSeedance20FastModel } from './seedance-2.0-fast.model'
import { kieSeedance20MiniModel } from './seedance-2.0-mini.model'
import { kieSeedance25Model } from './seedance-2.5.model'

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation KIE 视频模型', () => {
  const models = [
    kieGeminiOmniVideoModel,
    kieMiniMaxH3Model,
    kieKling30Model,
    kieKling30TurboModel,
    kieKling30OmniModel,
    kieSeedance20Model,
    kieSeedance20FastModel,
    kieSeedance20MiniModel,
    kieSeedance25Model,
  ]

  it.each(models)('$meta.id 在画布使用独立比例与分辨率参数', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each(models)('$meta.id 的 manifest builder 可在独立 VM 执行', (model) => {
    expect(evaluateManifestBuilder(model.meta.id, { prompt: 'test' })).toMatchObject({
      input: { prompt: 'test' }
    })
  })

  it('Gemini Omni 使用档案中的最新固定档价格', () => {
    expect(kieGeminiOmniVideoModel.pricing.calculator?.({
      kieGeminiOmniVideoDuration: '4',
      kieGeminiOmniVideoResolution: '720p'
    })).toBe(0.315)
    expect(kieGeminiOmniVideoModel.pricing.calculator?.({
      uploadedVideoFilePaths: ['video.mp4'],
      kieGeminiOmniVideoResolution: '4k'
    })).toBe(1.26)
  })

  it('Seedance 2.0 Fast/Mini 使用是否带视频的最新秒价', () => {
    expect(kieSeedance20FastModel.pricing.calculator?.({
      kieSeedance20FastDuration: 5,
      kieSeedance20FastResolution: '720p'
    })).toBeCloseTo(0.62)
    expect(kieSeedance20FastModel.pricing.calculator?.({
      kieSeedance20FastMode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance20FastDuration: 5,
      kieSeedance20FastResolution: '720p'
    })).toBeCloseTo(0.375)
    expect(kieSeedance20MiniModel.pricing.calculator?.({
      kieSeedance20MiniMode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance20MiniDuration: 5,
      kieSeedance20MiniResolution: '480p'
    })).toBeCloseTo(0.06)
  })

  it('MiniMax H3 自动选择文生、首尾帧和多模态参考端点', () => {
    expect(kieMiniMaxH3Model.request?.builder?.({ prompt: 'text' })).toMatchObject({
      model: 'minimax-h3/text-to-video',
      input: { aspect_ratio: '16:9', resolution: '768P' }
    })
    expect(kieMiniMaxH3Model.request?.builder?.({
      prompt: 'frames',
      uploadedFilePaths: ['first.png', 'last.png']
    })).toMatchObject({
      model: 'minimax-h3/image-to-video',
      input: { first_frame_image: 'first.png', last_frame_image: 'last.png' }
    })
    expect(kieMiniMaxH3Model.request?.builder?.({
      prompt: 'reference',
      kieMiniMaxH3Mode: 'reference-to-video',
      uploadedFilePaths: ['character.png'],
      uploadedVideoFilePaths: ['motion.mp4'],
      uploadedAudioFilePaths: ['voice.mp3']
    })).toMatchObject({
      model: 'minimax-h3/reference-to-video',
      input: {
        image_urls: ['character.png'],
        video_urls: ['motion.mp4'],
        audio_urls: ['voice.mp3']
      }
    })
  })

  it('Kling 3.0 将展示分辨率映射为 KIE mode', () => {
    expect(kieKling30Model.request?.builder?.({
      prompt: 'scene',
      uploadedFilePaths: ['first.png', 'last.png'],
      kieKling30Resolution: '4K',
      kieKling30AspectRatio: 'smart',
      __firstImageRatio: 9 / 16
    })).toMatchObject({
      model: 'kling-3.0/video',
      input: {
        image_urls: ['first.png', 'last.png'],
        aspect_ratio: '9:16',
        mode: '4K',
        multi_shots: false
      }
    })
  })

  it('Kling 3.0 Turbo 按图片存在切换 KIE 模型 ID', () => {
    expect(kieKling30TurboModel.request?.builder?.({ prompt: 'text' })).toMatchObject({
      model: 'kling/v3-turbo-text-to-video',
      input: { aspect_ratio: '16:9', resolution: '720p' }
    })
    expect(kieKling30TurboModel.request?.builder?.({
      prompt: 'image',
      uploadedFilePaths: ['first.png'],
      kieKling30TurboResolution: '1080p'
    })).toMatchObject({
      model: 'kling/v3-turbo-image-to-video',
      input: { image_urls: ['first.png'], resolution: '1080p' }
    })
  })

  it('Kling 3.0 Omni 覆盖文生、图生、变换和参考四条路由', () => {
    const cases = [
      ['text-to-video', 'kling-3.0-omni/text-to-video'],
      ['image-to-video', 'kling-3.0-omni/image-to-video'],
      ['transformation', 'kling-3.0-omni/transformation'],
      ['reference-to-video', 'kling-3.0-omni/reference-to-video'],
    ] as const
    for (const [mode, expectedModel] of cases) {
      expect(kieKling30OmniModel.request?.builder?.({
        prompt: mode,
        kieKling30OmniMode: mode,
        uploadedFilePaths: ['image.png'],
        uploadedVideoFilePaths: ['video.mp4']
      })).toMatchObject({ model: expectedModel })
    }
  })

  it('Seedance 2.5 支持 30/10/10 参考输入上限并按视频输入计价', () => {
    expect(kieSeedance25Model.inputLimits).toMatchObject({
      rules: [{ images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } }]
    })
    expect(kieSeedance25Model.pricing.calculator?.({
      kieSeedance25Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance25Duration: 10,
      kieSeedance25Resolution: '1080p'
    })).toBeCloseTo(3.425)
  })
})
